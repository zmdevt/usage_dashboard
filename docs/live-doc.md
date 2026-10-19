# Live document: usage-dashboard

## Current focus
Build v0.1: a local web app that consolidates usage limits across AI subscriptions.

## Decisions
- Scope: AI chat plans (Claude, ChatGPT, Gemini, Perplexity) and AI/dev APIs (Anthropic, OpenAI, GitHub Copilot, Cursor).
- Retrieval: official APIs where they exist; manual entry for the rest. No session scraping (fragile, ToS risk).
- Form: local Node server with zero dependencies. Binds to 127.0.0.1. API keys stay in `.env` on the server side.
- Data model: every source returns "meters" (used / limit / unit / resetsAt). Status thresholds: warning at 75%, critical at 90%.
- Manual meters whose reset time has passed show as "stale" rather than auto-zeroing, because some windows (for example Claude's 5-hour session) start on first use, not on a fixed clock.

- Claude Pro/Max is automatic: a Claude Code status-line script saves `rate_limits.five_hour` and `seven_day` (an official field) for the dashboard. The manual Claude preset stays for people who don't use Claude Code.
- Not used: the undocumented `api.anthropic.com/api/oauth/usage` endpoint. Anthropic's legal page bars third parties from collecting or intermediating Claude.ai tokens, it rate-limits heavily, and the status line covers the same windows (decided 2026-10-19). The configured rate-limit endpoints were also skipped, because they report limits but not consumption.
- Consumer plans are linked through each vendor's own CLI: ChatGPT reads the Codex login read-only (never refreshes, since Codex rotates refresh tokens); Gemini runs `agy` (Gemini CLI login was discontinued for consumer plans 2026-06-18 and its terms forbid reuse). Both are opt-in in `.env`.
- GLM Coding Plan uses the quota endpoint Z.ai's own plugin calls, with the plan's API key.

## Status (2026-10-19)
- ~~v0.1 built: 5 API providers, manual meters, and the UI. All 17 tests pass.~~ Superseded.
- v0.3: vertical layout (connected providers only), `npm run connect` for CLI logins. 34 tests pass.
- v0.2: 8 providers (adds GLM, ChatGPT via Codex, Gemini via agy). All 29 tests pass. Not yet run against real credentials.
- Earlier note: Screenshots checked in light mode, and in dark mode at 390px width.

## Working assumptions
- API spend has no hard limit the APIs report, so API meters show month-to-date usage. A budget can be set in `.env` to turn it into used/limit.

## Open questions
- ~~Which GitHub repo to push to.~~ Resolved: public repo https://github.com/zmdevt/usage_dashboard, MIT license, commits use the GitHub no-reply email.
- Whether to add alerts (desktop or email) when a meter crosses a threshold.

## Risks
- Provider endpoints and plan limits change often. Each provider is isolated in `providers/`, so a break shows as one error card.

## Next steps
- ~~Wire the provider modules once endpoint research is verified.~~ Done (superseded).
- Validate each provider against a real key; the medium-confidence fields are listed in the README.
- ~~Push to GitHub once the user picks a repo.~~ Done 2026-10-19 (superseded).
- ~~Portfolio polish: add a screenshot to the README.~~ Done 2026-10-19 (superseded).
- Run locally with one real API key to confirm the medium-confidence provider fields.
- Run with real Codex and agy logins to confirm the ChatGPT and Gemini parsers. `npm run connect` (added 2026-10-19) checks the logins and wires the providers; its agy output is the first real sample to check the parser against.
