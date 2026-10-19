import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

// Manual meters cover plans with no official usage API (Claude Pro/Max,
// ChatGPT Plus, Gemini, Perplexity). Stored as a JSON array on disk.

const PERIODS = new Set(['5h', 'daily', 'weekly', 'monthly', 'none']);

export class ManualStore {
  constructor(path = 'data/manual.json') {
    this.path = path;
  }

  async list() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async upsert(input) {
    const entry = validate(input);
    const all = await this.list();
    const i = all.findIndex((e) => e.id === entry.id);
    if (i === -1) all.push(entry);
    else all[i] = entry;
    await this.#save(all);
    return entry;
  }

  async remove(id) {
    const all = await this.list();
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    await this.#save(next);
    return true;
  }

  // Write to a temp file and rename so a crash never leaves half a file.
  async #save(all) {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2));
    await rename(tmp, this.path);
  }
}

export function validate(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('body must be an object');
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const num = (v, name) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new ValidationError(`${name} must be a non-negative number`);
    return n;
  };

  const provider = str(input.provider, 60);
  const label = str(input.label, 80);
  if (!provider) throw new ValidationError('provider is required');
  if (!label) throw new ValidationError('label is required');

  const period = input.period ? String(input.period) : 'none';
  if (!PERIODS.has(period)) throw new ValidationError(`period must be one of ${[...PERIODS].join(', ')}`);

  let resetsAt = null;
  if (input.resetsAt) {
    const t = Date.parse(input.resetsAt);
    if (Number.isNaN(t)) throw new ValidationError('resetsAt must be a date');
    resetsAt = new Date(t).toISOString();
  }

  return {
    id: typeof input.id === 'string' && input.id ? input.id.slice(0, 64) : randomUUID(),
    provider,
    label,
    used: num(input.used, 'used'),
    limit: num(input.limit, 'limit'),
    unit: str(input.unit, 30),
    period,
    resetsAt,
    note: str(input.note, 200),
    updatedAt: new Date().toISOString(),
  };
}

export class ValidationError extends Error {}
