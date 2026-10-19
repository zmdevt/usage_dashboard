import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { createCollector } from './lib/collect.js';
import { ManualStore, ValidationError } from './lib/manual-store.js';
import { providers } from './providers/index.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const MAX_BODY = 16 * 1024;

export function createApp({ env = loadEnv(join(ROOT, '.env')), store = new ManualStore(join(ROOT, 'data/manual.json')), fetchImpl } = {}) {
  const collect = createCollector({ providers, store, env, fetchImpl });

  return async function handler(req, res) {
    // Reject foreign Host headers so a DNS-rebinding page can't read the API.
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return json(res, 421, { error: 'bad host' });
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/usage' && req.method === 'GET') {
        return json(res, 200, await collect({ force: url.searchParams.has('refresh') }));
      }
      if (url.pathname === '/api/manual' && req.method === 'POST') {
        return json(res, 200, await store.upsert(await readJson(req)));
      }
      const m = url.pathname.match(/^\/api\/manual\/([\w-]{1,64})$/);
      if (m && req.method === 'DELETE') {
        return (await store.remove(m[1])) ? json(res, 204) : json(res, 404, { error: 'not found' });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      if (req.method === 'GET') return serveStatic(url.pathname, res);
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      console.error(e);
      return json(res, 500, { error: 'internal error' });
    }
  };
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new ValidationError('content-type must be application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new ValidationError('body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('invalid JSON');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv(join(ROOT, '.env'));
  const port = Number(env.PORT) || 4317;
  // Bind to loopback only: the server holds API keys and has no auth.
  http.createServer(createApp({ env })).listen(port, '127.0.0.1', () => {
    console.log(`usage-dashboard on http://127.0.0.1:${port}`);
  });
}
