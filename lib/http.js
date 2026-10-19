// JSON request helper. Error messages carry status and a short body excerpt,
// never request headers, so API keys can't leak into the UI.
export async function requestJson(url, { fetch: f = fetch, signal, headers = {}, method = 'GET', body } = {}) {
  const res = await f(url, {
    method,
    signal,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || detail;
    } catch {}
    throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

// Follows has_more / next_page pagination (Anthropic and OpenAI admin APIs).
export async function collectPages(buildUrl, opts, maxPages = 20) {
  const items = [];
  let page = null;
  for (let i = 0; i < maxPages; i++) {
    const body = await requestJson(buildUrl(page), opts);
    items.push(...(body.data || []));
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return items;
}
