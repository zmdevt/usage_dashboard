import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeMeter } from '../lib/meter.js';
import { ManualStore, ValidationError, validate } from '../lib/manual-store.js';
import { createCollector } from '../lib/collect.js';

test('makeMeter computes ratio and status thresholds', () => {
  assert.equal(makeMeter({ used: 10, limit: 100 }).status, 'ok');
  assert.equal(makeMeter({ used: 75, limit: 100 }).status, 'warning');
  assert.equal(makeMeter({ used: 95, limit: 100 }).status, 'critical');
  assert.equal(makeMeter({ used: 5 }).status, 'info');
  assert.equal(makeMeter({}).status, 'unknown');
  assert.equal(makeMeter({ used: 1, limit: 4 }).ratio, 0.25);
});

test('makeMeter marks meters whose reset time has passed as stale', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(makeMeter({ used: 99, limit: 100, resetsAt: past }).status, 'stale');
  assert.equal(makeMeter({ used: 99, limit: 100, resetsAt: future }).status, 'critical');
});

test('validate rejects bad manual input', () => {
  assert.throws(() => validate({ label: 'x' }), ValidationError);
  assert.throws(() => validate({ provider: 'x', label: 'y', used: -1 }), ValidationError);
  assert.throws(() => validate({ provider: 'x', label: 'y', period: 'hourly' }), ValidationError);
  assert.throws(() => validate({ provider: 'x', label: 'y', resetsAt: 'nope' }), ValidationError);
  const ok = validate({ provider: ' Claude ', label: 'Weekly', used: '40', limit: 100, period: 'weekly' });
  assert.equal(ok.provider, 'Claude');
  assert.equal(ok.used, 40);
  assert.ok(ok.id);
});

test('ManualStore upserts, lists and removes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ud-'));
  try {
    const store = new ManualStore(join(dir, 'm.json'));
    assert.deepEqual(await store.list(), []);
    const a = await store.upsert({ provider: 'Claude', label: 'Weekly', used: 10, limit: 100 });
    await store.upsert({ ...a, used: 20 });
    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].used, 20);
    assert.equal(await store.remove(a.id), true);
    assert.equal(await store.remove(a.id), false);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('collector isolates provider failures and skips unconfigured ones', async () => {
  const store = { list: async () => [{ id: 'm1', provider: 'Gemini', label: 'Prompts', used: 3, limit: 10 }] };
  const providers = [
    { id: 'good', name: 'Good', envKeys: ['G'], configured: () => true, fetch: async () => [{ id: 'g', label: 'Spend', used: 1, limit: 2 }] },
    { id: 'bad', name: 'Bad', envKeys: ['B'], configured: () => true, fetch: async () => { throw new Error('401 unauthorized'); } },
    { id: 'off', name: 'Off', setup: 'set O', configured: () => false, fetch: async () => [] },
  ];
  const collect = createCollector({ providers, store, env: {} });
  const out = await collect();
  const byId = Object.fromEntries(out.providers.map((p) => [p.id, p]));
  assert.equal(byId.good.state, 'ok');
  assert.equal(byId.good.meters[0].ratio, 0.5);
  assert.equal(byId.bad.state, 'error');
  assert.match(byId.bad.error, /401/);
  assert.equal(byId.off.state, 'not_configured');
  assert.equal(byId.off.setup, 'set O');
  assert.equal(out.manual[0].source, 'manual');
});

test('collector caches API results until forced', async () => {
  let calls = 0;
  const providers = [{ id: 'p', name: 'P', envKeys: [], configured: () => true, fetch: async () => { calls++; return []; } }];
  const collect = createCollector({ providers, store: { list: async () => [] }, env: {} });
  await collect();
  await collect();
  assert.equal(calls, 1);
  await collect({ force: true });
  assert.equal(calls, 2);
});
