# usage-dashboard

One local page that shows how close you are to every usage limit across your AI subscriptions and APIs.

## Sources

| Service | How | Shows |
|---|---|---|
| Claude Pro/Max | Claude Code status line (official) | 5-hour session %, weekly % |
| Anthropic API | Admin API: cost and usage reports | Month-to-date spend, tokens |
| OpenAI API | Admin API: organization costs | Month-to-date spend |
| GitHub Copilot | Billing usage API, AI credits | Credits used vs plan allotment |
| Cursor (team) | Admin API `/teams/spend` | Cycle spend, included-usage % |
| ChatGPT, Gemini, Perplexity, Cursor individual | Manual entry | Whatever you copy from their usage page |

Consumer chat plans have no official usage API. Manual meters cover them; nothing is scraped.

## Run

Requires Node 20 or later. No dependencies.

```sh
cp .env.example .env   # fill in the keys you have
npm start              # http://127.0.0.1:4317
npm test
```

The server binds to 127.0.0.1 only and rejects foreign Host headers. Keys never reach the browser.

## Claude Pro/Max setup

Add this to `~/.claude/settings.json`, using the absolute path to this repo:

```json
"statusLine": { "type": "command", "command": "node /abs/path/usage-dashboard/scripts/claude-statusline.mjs" }
```

Each Claude Code turn then saves your plan limits to `data/claude-statusline.json`. The script also prints a short status line: model, 5h %, 7d %. This replaces any status line you already have.

The data is only as fresh as your last Claude Code turn. Usage from claude.ai on other devices shows up the next time Claude Code runs.

## Meter status

| Status | Rule |
|---|---|
| warning | 75% or more used |
| critical | 90% or more used |
| stale | reset time has passed; the value is out of date |

API spend has no hard limit that the APIs report. Set a `*_MONTHLY_BUDGET_USD` value to turn spend into used / limit.

## Known uncertainty

These provider endpoints were checked against official docs on 2026-10-19. Some details were confirmed only from summaries of those docs:

| Provider | Uncertain detail |
|---|---|
| OpenAI | The type of `amount.value` in the cost results. |
| GitHub | The `ai_credit/usage` response fields. Credits are computed as gross USD / $0.01. |
| GitHub | Plan allotments: Pro 1,500, Pro+ 7,000, Max 20,000. GitHub says the flex part may change. |
| Cursor | Cursor's docs lag its live schema. |

Each provider reads fields defensively. A provider that fails shows as one error card and does not affect the others.

## Add a provider

Create `providers/<name>.js` exporting `{ id, name, setup, configured(env), fetch(env, { signal, fetch }) }`. `fetch` returns meters: `{ id, label, used, limit, unit, period, resetsAt, note }`. Then register it in `providers/index.js`.

## License

MIT
