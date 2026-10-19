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
- Not used: the undocumented `api.anthropic.com/api/oauth/usage` endpoint (unofficial, unstable shape). The configured rate-limit endpoints were also skipped, because they report limits but not consumption.

## Status (2026-10-19)
- v0.1 built: 5 API providers, manual meters, and the UI. All 17 tests pass. Screenshots checked in light mode, and in dark mode at 390px width.

## Working assumptions
- API spend has no hard limit the APIs report, so API meters show month-to-date usage. A budget can be set in `.env` to turn it into used/limit.

## Open questions
- Which GitHub repo to push to.
- Whether to add alerts (desktop or email) when a meter crosses a threshold.

## Risks
- Provider endpoints and plan limits change often. Each provider is isolated in `providers/`, so a break shows as one error card.

## Next steps
- ~~Wire the provider modules once endpoint research is verified.~~ Done (superseded).
- Validate each provider against a real key; the medium-confidence fields are listed in the README.
- Push to GitHub once the user picks a repo.
