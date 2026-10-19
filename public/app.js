// Starting points for plans with no usage API, or for people who don't use
// the vendor's CLI. Limits for count-based plans are left blank: providers
// change them often, so copy them from the usage page.
const PRESETS = [
  { provider: 'ChatGPT', label: '5-hour window', unit: '%', limit: 100, period: '5h' },
  { provider: 'ChatGPT', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Gemini', label: '5-hour window', unit: '%', limit: 100, period: '5h' },
  { provider: 'Gemini', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Perplexity', label: 'Pro searches', unit: 'searches', period: 'weekly' },
  { provider: 'Cursor', label: 'Usage pool', unit: '%', limit: 100, period: 'weekly' },
  { provider: 'Claude', label: 'Weekly limit', unit: '%', limit: 100, period: 'weekly' },
];

const AGED_MS = 10 * 60_000;
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
  $('fetched').textContent = `Updated ${relTime(data.fetchedAt)}`;
  manualById = new Map(data.manual.map((m) => [m.id, m]));

  // Only connected providers (ok or error) and manual meters are listed.
  const groups = new Map();
  for (const p of data.providers.filter((p) => p.state !== 'not_configured')) {
    groups.set(p.name, { name: p.name, unofficial: p.unofficial, error: p.error, meters: [...p.meters], manual: false });
  }
  for (const m of data.manual) {
    if (!groups.has(m.provider)) groups.set(m.provider, { name: m.provider, meters: [], manual: true });
    groups.get(m.provider).meters.push(m);
  }

  const all = [...groups.values()].flatMap((g) => g.meters);
  const count = (s) => all.filter((m) => m.status === s).length;
  const summary = $('summary');
  summary.replaceChildren();
  if (all.length) {
    summary.append(el('b', String(all.length)), ` limits across `, el('b', String(groups.size)), ` providers`);
    for (const [n, word] of [[count('critical'), 'almost or fully used'], [count('warning'), 'near the limit'], [count('stale'), 'out of date']]) {
      if (n) summary.append(' · ', el('b', String(n)), ` ${word}`);
    }
  }

  $('list').replaceChildren(...(groups.size ? [...groups.values()].map(section) : [empty('Nothing connected yet. Open Setup below to connect a provider, or add a manual meter.')]));

  const unconf = data.providers.filter((p) => p.state === 'not_configured');
  $('setup-panel').hidden = unconf.length === 0;
  $('unconfigured-count').textContent = String(unconf.length);
  $('unconfigured').replaceChildren(...unconf.map((p) => {
    const li = el('li');
    li.append(el('b', p.name), ` — ${p.setup}`);
    return li;
  }));
}

function section(g) {
  const s = el('section');
  s.className = 'provider';
  const head = el('div');
  head.className = 'provider-head';
  head.append(el('h2', g.name));
  if (g.unofficial) head.append(tag('unofficial'));
  if (g.manual) head.append(tag('manual'));
  s.append(head);
  if (g.error) {
    const e = el('div', g.error);
    e.className = 'provider-error';
    e.title = g.error;
    s.append(e);
  }
  s.append(...g.meters.map(row));
  return s;
}

function row(m) {
  const node = $('row-tpl').content.firstElementChild.cloneNode(true);
  node.dataset.status = m.status;

  const label = node.querySelector('.label');
  label.textContent = shortLabel(m);
  const aged = Date.now() - Date.parse(m.updatedAt) > AGED_MS;
  if (aged) {
    const age = el('span', shortAgo(m.updatedAt));
    age.className = 'age';
    label.append(age);
  }
  if (m.source === 'manual') {
    const edit = el('button', 'edit');
    edit.type = 'button';
    edit.className = 'edit';
    edit.setAttribute('aria-label', `Edit ${m.label}`);
    edit.onclick = () => fillForm(manualById.get(m.id), true);
    label.append(edit);
  }

  const pct = m.ratio != null ? Math.round(m.ratio * 100) : null;
  const bar = node.querySelector('.bar');
  const cell = node.querySelector('.pct');
  const word = statusWord(m);
  if (pct != null) {
    bar.querySelector('span').style.width = `${Math.min(100, pct)}%`;
    bar.setAttribute('aria-valuenow', String(Math.min(100, pct)));
    bar.setAttribute('aria-label', `${m.label}: ${pct}% used${word ? `, ${word}` : ''}`);
    if (m.status === 'warning' || m.status === 'critical') {
      const flag = el('span', '!');
      flag.className = 'flag';
      flag.setAttribute('aria-hidden', 'true');
      cell.append(flag);
    }
    cell.append(`${pct}%`);
  } else {
    bar.style.visibility = 'hidden';
    cell.textContent = m.used == null ? '—' : compact(m.used);
  }

  node.querySelector('.reset').textContent = m.status === 'stale' ? 'update' : m.resetsAt ? shortReset(m.resetsAt) : '';

  // Full detail lives in the tooltip to keep each limit on one line.
  node.title = [
    `${m.provider} · ${m.label}`,
    word,
    m.used != null && m.unit !== '%' ? `${fmt(m.used)}${m.limit ? ` of ${fmt(m.limit)}` : ''} ${m.unit}`.trim() : '',
    m.status !== 'stale' && m.resetsAt ? resetText(m.resetsAt) : '',
    `${m.source === 'manual' ? 'Entered' : 'Updated'} ${relTime(m.updatedAt)}`,
    m.note,
  ].filter(Boolean).join('\n');
  return node;
}

function statusWord(m) {
  if (m.status === 'stale') return 'Reset time passed; update this value';
  if (m.status === 'critical') return m.ratio >= 1 ? 'Limit reached' : 'Almost used up';
  if (m.status === 'warning') return 'Near limit';
  return '';
}

// Display-only short names; the tooltip keeps the full label.
function shortLabel(m) {
  let l = m.label;
  const colon = l.indexOf(': ');
  if (colon > 0 && l.toLowerCase().startsWith(m.provider.toLowerCase().split(' ')[0])) l = l.slice(colon + 2);
  return l
    .replace(/^Current session \(5-hour\)$/, '5-hour session')
    .replace(/^(\d+)-hour window$/, '$1-hour')
    .replace(/^Weekly limit/, 'Weekly')
    .replace(/^MCP tool calls \(monthly\)$/, 'MCP calls (monthly)');
}

// "45m", "2h 14m", "Thu 11pm", "Oct 30": fits the narrow reset column.
function shortReset(iso) {
  const d = new Date(iso);
  const min = Math.round((d - Date.now()) / 60_000);
  if (min < 60) return `${Math.max(1, min)}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;
  if (min < 7 * 24 * 60) return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortAgo(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 60) return `${Math.max(1, min)}m old`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h old`;
  return `${Math.round(min / 1440)}d old`;
}

function compact(n) {
  return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
}

function resetText(iso) {
  const diff = Date.parse(iso) - Date.now();
  const min = Math.round(diff / 60_000);
  if (min < 60) return `Resets in ${Math.max(1, min)} min`;
  if (min < 24 * 60) return `Resets in ${Math.floor(min / 60)} hr${min % 60 ? ` ${min % 60} min` : ''}`;
  const opts = diff < 7 * 86_400_000
    ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' };
  return `Resets ${new Date(iso).toLocaleString(undefined, opts)}`;
}

function fillForm(m, editing = false) {
  form.reset();
  for (const [k, v] of Object.entries(m)) {
    const input = form.elements.namedItem(k);
    if (!input || v == null) continue;
    input.value = k === 'resetsAt' ? toLocalInput(v) : v;
  }
  $('form-title').textContent = editing ? `Edit: ${m.provider} · ${m.label}` : 'Add manual meter';
  $('delete').hidden = !editing;
  $('manual-panel').open = true;
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

$('delete').onclick = () => {
  const id = form.elements.namedItem('id').value;
  if (id) removeManual(id, form.elements.namedItem('label').value);
};

form.addEventListener('reset', () => {
  $('delete').hidden = true;
  $('form-title').textContent = 'Add manual meter';
  $('form-error').textContent = '';
});

async function removeManual(id, label) {
  if (!confirm(`Delete "${label}"?`)) return;
  const res = await fetch(`/api/manual/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (res.ok) {
    form.reset();
    load();
  }
}

// Helpers
function el(tag, text) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  return n;
}
function tag(text) {
  const t = el('span', text);
  t.className = 'tag';
  return t;
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
