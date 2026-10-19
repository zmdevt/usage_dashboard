import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requestJson } from '../lib/http.js';

// ChatGPT Plus/Pro limits, read through the Codex CLI's ChatGPT login.
// Same request Codex's /status makes (openai/codex, backend-client
// rate_limit_resets.rs). Undocumented endpoint.
//
// Read-only by design: the token is never refreshed or written back. Codex
// rotates refresh tokens, so refreshing here would log the CLI out.

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export default {
  id: 'chatgpt-codex',
  name: 'ChatGPT',
  setup: 'Sign in to the Codex CLI with your ChatGPT account, then set CHATGPT_USAGE=on in .env. Unofficial endpoint.',
  configured: (env) => isOn(env.CHATGPT_USAGE),

  async fetch(env, { signal, fetch }) {
    const { accessToken, accountId } = await readCodexLogin(env);
    let body;
    try {
      body = await requestJson(USAGE_URL, {
        signal,
        fetch,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
          accept: 'application/json',
          'user-agent': 'usage-dashboard',
        },
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('Codex login rejected; run codex once to refresh it');
      throw e;
    }
    return parseUsage(body);
  },
};

export async function readCodexLogin(env) {
  const path = join(env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
  let auth;
  try {
    auth = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('Codex login not found; run codex and sign in with ChatGPT (keychain storage is not supported)');
    throw new Error('could not read Codex auth.json');
  }
  const t = auth.tokens;
  if (!t?.access_token) throw new Error('Codex is signed in with an API key; ChatGPT limits need a ChatGPT login');

  const exp = jwtClaims(t.access_token).exp;
  if (exp && exp * 1000 <= Date.now()) throw new Error('Codex login expired; run codex once to refresh it');

  const accountId = t.account_id || jwtClaims(t.id_token)['https://api.openai.com/auth']?.chatgpt_account_id || null;
  return { accessToken: t.access_token, accountId };
}

export function parseUsage(body = {}) {
  const note = [body.plan_type && `Plan: ${body.plan_type}`, creditsNote(body.credits), 'Unofficial endpoint']
    .filter(Boolean).join(' · ');
  const meters = windows(body.rate_limit, 'chatgpt', '', note);
  for (const extra of body.additional_rate_limits || []) {
    const name = extra.limit_name || extra.metered_feature;
    if (name) meters.push(...windows(extra.rate_limit, `chatgpt-${slug(name)}`, `${name}: `, note));
  }
  if (meters.length === 0) throw new Error('no rate-limit windows in ChatGPT response');
  return meters;
}

function windows(rl, idPrefix, labelPrefix, note) {
  if (!rl) return [];
  return [['primary', rl.primary_window], ['secondary', rl.secondary_window]]
    .filter(([, w]) => w && w.used_percent != null)
    .map(([key, w]) => {
      const { label, period } = describeWindow(w.limit_window_seconds);
      const resetsAt = w.reset_at ? w.reset_at * 1000
        : w.reset_after_seconds != null ? Date.now() + w.reset_after_seconds * 1000 : null;
      return {
        id: `${idPrefix}-${key}`,
        label: labelPrefix + label,
        used: w.used_percent,
        limit: 100,
        unit: '%',
        period,
        resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
        note,
      };
    });
}

function describeWindow(seconds) {
  if (seconds === 18_000) return { label: '5-hour window', period: '5h' };
  if (seconds === 604_800) return { label: 'Weekly limit', period: 'weekly' };
  if (!seconds) return { label: 'Usage window', period: 'none' };
  const hours = Math.round(seconds / 3600);
  return hours % 24 === 0 ? { label: `${hours / 24}-day window`, period: 'none' } : { label: `${hours}-hour window`, period: 'none' };
}

function creditsNote(c) {
  if (!c?.has_credits) return '';
  return c.unlimited ? 'Credits: unlimited' : c.balance != null ? `Credits: ${c.balance}` : '';
}

// Decodes a JWT payload without verifying it; only used to read exp and the
// account id from tokens Codex already trusts.
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) || {};
  } catch {
    return {};
  }
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const isOn = (v) => /^(1|on|true|yes)$/i.test(String(v || ''));
