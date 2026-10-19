#!/usr/bin/env node
// Connects the CLI-based providers on this machine:
//   Claude Code  -> adds the status-line hook to ~/.claude/settings.json (asks first, keeps a backup)
//   Codex        -> checks for a ChatGPT login, then sets CHATGPT_USAGE=on
//   Antigravity  -> runs `agy -p /usage`, then sets GEMINI_AGY=on
// Read-only towards every login: it never prints, copies or refreshes a token.
//
// Usage: npm run connect [-- --yes]

import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { parseAgy } from '../providers/gemini-agy.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATUSLINE_SCRIPT = join(ROOT, 'scripts', 'claude-statusline.mjs');

// ---------- pure helpers (tested) ----------

// Sets KEY=value in .env text, replacing an existing line or appending one.
export function setEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
}

export function statusLineCommand(script = STATUSLINE_SCRIPT) {
  return `node "${script}"`;
}

// Returns what adding our status line to Claude settings would do.
export function planStatusLine(settings, command) {
  const current = settings.statusLine;
  if (current?.command === command) return { action: 'none' };
  return {
    action: current ? 'replace' : 'add',
    previous: current?.command,
    next: { ...settings, statusLine: { type: 'command', command } },
  };
}

// Checks the Codex login file without exposing its contents.
export function checkCodexLogin(env = process.env) {
  const path = join(env.CODEX_HOME || join(env.HOME || homedir(), '.codex'), 'auth.json');
  if (!existsSync(path)) return { ok: false, reason: 'no login file. Run `codex` and choose "Sign in with ChatGPT". If you did, Codex may be keeping the login in the Keychain; switch it to file storage.' };
  let auth;
  try {
    auth = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, reason: `could not read ${path}` };
  }
  if (auth.tokens?.access_token) return { ok: true };
  return { ok: false, reason: 'Codex is signed in with an API key. Sign out, run `codex` again and choose "Sign in with ChatGPT".' };
}

// ---------- side-effecting steps ----------

const has = (bin, args = ['--version']) => spawnSync(bin, args, { stdio: 'ignore', timeout: 10_000 }).error?.code !== 'ENOENT';

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function connectClaude(ask) {
  if (!has('claude')) return ['Claude', 'skipped', 'Claude Code is not installed'];
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const path = join(dir, 'settings.json');
  let settings = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return ['Claude', 'action needed', `${path} is not valid JSON; left untouched`];
    }
  }
  const plan = planStatusLine(settings, statusLineCommand());
  if (plan.action === 'none') return ['Claude', 'connected', 'status line already set'];

  console.log(`\nClaude Code: add the usage status line to ${path}`);
  if (plan.previous) console.log(`  This replaces your current status line: ${plan.previous}`);
  if (!(await ask('  Proceed? [y/N] '))) return ['Claude', 'skipped', 'you declined the settings change'];

  if (existsSync(path)) {
    const backup = `${path}.bak-${Date.now()}`;
    copyFileSync(path, backup);
    console.log(`  Backup saved: ${backup}`);
  }
  writeAtomic(path, `${JSON.stringify(plan.next, null, 2)}\n`);
  return ['Claude', 'connected', 'send one message in Claude Code to load your limits (Pro/Max login needed)'];
}

function connectCodex(setEnv) {
  if (!has('codex')) return ['ChatGPT', 'skipped', 'Codex CLI not installed (npm i -g @openai/codex)'];
  const check = checkCodexLogin();
  if (!check.ok) return ['ChatGPT', 'action needed', check.reason];
  setEnv('CHATGPT_USAGE', 'on');
  return ['ChatGPT', 'connected', 'Codex ChatGPT login found'];
}

function connectGemini(setEnv) {
  const bin = process.env.AGY_BIN || 'agy';
  console.log('\nChecking Antigravity (this can take up to a minute)…');
  const r = spawnSync(bin, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '45s'], { encoding: 'utf8', timeout: 60_000 });
  if (r.error?.code === 'ENOENT') return ['Gemini', 'skipped', 'Antigravity CLI (agy) not installed'];
  try {
    const meters = parseAgy(r.stdout || '');
    setEnv('GEMINI_AGY', 'on');
    return ['Gemini', 'connected', meters.map((m) => `${m.label} ${m.used}%`).join(', ')];
  } catch (e) {
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().slice(0, 600);
    if (out) console.log(`\nagy printed:\n${out}\n`);
    return ['Gemini', 'action needed', `${e.message}. Run \`agy\` to sign in, then retry. If you are signed in, share the agy output above.`];
  }
}

async function main() {
  const yes = process.argv.includes('--yes');
  const envPath = process.env.USAGE_DASHBOARD_ENV || join(ROOT, '.env');
  let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8')
    : existsSync(join(ROOT, '.env.example')) ? readFileSync(join(ROOT, '.env.example'), 'utf8') : '';
  let envChanged = !existsSync(envPath);
  const setEnv = (k, v) => {
    const next = setEnvLine(envText, k, v);
    envChanged ||= next !== envText;
    envText = next;
  };

  const rl = process.stdin.isTTY && !yes ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q) => {
    if (yes) return true;
    if (!rl) {
      console.log(`${q}no (not interactive; rerun with --yes to allow)`);
      return false;
    }
    return /^y(es)?$/i.test((await rl.question(q)).trim());
  };

  const results = [await connectClaude(ask), connectCodex(setEnv), connectGemini(setEnv)];
  rl?.close();
  if (envChanged) writeAtomic(envPath, envText);

  console.log('\nResult');
  for (const [name, state, detail] of results) console.log(`  ${name.padEnd(8)} ${state.padEnd(14)} ${detail}`);
  console.log('\nRestart the dashboard to apply: stop it with Ctrl+C, then npm start');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
