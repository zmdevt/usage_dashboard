import { test } from 'node:test';
import assert from 'node:assert/strict';
import glm, { parseLimits } from '../providers/glm-coding.js';

// Fixtures follow the shapes in Z.ai's plugin and CodexBar's tests; not live captures.
const TOKEN_PLAN = {
  level: 'pro',
  limits: [
    { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 25, nextResetTime: 1785816000000 },
    { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 9, nextResetTime: 1786291200000 },
    { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 1000, currentValue: 224, remaining: 776, percentage: 22 },
  ],
};
const CREDIT_PLAN = {
  level: 'lite',
  limits: [
    { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 100, percentage: 5, nextResetTime: 1786073946574 },
    { type: 'MYSTERY_LIMIT', unit: 9, number: 9, percentage: 50 },
  ],
};

const ok = (data) => ({ code: 200, msg: 'success', success: true, data });

test('glm maps token-plan windows to percent meters and MCP calls to counts', () => {
  const [h5, week, tools] = parseLimits(TOKEN_PLAN);
  assert.deepEqual([h5.id, h5.used, h5.limit, h5.unit], ['glm-5h', 25, 100, '%']);
  assert.equal(h5.resetsAt, new Date(1785816000000).toISOString());
  assert.equal(week.id, 'glm-weekly');
  assert.deepEqual([tools.used, tools.limit, tools.unit, tools.resetsAt], [224, 1000, 'calls', null]);
  assert.match(h5.note, /Plan: pro/);
});

test('glm uses counts for credit plans and skips unknown limit types', () => {
  const meters = parseLimits(CREDIT_PLAN);
  assert.equal(meters.length, 1);
  assert.deepEqual([meters[0].used, meters[0].limit, meters[0].unit], [100, 2000, 'credits']);
});

test('glm sends the bare key, retries with Bearer on 401, and picks the region host', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (!init.headers.authorization.startsWith('Bearer ')) return new Response('{"msg":"unauthorized"}', { status: 401 });
    return new Response(JSON.stringify(ok(TOKEN_PLAN)), { status: 200 });
  };
  const meters = await glm.fetch({ ZAI_API_KEY: 'k1', ZAI_REGION: 'cn' }, { fetch: f });
  assert.equal(meters.length, 3);
  assert.deepEqual(calls.map((c) => c.auth), ['k1', 'Bearer k1']);
  assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
});

test('glm surfaces API-level errors without the key', async () => {
  const f = async () => new Response(JSON.stringify({ code: 1001, msg: 'token expired', success: false }), { status: 200 });
  await assert.rejects(glm.fetch({ ZAI_API_KEY: 'SECRET' }, { fetch: f }), (e) => {
    assert.match(e.message, /1001: token expired/);
    assert.doesNotMatch(e.message, /SECRET/);
    return true;
  });
});
