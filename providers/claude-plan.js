import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isOn } from './chatgpt-codex.js';

// Claude Pro/Max plan limits. Two sources, both through Claude Code itself,
// so this code never reads or sends a Claude login token:
//
// 1. CLAUDE_USAGE_CLI=on: runs `claude -p "/usage" --output-format stream-json`
//    and reads the `usage_report` Claude Code attaches (Agent SDK >= 0.3.273,
//    marked experimental). /usage is a local command, so it should not spend
//    plan usage. Fresh on every dashboard refresh, including desktop-app use.
// 2. Fallback: the status-line capture from scripts/claude-statusline.mjs,
//    as fresh as your last interactive Claude Code reply.

const DEFAULT_FILE = fileURLToPath(new URL('../data/claude-statusline.json', import.meta.url));
const fileFor = (env) => env.CLAUDE_STATUSLINE_FILE || DEFAULT_FILE;
const ARGS = ['-p', '/usage', '--output-format', 'stream-json', '--verbose'];

const WINDOWS = [
  ['five_hour', 'claude-5h', 'Current session (5-hour)', '5h'],
  ['seven_day', 'claude-7d', 'Weekly limit', 'weekly'],
];

export default {
  id: 'claude-plan',
  name: 'Claude plan',
  setup: 'Run npm run connect with Claude Code installed and signed in to Pro/Max.',
  configured: (env) => isOn(env.CLAUDE_USAGE_CLI) || existsSync(fileFor(env)),
  timeoutMs: 45_000,

  async fetch(env, { signal } = {}) {
    if (!isOn(env.CLAUDE_USAGE_CLI)) return fromStatusLine(env);
    try {
      return parseUsageReport(await runClaude(env.CLAUDE_BIN || 'claude', signal));
    } catch (e) {
      if (!existsSync(fileFor(env))) throw e;
      const meters = await fromStatusLine(env);
      return meters.map((m) => ({ ...m, note: `${m.note} · live check failed: ${e.message}` }));
    }
  },
};

export function runClaude(bin, signal) {
  return new Promise((resolve, reject) => {
    execFile(bin, ARGS, { signal, cwd: homedir(), timeout: 40_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new Error('claude not found; install Claude Code or set CLAUDE_BIN'));
      if (err && !stdout) return reject(new Error(`claude failed: ${String(stderr || err.message).trim().slice(0, 200)}`));
      resolve(stdout);
    });
  });
}

// Finds the plan limits in Claude Code's stream-json output. Accepts the
// documented `usage_report.rate_limits.limits[]` shape and the
// `rate_limits.{five_hour,seven_day}` shape the SDK's get_usage returns.
export function parseUsageReport(stdout) {
  const now = new Date().toISOString();
  for (const line of String(stdout).split('\n')) {
    if (!line.includes('rate_limits')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const rl = findKey(obj, 'rate_limits');
    if (!rl) continue;
    const meters = Array.isArray(rl.limits) ? fromLimits(rl.limits) : fromWindows(rl);
    if (meters.length) return meters.map((m) => ({ ...m, updatedAt: now, note: 'live from Claude Code /usage' }));
  }
  throw new Error('Claude Code returned no plan limits; check it is signed in with Pro/Max (not an API key)');
}

function fromLimits(limits) {
  const out = [];
  for (const l of limits) {
    if (typeof l?.percent !== 'number') continue;
    let def;
    if (l.kind === 'session') def = { id: 'claude-5h', label: 'Current session (5-hour)', period: '5h' };
    else if (l.kind === 'weekly_all') def = { id: 'claude-7d', label: 'Weekly limit', period: 'weekly' };
    else if (l.kind === 'weekly_scoped') {
      const name = l.scope?.model?.display_name || l.scope?.surface || 'scoped';
      def = { id: `claude-7d-${slug(name)}`, label: `Weekly limit (${name})`, period: 'weekly' };
    } else continue;
    out.push({ ...def, used: l.percent, limit: 100, unit: '%', resetsAt: toIso(l.resets_at) });
  }
  return out;
}

function fromWindows(rl) {
  return WINDOWS.filter(([key]) => typeof rl[key]?.utilization === 'number').map(([key, id, label, period]) => ({
    id, label, period, used: rl[key].utilization, limit: 100, unit: '%', resetsAt: toIso(rl[key].resets_at),
  }));
}

async function fromStatusLine(env) {
  const { capturedAt, rate_limits: rl = {} } = JSON.parse(await readFile(fileFor(env), 'utf8'));
  if (!WINDOWS.some(([key]) => rl[key])) {
    throw new Error('Claude Code ran the status line but sent no plan limits. Send a message in Claude Code; if this stays, check /status shows a Pro or Max login, not an API key.');
  }
  return WINDOWS.filter(([key]) => rl[key]).map(([key, id, label, period]) => ({
    id,
    label,
    used: rl[key].used_percentage,
    limit: 100,
    unit: '%',
    period,
    resetsAt: toIso(rl[key].resets_at),
    updatedAt: capturedAt,
    note: 'from your last Claude Code reply',
  }));
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (obj[key] && typeof obj[key] === 'object') return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findKey(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Status line sends epoch seconds; /usage sends ISO strings. Accept both.
function toIso(v) {
  if (v == null) return null;
  const t = typeof v === 'number' ? v * (v < 1e12 ? 1000 : 1) : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
