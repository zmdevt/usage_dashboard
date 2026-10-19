#!/usr/bin/env node
// Claude Code status-line command. Claude Code pipes session JSON to stdin;
// for Pro/Max subscribers it includes rate_limits.five_hour / seven_day.
// This script saves that block for the dashboard and prints a short line.
// Docs: https://code.claude.com/docs/en/statusline
//
// ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node /abs/path/usage-dashboard/scripts/claude-statusline.mjs" }

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.env.CLAUDE_STATUSLINE_FILE
  || fileURLToPath(new URL('../data/claude-statusline.json', import.meta.url));

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {}

  // Every run records lastRunAt, so the dashboard can tell "hook never ran"
  // apart from "ran but Claude Code sent no plan limits". The last good
  // limits are kept when a run carries none (e.g. before the first reply).
  const rl = data.rate_limits;
  const fresh = rl && (rl.five_hour || rl.seven_day);
  try {
    let saved = {};
    try {
      saved = JSON.parse(readFileSync(target, 'utf8'));
    } catch {}
    const now = new Date().toISOString();
    const next = fresh ? { ...saved, capturedAt: now, rate_limits: rl, lastRunAt: now } : { ...saved, lastRunAt: now };
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next));
    renameSync(tmp, target);
  } catch {}

  const parts = [data.model?.display_name || 'Claude'];
  if (rl?.five_hour) parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
  if (rl?.seven_day) parts.push(`7d ${Math.round(rl.seven_day.used_percentage)}%`);
  process.stdout.write(parts.join(' · '));
});
