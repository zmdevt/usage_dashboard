// Starting points for plans with no usage API. Limits are left blank on
// purpose: providers change them often, so copy them from the usage page.
// Claude Pro/Max is automatic via the Claude Code status line; these presets
// cover it only for people who don't use Claude Code.
const PRESETS = [
  { provider: 'ChatGPT', label: '5-hour window', unit: '%', limit: 100, period: '5h' },
  { provider: 'ChatGPT', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Gemini', label: '5-hour window', unit: '%', limit: 100, period: '5h' },
  { provider: 'Gemini', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Perplexity', label: 'Pro searches', unit: 'searches', period: 'weekly' },
  { provider: 'Cursor', label: 'Usage pool', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Claude', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
];

const $ = (id) => document.getElementById(id);
const form = $('manual-form');
let manualById = new Map();

async function load(force = false) {
  const btn = $('refresh');
  btn.disabled = true;
  try {
    const res = await fetch(force ? '/api/usage?refresh=1' : '/api/usage');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (e) {
    $('fetched').textContent = `Failed to load: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

function render(data) {
  $('fetched').textContent = `API data fetched ${relTime(data.fetchedAt)} · cached 5 min`;
  const apiMeters = data.providers.flatMap((p) => p.meters);
  const all = [...apiMeters, ...data.manual];
  manualById = new Map(data.manual.map((m) => [m.id, m]));

  // Summary
  const count = (s) => all.filter((m) => m.status === s).length;
  const errors = data.providers.filter((p) => p.state === 'error').length;
  setChildren($('summary'), [
    stat('Meters', all.length),
    stat('Critical ≥90%', count('critical')),
    stat('Warning ≥75%', count('warning')),
    stat('Stale (reset passed)', count('stale')),
    stat('Provider errors', errors),
  ]);

  // Needs attention: critical, warning, stale; highest ratio first.
  const rank = { critical: 0, warning: 1, stale: 2 };
  const hot = all.filter((m) => m.status in rank).sort((a, b) => rank[a.status] - rank[b.status] || (b.ratio ?? 0) - (a.ratio ?? 0));
  setChildren($('attention'), hot.length ? hot.map(meterCard) : [empty('Nothing near a limit.')]);

  // Grouped by provider.
  const groups = new Map();
  for (const m of all) {
    if (!groups.has(m.provider)) groups.set(m.provider, []);
    groups.get(m.provider).push(m);
  }
  const groupEls = [];
  for (const p of data.providers.filter((p) => p.state === 'error')) {
    const h = el('h3', p.name);
    const e = el('p', `Error: ${p.error}`);
    e.className = 'error-text';
    groupEls.push(h, e);
  }
  for (const [name, meters] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const grid = el('div');
    grid.className = 'grid';
    setChildren(grid, meters.map(meterCard));
    groupEls.push(el('h3', name), grid);
  }
  setChildren($('groups'), groupEls.length ? groupEls : [empty('No meters yet. Add API keys to .env or a manual meter below.')]);

  // Not configured providers.
  const unconf = data.providers.filter((p) => p.state === 'not_configured');
  setChildren($('unconfigured'), unconf.length ? unconf.map((p) => {
    const li = el('li');
    li.append(el('b', p.name), ` — ${p.setup}`);
    return li;
  }) : [empty('All API providers connected.')]);
}

function meterCard(m) {
  const node = $('meter-tpl').content.firstElementChild.cloneNode(true);
  node.dataset.status = m.status;
  node.querySelector('.label').textContent = m.label;
  node.querySelector('.badge').textContent = m.source === 'manual' ? `${m.provider} · manual` : m.provider;

  const fig = node.querySelector('.figures');
  if (m.used == null) fig.textContent = 'No value';
  else if (m.unit === '%' && m.limit === 100) fig.textContent = `${fmt(m.used)}% used`;
  else if (m.limit) fig.textContent = `${fmt(m.used)} / ${fmt(m.limit)} ${m.unit} · ${Math.round(m.ratio * 100)}%`;
  else fig.textContent = `${fmt(m.used)} ${m.unit} · no limit set`;

  const bar = node.querySelector('.bar');
  if (m.ratio != null) {
    const pct = Math.min(100, Math.round(m.ratio * 100));
    bar.querySelector('span').style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-label', `${m.label} ${pct}% used`);
  } else {
    bar.remove();
  }

  const meta = [];
  if (m.status === 'stale') meta.push('Reset time passed; update this value');
  else if (m.resetsAt) meta.push(`Resets ${relTime(m.resetsAt)}`);
  if (m.source === 'manual') meta.push(`updated ${relTime(m.updatedAt)}`);
  if (m.note) meta.push(m.note);
  node.querySelector('.meta').textContent = meta.join(' · ');

  if (m.source === 'manual') {
    const actions = node.querySelector('.row-actions');
    const edit = el('button', 'Edit');
    edit.type = 'button';
    edit.onclick = () => fillForm(manualById.get(m.id), true);
    const del = el('button', 'Delete');
    del.type = 'button';
    del.onclick = () => removeManual(m.id, m.label);
    actions.append(edit, del);
  }
  return node;
}

function fillForm(m, editing = false) {
  form.reset();
  for (const [k, v] of Object.entries(m)) {
    const input = form.elements.namedItem(k);
    if (!input || v == null) continue;
    input.value = k === 'resetsAt' ? toLocalInput(v) : v;
  }
  $('form-title').textContent = editing ? `Edit: ${m.provider} · ${m.label}` : 'Add manual meter';
  form.scrollIntoView({ behavior: 'smooth' });
  form.elements.namedItem('used').focus();
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  if (body.resetsAt) body.resetsAt = new Date(body.resetsAt).toISOString();
  if (!body.id) delete body.id;
  $('form-error').textContent = '';
  const res = await fetch('/api/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    $('form-error').textContent = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
    return;
  }
  form.reset();
  $('form-title').textContent = 'Add manual meter';
  load();
});

form.addEventListener('reset', () => {
  $('form-title').textContent = 'Add manual meter';
  $('form-error').textContent = '';
});

async function removeManual(id, label) {
  if (!confirm(`Delete "${label}"?`)) return;
  const res = await fetch(`/api/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok) load();
}

// Helpers
function el(tag, text) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  return n;
}
function setChildren(parent, kids) { parent.replaceChildren(...kids); }
function stat(label, value) {
  const d = el('div', label);
  d.className = 'stat';
  d.prepend(el('b', String(value)));
  return d;
}
function empty(text) {
  const p = el('p', text);
  p.className = 'empty';
  return p;
}
function fmt(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 });
}
function relTime(iso) {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

for (const p of PRESETS) {
  const b = el('button', `${p.provider}: ${p.label}`);
  b.type = 'button';
  b.onclick = () => fillForm(p);
  $('presets').append(b);
}
$('refresh').onclick = () => load(true);
load();
setInterval(load, 60_000);
