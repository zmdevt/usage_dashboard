// Shared test data.

// Shape from the Agent SDK's SDKUsageReport (usage_report.rate_limits.limits[]); values illustrative.
export const USAGE_STREAM = [
  { type: 'system', subtype: 'init', session_id: 's' },
  { type: 'assistant', usage_report: { rate_limits: { limits: [
    { kind: 'session', group: 'session', percent: 12, resets_at: '2026-10-19T15:00:00Z', scope: null, is_active: true },
    { kind: 'weekly_all', group: 'weekly', percent: 58, resets_at: '2026-10-23T09:00:00Z', scope: null },
    { kind: 'weekly_scoped', group: 'weekly', percent: 5, resets_at: '2026-10-23T09:00:00Z', scope: { model: { display_name: 'Fable' } } },
    { kind: 'something_new', percent: 3 },
  ], extra_usage: null } } },
  { type: 'result', subtype: 'success' },
].map((o) => JSON.stringify(o)).join('\n');
