import { collectPages } from '../lib/http.js';
import { monthStartUTC, nextMonthStartUTC } from '../lib/meter.js';

// Anthropic Admin API: cost_report and usage_report/messages.
// Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-api
// Needs an admin key (sk-ant-admin...); organization accounts only.

const BASE = 'https://api.anthropic.com/v1/organizations';

export default {
  id: 'anthropic-api',
  name: 'Anthropic API',
  setup: 'Set ANTHROPIC_ADMIN_KEY (sk-ant-admin…) in .env. Optional: ANTHROPIC_MONTHLY_BUDGET_USD.',
  configured: (env) => Boolean(env.ANTHROPIC_ADMIN_KEY),

  async fetch(env, { signal, fetch }) {
    const opts = { signal, fetch, headers: { 'x-api-key': env.ANTHROPIC_ADMIN_KEY, 'anthropic-version': '2023-06-01' } };
    const now = new Date();
    const range = { starting_at: monthStartUTC(now).toISOString(), ending_at: now.toISOString(), bucket_width: '1d', limit: '31' };
    const url = (path) => (page) => {
      const q = new URLSearchParams(range);
      if (page) q.set('page', page);
      return `${BASE}/${path}?${q}`;
    };

    const [costBuckets, usageBuckets] = await Promise.all([
      collectPages(url('cost_report'), opts),
      collectPages(url('usage_report/messages'), opts),
    ]);

    // amount is a decimal string in cents ("123.45" = $1.2345).
    const cents = sumResults(costBuckets, (r) => Number(r.amount) || 0);
    const tokens = sumResults(usageBuckets, (r) =>
      (r.uncached_input_tokens || 0) +
      (r.cache_read_input_tokens || 0) +
      (r.cache_creation?.ephemeral_5m_input_tokens || 0) +
      (r.cache_creation?.ephemeral_1h_input_tokens || 0) +
      (r.output_tokens || 0));

    const resetsAt = nextMonthStartUTC(now).toISOString();
    return [
      {
        id: 'anthropic-spend',
        label: 'Spend this month',
        used: round2(cents / 100),
        limit: env.ANTHROPIC_MONTHLY_BUDGET_USD || null,
        unit: 'USD',
        period: 'monthly',
        resetsAt,
        note: env.ANTHROPIC_MONTHLY_BUDGET_USD ? 'Limit is your budget from .env' : 'No budget set',
      },
      { id: 'anthropic-tokens', label: 'Tokens this month', used: tokens, unit: 'tokens', period: 'monthly', resetsAt },
    ];
  },
};

export function sumResults(buckets, pick) {
  let total = 0;
  for (const b of buckets) for (const r of b.results || []) total += pick(r);
  return total;
}

const round2 = (n) => Math.round(n * 100) / 100;
