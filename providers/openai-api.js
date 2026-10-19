import { collectPages } from '../lib/http.js';
import { monthStartUTC, nextMonthStartUTC } from '../lib/meter.js';
import { sumResults } from './anthropic-api.js';

// OpenAI Admin API: organization costs.
// Docs: https://developers.openai.com/api/docs/guides/admin-apis
// Needs an admin key; regular project keys are rejected.

export default {
  id: 'openai-api',
  name: 'OpenAI API',
  setup: 'Set OPENAI_ADMIN_KEY in .env. Optional: OPENAI_MONTHLY_BUDGET_USD.',
  configured: (env) => Boolean(env.OPENAI_ADMIN_KEY),

  async fetch(env, { signal, fetch }) {
    const now = new Date();
    const opts = { signal, fetch, headers: { authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` } };
    const buckets = await collectPages((page) => {
      const q = new URLSearchParams({
        start_time: String(Math.floor(monthStartUTC(now).getTime() / 1000)),
        bucket_width: '1d',
        limit: '31',
      });
      if (page) q.set('page', page);
      return `https://api.openai.com/v1/organization/costs?${q}`;
    }, opts);

    // amount.value may arrive as a number or a decimal string; dollars.
    const usd = sumResults(buckets, (r) => Number(r.amount?.value) || 0);
    return [{
      id: 'openai-spend',
      label: 'Spend this month',
      used: Math.round(usd * 100) / 100,
      limit: env.OPENAI_MONTHLY_BUDGET_USD || null,
      unit: 'USD',
      period: 'monthly',
      resetsAt: nextMonthStartUTC(now).toISOString(),
      note: env.OPENAI_MONTHLY_BUDGET_USD ? 'Limit is your budget from .env' : 'No budget set',
    }];
  },
};
