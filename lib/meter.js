// A meter is one usage figure: "used X of Y <unit>, resets at T".
// Every provider, API-backed or manual, returns meters in this shape.

export const WARN_AT = 0.75;
export const CRIT_AT = 0.9;

export function makeMeter(m) {
  const used = toNum(m.used);
  const limit = toNum(m.limit);
  const ratio = used != null && limit ? used / limit : null;
  const resetsAt = m.resetsAt ? new Date(m.resetsAt).toISOString() : null;
  const expired = resetsAt != null && Date.parse(resetsAt) <= Date.now();

  let status = 'unknown';
  if (expired) status = 'stale';
  else if (ratio != null) status = ratio >= CRIT_AT ? 'critical' : ratio >= WARN_AT ? 'warning' : 'ok';
  else if (used != null) status = 'info';

  return {
    id: m.id,
    provider: m.provider,
    label: m.label,
    used,
    limit,
    unit: m.unit || '',
    ratio,
    status,
    period: m.period || null,
    resetsAt,
    source: m.source || 'api',
    updatedAt: m.updatedAt || new Date().toISOString(),
    note: m.note || '',
  };
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Start of the current UTC calendar month, used by month-to-date API meters.
export function monthStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStartUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
