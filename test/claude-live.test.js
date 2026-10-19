import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import claudePlan, { parseUsageReport } from '../providers/claude-plan.js';
import { USAGE_STREAM } from './fixtures.js';

test('parses usage_report limits into session, weekly and per-model meters', () => {
  const [s, w, f] = parseUsageReport(USAGE_STREAM);
  assert.deepEqual([s.id, s.used, s.period, s.resetsAt], ['claude-5h', 12, '5h', '2026-10-19T15:00:00.000Z']);
  assert.deepEqual([w.id, w.used], ['claude-7d', 58]);
  assert.deepEqual([f.id, f.label, f.used], ['claude-7d-fable', 'Weekly limit (Fable)', 5]);
  assert.equal(parseUsageReport(USAGE_STREAM).length, 3);
  assert.match(s.note, /live/);
});

test('also accepts the get_usage window shape', () => {
  const out = JSON.stringify({ type: 'control_response', response: { rate_limits: {
    five_hour: { utilization: 33, resets_at: '2026-10-19T15:00:00Z' }, seven_day: { utilization: null, resets_at: null },
  } } });
  const meters = parseUsageReport(out);
  assert.deepEqual(meters.map((m) => [m.id, m.used]), [['claude-5h', 33]]);
});

test('explains when Claude Code returns no plan limits', () => {
  assert.throws(() => parseUsageReport('{"type":"result"}\n'), /no plan limits/);
});

test('falls back to the status-line capture when the live check fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ud-cl-live-'));
  try {
    const file = join(dir, 'cl.json');
    await writeFile(file, JSON.stringify({ capturedAt: '2026-10-19T08:00:00Z', rate_limits: { five_hour: { used_percentage: 20, resets_at: 1792400000 } } }));
    const bin = join(dir, 'claude');
    await writeFile(bin, '#!/bin/sh\necho "not logged in" >&2\nexit 1\n');
    await chmod(bin, 0o755);
    const env = { CLAUDE_USAGE_CLI: 'on', CLAUDE_BIN: bin, CLAUDE_STATUSLINE_FILE: file };
    assert.equal(claudePlan.configured(env), true);
    const [m] = await claudePlan.fetch(env);
    assert.equal(m.used, 20);
    assert.equal(m.updatedAt, '2026-10-19T08:00:00Z');
    assert.match(m.note, /live check failed: claude failed: not logged in/);

    // Live route wins when it works.
    await writeFile(bin, `#!/bin/sh\ncat <<'EOF'\n${USAGE_STREAM}\nEOF\n`);
    const live = await claudePlan.fetch(env);
    assert.deepEqual(live.map((x) => x.used), [12, 58, 5]);
  } finally {
    await rm(dir, { recursive: true });
  }
});
