import { requestJson } from '../lib/http.js';

// GLM Coding Plan quota (Z.ai global, or Zhipu bigmodel.cn).
// Undocumented endpoint; it's the one Z.ai's own usage-query plugin calls
// (zai-org/zai-coding-plugins, plugins/glm-plan-usage). Uses the plan's API key.

const HOSTS = { global: 'https://api.z.ai', cn: 'https://open.bigmodel.cn' };

// [unit, number] pairs seen in Z.ai's plugin and two independent clients.
// Other combinations are unknown and skipped rather than guessed.
const WINDOWS = [
  { unit: 3, number: 5, id: 'glm-5h', label: '5-hour window', period: '5h' },
  { unit: 6, number: 1, id: 'glm-weekly', label: 'Weekly limit', period: 'weekly' },
];
const UNITS = { TOKENS_LIMIT: 'tokens', CREDIT_LIMIT: 'credits', TIME_LIMIT: 'calls' };

export default {
  id: 'glm-coding',
  name: 'GLM Coding Plan',
  setup: 'Set ZAI_API_KEY (your Coding Plan key) in .env. Set ZAI_REGION=cn for bigmodel.cn.',
  configured: (env) => Boolean(env.ZAI_API_KEY),

  async fetch(env, { signal, fetch }) {
    const host = HOSTS[env.ZAI_REGION] || HOSTS.global;
    const url = `${host}/api/monitor/usage/quota/limit`;
    const get = (authorization) => requestJson(url, {
      signal,
      fetch,
      headers: { authorization, 'accept-language': 'en-US,en' },
    });

    // Z.ai's plugin sends the bare key; some clients report Bearer also works.
    let body;
    try {
      body = await get(env.ZAI_API_KEY);
    } catch (e) {
      if (e.status !== 401) throw e;
      body = await get(`Bearer ${env.ZAI_API_KEY}`);
    }
    if (body?.code !== 200 || body.success === false) {
      throw new Error(`Z.ai returned ${body?.code ?? 'no code'}: ${body?.msg || 'unexpected response'}`);
    }
    return parseLimits(body.data);
  },
};

export function parseLimits(data = {}) {
  const plan = data.level ? `Plan: ${data.level}` : '';
  const meters = [];
  for (const l of data.limits || []) {
    let def;
    if (l.type === 'TIME_LIMIT') def = { id: 'glm-tools', label: 'MCP tool calls (monthly)', period: 'monthly' };
    else if (UNITS[l.type]) def = WINDOWS.find((w) => w.unit === l.unit && w.number === l.number);
    if (!def || meters.some((m) => m.id === def.id)) continue;

    // `usage` is the cap and `currentValue` the amount used; token plans
    // report only a percentage.
    const counts = Number(l.usage) > 0 && l.currentValue != null;
    meters.push({
      id: def.id,
      label: def.label,
      used: counts ? l.currentValue : l.percentage,
      limit: counts ? l.usage : 100,
      unit: counts ? UNITS[l.type] : '%',
      period: def.period,
      resetsAt: Number.isFinite(l.nextResetTime) ? new Date(l.nextResetTime).toISOString() : null,
      note: [plan, 'Unofficial endpoint'].filter(Boolean).join(' · '),
    });
  }
  if (meters.length === 0) throw new Error('no recognised limits in Z.ai response');
  return meters;
}
