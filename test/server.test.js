import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { ManualStore } from '../lib/manual-store.js';

let server, base, dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ud-srv-'));
  const env = { CLAUDE_STATUSLINE_FILE: join(dir, 'absent.json') };
  const app = createApp({ env, store: new ManualStore(join(dir, 'm.json')) });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true });
});

test('GET /api/usage lists providers as not configured with no keys', async () => {
  const res = await fetch(`${base}/api/usage`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.providers.length > 0);
  assert.ok(body.providers.every((p) => p.state === 'not_configured'));
});

test('manual meter round trip', async () => {
  const post = await fetch(`${base}/api/manual`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'Claude', label: 'Weekly limit', used: 80, limit: 100, unit: '%' }),
  });
  assert.equal(post.status, 200);
  const { id } = await post.json();
  const usage = await (await fetch(`${base}/api/usage`)).json();
  assert.equal(usage.manual[0].status, 'warning');
  assert.equal((await fetch(`${base}/api/manual/${id}`, { method: 'DELETE' })).status, 204);
});

test('rejects invalid manual input and non-JSON bodies', async () => {
  const bad = await fetch(`${base}/api/manual`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"label":"x"}' });
  assert.equal(bad.status, 400);
  const form = await fetch(`${base}/api/manual`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 400);
});

test('rejects foreign Host headers', async () => {
  const status = await new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: '127.0.0.1', port, path: '/api/usage', headers: { host: 'evil.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 421);
});

test('serves the UI and blocks path traversal', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  const res = await fetch(`${base}/..%2Fserver.js`);
  assert.notEqual(res.status, 200);
});
