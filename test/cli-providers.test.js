import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import chatgpt, { parseUsage } from '../providers/chatgpt-codex.js';
import gemini, { parseAgy } from '../providers/gemini-agy.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `h.${b64(claims)}.s`;
const future = Math.floor(Date.now() / 1000) + 3600;

// Shape from openai/codex rate_limit_status_payload; values illustrative.
const USAGE = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: future },
    secondary_window: { used_percent: 81, limit_window_seconds: 604800, reset_after_seconds: 7200 },
  },
  credits: { has_credits: true, unlimited: false, balance: '42' },
};

async function codexHome(auth) {
  const dir = await mkdtemp(join(tmpdir(), 'ud-codex-'));
  await writeFile(join(dir, 'auth.json'), JSON.stringify(auth));
  return dir;
}

test('chatgpt parses primary and secondary windows', () => {
  const [h5, week] = parseUsage(USAGE);
  assert.deepEqual([h5.id, h5.label, h5.used, h5.period], ['chatgpt-primary', '5-hour window', 12, '5h']);
  assert.equal(h5.resetsAt, new Date(future * 1000).toISOString());
  assert.deepEqual([week.label, week.used], ['Weekly limit', 81]);
  assert.ok(Date.parse(week.resetsAt) > Date.now());
  assert.match(h5.note, /Plan: plus · Credits: 42/);
});

test('chatgpt sends token and account id, and never writes auth.json', async () => {
  const auth = { auth_mode: 'chatgpt', tokens: { access_token: jwt({ exp: future }), refresh_token: 'r', account_id: 'acct_1' } };
  const dir = await codexHome(auth);
  try {
    const before = await readFile(join(dir, 'auth.json'), 'utf8');
    let seen;
    const f = async (url, init) => {
      seen = { url, headers: init.headers };
      return new Response(JSON.stringify(USAGE), { status: 200 });
    };
    const meters = await chatgpt.fetch({ CODEX_HOME: dir }, { fetch: f });
    assert.equal(meters.length, 2);
    assert.equal(seen.url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(seen.headers.authorization, `Bearer ${auth.tokens.access_token}`);
    assert.equal(seen.headers['chatgpt-account-id'], 'acct_1');
    assert.equal(await readFile(join(dir, 'auth.json'), 'utf8'), before);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('chatgpt falls back to the id_token account claim', async () => {
  const dir = await codexHome({ tokens: {
    access_token: jwt({ exp: future }),
    id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_from_jwt' } }),
  } });
  try {
    let id;
    const f = async (_u, init) => { id = init.headers['chatgpt-account-id']; return new Response(JSON.stringify(USAGE)); };
    await chatgpt.fetch({ CODEX_HOME: dir }, { fetch: f });
    assert.equal(id, 'acct_from_jwt');
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('chatgpt refuses expired, API-key and missing logins without calling the network', async () => {
  const f = async () => { throw new Error('network should not be called'); };
  const cases = [
    [{ tokens: { access_token: jwt({ exp: 1 }) } }, /expired; run codex/],
    [{ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x', tokens: null }, /API key/],
  ];
  for (const [auth, re] of cases) {
    const dir = await codexHome(auth);
    try {
      await assert.rejects(chatgpt.fetch({ CODEX_HOME: dir }, { fetch: f }), re);
    } finally {
      await rm(dir, { recursive: true });
    }
  }
  await assert.rejects(chatgpt.fetch({ CODEX_HOME: '/nonexistent-ud' }, { fetch: f }), /not found/);
});

test('chatgpt maps a 401 to a refresh hint without leaking the token', async () => {
  const token = jwt({ exp: future, secret: 'SECRET' });
  const dir = await codexHome({ tokens: { access_token: token } });
  try {
    const f = async () => new Response('{"error":{"message":"bad token"}}', { status: 401 });
    await assert.rejects(chatgpt.fetch({ CODEX_HOME: dir }, { fetch: f }), (e) => {
      assert.match(e.message, /run codex once/);
      assert.ok(!e.message.includes(token));
      return true;
    });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('chatgpt is off unless CHATGPT_USAGE is on', () => {
  assert.equal(chatgpt.configured({}), false);
  assert.equal(chatgpt.configured({ CHATGPT_USAGE: 'on' }), true);
});

// Shape from CodexBar's AntigravityCLIUsageReportTests fixture.
const AGY = {
  status: 'SUCCESS',
  command: { name: 'usage', data: { groups: [
    { name: 'Gemini Models', buckets: [
      { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.86, reset_time: '2026-10-24T18:40:27Z' },
      { id: 'gemini-5h', window: '5h', remaining_fraction: 0.05, reset_time: '2026-10-19T15:48:04Z' },
    ] },
  ] } },
};

test('gemini parses agy buckets into used percentages', () => {
  const [week, h5] = parseAgy(`Antigravity v1.2\n${JSON.stringify(AGY)}`);
  assert.deepEqual([week.label, week.used, week.period], ['Gemini Models: Weekly limit', 14, 'weekly']);
  assert.deepEqual([h5.id, h5.used], ['agy-gemini-models-5h', 95]);
  assert.throws(() => parseAgy('please sign in'), /no JSON/);
  assert.throws(() => parseAgy('{"status":"ERROR"}'), /ERROR/);
});

test('gemini runs the agy binary and reports a missing one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ud-agy-'));
  try {
    const bin = join(dir, 'agy');
    await writeFile(bin, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(AGY))});\n`);
    await chmod(bin, 0o755);
    const meters = await gemini.fetch({ AGY_BIN: bin }, {});
    assert.equal(meters.length, 2);
    await assert.rejects(gemini.fetch({ AGY_BIN: join(dir, 'missing') }, {}), /agy not found/);
  } finally {
    await rm(dir, { recursive: true });
  }
});
