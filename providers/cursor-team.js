import { requestJson } from '../lib/http.js';

// Cursor Admin API, POST /teams/spend. Team and Enterprise plans only;
// individual Pro users have no API and should use a manual meter.
// Docs: https://cursor.com/docs/account/teams/admin-api
// Cursor's docs lag the live schema, so fields are read defensively.

export default {
  id: 'cursor-team',
  name: 'Cursor (team)',
  setup: 'Team/Enterprise only. Set CURSOR_ADMIN_KEY in .env. Optional: CURSOR_EMAIL to show one member, CURSOR_MONTHLY_BUDGET_USD.',
  configured: (env) => Boolean(env.CURSOR_ADMIN_KEY),

  async fetch(env, { signal, fetch }) {
    const auth = Buffer.from(`${env.CURSOR_ADMIN_KEY}:`).toString('base64');
    const opts = { signal, fetch, method: 'POST', headers: { authorization: `Basic ${auth}` } };

    const members = [];
    let cycleStart = null;
    for (let page = 1; page <= 20; page++) {
      const body = await requestJson('https://api.cursor.com/teams/spend', {
        ...opts,
        body: { page, pageSize: 100, ...(env.CURSOR_EMAIL ? { searchTerm: env.CURSOR_EMAIL } : {}) },
      });
      const rows = body?.teamMemberSpend || body?.members || [];
      members.push(...rows);
      cycleStart ??= body?.subscriptionCycleStart ?? null;
      if (!body?.totalPages || page >= body.totalPages) break;
    }

    const scope = env.CURSOR_EMAIL
      ? members.filter((m) => String(m.email || '').toLowerCase() === env.CURSOR_EMAIL.toLowerCase())
      : members;
    if (env.CURSOR_EMAIL && scope.length === 0) throw new Error(`no team member matches ${env.CURSOR_EMAIL}`);

    const cents = scope.reduce((s, m) => s + (Number(m.spendCents ?? m.overallSpendCents) || 0), 0);
    const one = scope.length === 1 ? scope[0] : null;
    const limit = env.CURSOR_MONTHLY_BUDGET_USD || one?.hardLimitOverrideDollars || null;

    const meters = [{
      id: 'cursor-spend',
      label: one ? `Spend this cycle (${one.email})` : `Team spend this cycle (${scope.length} members)`,
      used: Math.round(cents) / 100,
      limit,
      unit: 'USD',
      period: 'monthly',
      note: cycleStart ? `Cycle started ${new Date(Number(cycleStart) || cycleStart).toISOString().slice(0, 10)}` : '',
    }];
    // Only populated for tiered self-serve teams.
    if (one && one.totalPercentUsed != null) {
      meters.push({ id: 'cursor-included', label: 'Included usage', used: Number(one.totalPercentUsed), limit: 100, unit: '%', period: 'monthly' });
    }
    return meters;
  },
};
