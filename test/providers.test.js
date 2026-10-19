import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import anthropic from '../providers/anthropic-api.js';
import openai from '../providers/openai-api.js';
import copilot from '../providers/github-copilot.js';
import cursor from '../providers/cursor-team.js';
import claudePlan from '../providers/claude-plan.js';

// Fake fetch: routes by URL substring, records calls.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return new Response('{"error":{"message":"no route"}}', { status: 404 });
    const r = routes[key];
    const body = typeof r === 'function' ? r(String(url), init) : r;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  f.calls = calls;
  return f;
}

test('anthropic sums cost cents across pages and tokens across buckets', async () => {
  const f = fakeFetch({
    cost_report: (url) => url.includes('page=p2')
      ? { data: [{ results: [{ amount: '50.00', currency: 'USD' }] }], has_more: false }
      : { data: [{ results: [{ amount: '1234.5' }] }], has_more: true, next_page: 'p2' },
    'usage_report/messages': {
      data: [{ results: [{ uncached_input_tokens: 10, cache_read_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 2 }, output_tokens: 3 }] }],
      has_more: false,
    },
  });
  const meters = await anthropic.fetch({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-x', ANTHROPIC_MONTHLY_BUDGET_USD: '100' }, { fetch: f });
  assert.equal(meters[0].used, 12.85);
  assert.equal(meters[0].limit, '100');
  assert.equal(meters[1].used, 20);
  assert.equal(f.calls[0].init.headers['x-api-key'], 'sk-ant-admin-x');
});

test('openai sums daily cost buckets in dollars', async () => {
  const f = fakeFetch({ '/organization/costs': { data: [{ results: [{ amount: { value: 1.5, currency: 'usd' } }, { amount: { value: '2.25' } }] }], has_more: false } });
  const [m] = await openai.fetch({ OPENAI_ADMIN_KEY: 'k' }, { fetch: f });
  assert.equal(m.used, 3.75);
  assert.equal(m.limit, null);
  assert.match(f.calls[0].url, /start_time=\d+/);
});

test('copilot converts gross USD to credits and applies plan allotment', async () => {
  const f = fakeFetch({
    'ai_credit/usage': { usageItems: [{ product: 'Copilot', grossAmount: 4.2 }, { product: 'Actions', grossAmount: 9 }] },
  });
  const [m] = await copilot.fetch({ GITHUB_TOKEN: 't', GITHUB_USERNAME: 'me', COPILOT_PLAN: 'pro' }, { fetch: f });
  assert.equal(m.used, 420);
  assert.equal(m.limit, 1500);
});

test('cursor filters to one member and surfaces percent-used when present', async () => {
  const f = fakeFetch({
    '/teams/spend': {
      teamMemberSpend: [{ email: 'Me@x.com', spendCents: 1234, hardLimitOverrideDollars: 50, totalPercentUsed: 40 }, { email: 'o@x.com', spendCents: 1 }],
      totalPages: 1,
    },
  });
  const meters = await cursor.fetch({ CURSOR_ADMIN_KEY: 'key', CURSOR_EMAIL: 'me@x.com' }, { fetch: f });
  assert.equal(meters[0].used, 12.34);
  assert.equal(meters[0].limit, 50);
  assert.equal(meters[1].used, 40);
  assert.equal(f.calls[0].init.headers.authorization, `Basic ${Buffer.from('key:').toString('base64')}`);
});

test('http errors include status but not credentials', async () => {
  const f = async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 });
  await assert.rejects(anthropic.fetch({ ANTHROPIC_ADMIN_KEY: 'sk-ant-admin-SECRET' }, { fetch: f }), (e) => {
    assert.match(e.message, /401/);
    assert.doesNotMatch(e.message, /SECRET/);
    return true;
  });
});

test('status-line script captures rate limits and claude-plan reads them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ud-cl-'));
  try {
    const file = join(dir, 'cl.json');
    const resets = Math.floor(Date.now() / 1000) + 3600;
    const script = fileURLToPath(new URL('../scripts/claude-statusline.mjs', import.meta.url));
    const out = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 23.4, resets_at: resets }, seven_day: { used_percentage: 91, resets_at: resets + 86400 } } }),
      env: { ...process.env, CLAUDE_STATUSLINE_FILE: file },
      encoding: 'utf8',
    });
    assert.equal(out.stdout, 'Opus · 5h 23% · 7d 91%');
    assert.ok(JSON.parse(await readFile(file, 'utf8')).capturedAt);

    const env = { CLAUDE_STATUSLINE_FILE: file };
    assert.equal(claudePlan.configured(env), true);
    const meters = await claudePlan.fetch(env);
    assert.deepEqual(meters.map((m) => m.id), ['claude-5h', 'claude-7d']);
    assert.equal(meters[1].used, 91);
    assert.equal(meters[0].resetsAt, new Date(resets * 1000).toISOString());

    // No rate_limits (API-key users): file left untouched, line still printed.
    await writeFile(file, '{"capturedAt":"x","rate_limits":{}}');
    const out2 = spawnSync(process.execPath, [script], { input: '{}', env: { ...process.env, CLAUDE_STATUSLINE_FILE: file }, encoding: 'utf8' });
    assert.equal(out2.stdout, 'Claude');
    assert.equal(await readFile(file, 'utf8'), '{"capturedAt":"x","rate_limits":{}}');
  } finally {
    await rm(dir, { recursive: true });
  }
});
