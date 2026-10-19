import { makeMeter } from './meter.js';

// Runs every configured provider in parallel and merges the result with
// manual meters. One provider failing never blocks the others.

const TIMEOUT_MS = 15_000;

export function createCollector({ providers, store, env, ttlMs = 5 * 60_000, fetchImpl = fetch }) {
  let cache = null; // { at, providers: [...] }

  async function runProvider(p) {
    if (!p.configured(env)) {
      return { id: p.id, name: p.name, state: 'not_configured', setup: p.setup, meters: [] };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const raw = await p.fetch(env, { signal: ctrl.signal, fetch: fetchImpl });
      const meters = raw.map((m) => makeMeter({ ...m, provider: p.name, source: 'api' }));
      return { id: p.id, name: p.name, state: 'ok', meters };
    } catch (e) {
      const message = ctrl.signal.aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : e.message;
      return { id: p.id, name: p.name, state: 'error', error: message, meters: [] };
    } finally {
      clearTimeout(timer);
    }
  }

  async function apiResults(force) {
    if (!force && cache && Date.now() - cache.at < ttlMs) return cache;
    cache = { at: Date.now(), providers: await Promise.all(providers.map(runProvider)) };
    return cache;
  }

  return async function collect({ force = false } = {}) {
    const api = await apiResults(force);
    const manual = (await store.list()).map((m) => makeMeter({ ...m, source: 'manual' }));
    return {
      fetchedAt: new Date(api.at).toISOString(),
      providers: api.providers,
      manual,
    };
  };
}
