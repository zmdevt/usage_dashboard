import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Claude Pro/Max plan limits, captured by scripts/claude-statusline.mjs from
// Claude Code's official status-line input. There is no public REST API for
// consumer plan usage; this file is only as fresh as your last Claude Code turn.

const DEFAULT_FILE = fileURLToPath(new URL('../data/claude-statusline.json', import.meta.url));
const fileFor = (env) => env.CLAUDE_STATUSLINE_FILE || DEFAULT_FILE;

const WINDOWS = [
  ['five_hour', 'claude-5h', 'Current session (5-hour)', '5h'],
  ['seven_day', 'claude-7d', 'Weekly limit', 'weekly'],
];

export default {
  id: 'claude-plan',
  name: 'Claude plan',
  setup: 'Point Claude Code\'s statusLine at scripts/claude-statusline.mjs (see README). Pro/Max only.',
  configured: (env) => existsSync(fileFor(env)),

  async fetch(env) {
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
      // resets_at is Unix epoch seconds.
      resetsAt: rl[key].resets_at ? new Date(rl[key].resets_at * 1000).toISOString() : null,
      updatedAt: capturedAt,
      note: 'from your last Claude Code reply',
    }));
  },
};
