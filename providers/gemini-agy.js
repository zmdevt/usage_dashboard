import { execFile } from 'node:child_process';
import { isOn } from './chatgpt-codex.js';

// Gemini (Google AI Pro/Ultra/free) limits via Google's Antigravity CLI.
// Google ended Gemini CLI's Google-account login for these plans on
// 2026-06-18, and its terms forbid other tools reusing that login, so this
// runs `agy` itself and lets it handle its own sign-in.
// Output shape taken from one open-source client (steipete/CodexBar); unverified.

const ARGS = ['-p', '/usage', '--output-format', 'json', '--print-timeout', '45s'];
const PERIODS = { '5h': '5h', weekly: 'weekly', daily: 'daily' };

export default {
  id: 'gemini-agy',
  unofficial: true,
  name: 'Gemini',
  setup: 'Install and sign in to the Antigravity CLI (agy), then set GEMINI_AGY=on in .env. Optional: AGY_BIN for a custom path.',
  configured: (env) => isOn(env.GEMINI_AGY),
  timeoutMs: 60_000,

  async fetch(env, { signal }) {
    const out = await run(env.AGY_BIN || 'agy', ARGS, signal);
    return parseAgy(out);
  },
};

function run(bin, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { signal, timeout: 55_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new Error('agy not found; install the Antigravity CLI or set AGY_BIN'));
      if (err && !stdout) return reject(new Error(`agy failed: ${String(stderr || err.message).trim().slice(0, 200)}`));
      resolve(stdout);
    });
  });
}

export function parseAgy(stdout) {
  // Tolerate banner text before the JSON.
  const start = String(stdout).indexOf('{');
  let body;
  try {
    body = JSON.parse(String(stdout).slice(start));
  } catch {
    throw new Error('agy printed no JSON; is it signed in?');
  }
  if (body.status && body.status !== 'SUCCESS') throw new Error(`agy returned ${body.status}`);

  const meters = [];
  for (const group of body.command?.data?.groups || []) {
    for (const b of group.buckets || []) {
      if (typeof b.remaining_fraction !== 'number') continue;
      const window = b.window || b.id || 'window';
      meters.push({
        id: `agy-${slug(group.name)}-${slug(window)}`,
        label: `${group.name || 'Models'}: ${windowLabel(window)}`,
        used: Math.round((1 - b.remaining_fraction) * 1000) / 10,
        limit: 100,
        unit: '%',
        period: PERIODS[window] || 'none',
        resetsAt: b.reset_time || null,
        note: 'Via Antigravity CLI',
      });
    }
  }
  if (meters.length === 0) throw new Error('no usage buckets in agy output');
  return meters;
}

const windowLabel = (w) => (w === '5h' ? '5-hour window' : w === 'weekly' ? 'Weekly limit' : w);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
