import { requestJson } from '../lib/http.js';
import { nextMonthStartUTC } from '../lib/meter.js';

// GitHub billing usage API, AI credits (Copilot moved to credits 2026-06-01).
// Docs: https://docs.github.com/en/rest/billing/usage
// Works for usage billed to a personal plan; org-managed seats are excluded.
// The API returns consumption only, so the limit comes from the plan table
// below (from GitHub's docs; flex amounts may change) or COPILOT_CREDIT_LIMIT.

export const PLAN_CREDITS = { pro: 1500, pro_plus: 7000, max: 20000 };
const USD_PER_CREDIT = 0.01;

export default {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  setup: 'Set GITHUB_TOKEN and GITHUB_USERNAME in .env. Optional: COPILOT_PLAN (pro, pro_plus, max) or COPILOT_CREDIT_LIMIT.',
  configured: (env) => Boolean(env.GITHUB_TOKEN && env.GITHUB_USERNAME),

  async fetch(env, { signal, fetch }) {
    const now = new Date();
    const q = new URLSearchParams({ year: String(now.getUTCFullYear()), month: String(now.getUTCMonth() + 1) });
    const user = encodeURIComponent(env.GITHUB_USERNAME);
    const body = await requestJson(`https://api.github.com/users/${user}/settings/billing/ai_credit/usage?${q}`, {
      signal,
      fetch,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'usage-dashboard',
      },
    });

    // grossAmount is USD before included-credit discounts, so it measures
    // consumption regardless of which unitType each line item uses.
    const items = (body?.usageItems || []).filter((i) => /copilot/i.test(i.product || ''));
    const usd = items.reduce((s, i) => s + (Number(i.grossAmount) || 0), 0);
    const limit = env.COPILOT_CREDIT_LIMIT || PLAN_CREDITS[env.COPILOT_PLAN] || null;

    return [{
      id: 'copilot-credits',
      label: 'AI credits this month',
      used: Math.round(usd / USD_PER_CREDIT),
      limit,
      unit: 'credits',
      period: 'monthly',
      resetsAt: nextMonthStartUTC(now).toISOString(),
      note: limit ? 'Included credits; overage beyond this is billed' : 'Set COPILOT_PLAN to show a limit',
    }];
  },
};
