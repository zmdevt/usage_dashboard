import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setEnvLine, planStatusLine, checkCodexLogin } from '../scripts/connect.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/connect.mjs', import.meta.url));

test('setEnvLine replaces an existing key or appends a new one', () => {
  assert.equal(setEnvLine('A=1\nCHATGPT_USAGE=off\n', 'CHATGPT_USAGE', 'on'), 'A=1\nCHATGPT_USAGE=on\n');
  assert.equal(setEnvLine('A=1', 'GEMINI_AGY', 'on'), 'A=1\nGEMINI_AGY=on\n');
  assert.equal(setEnvLine('', 'X', 'y'), 'X=y\n');
});

test('planStatusLine adds, replaces, or leaves settings alone', () => {
  const cmd = 'node "/x/claude-statusline.mjs"';
  assert.equal(planStatusLine({ statusLine: { type: 'command', command: cmd } }, cmd).action, 'none');
  const add = planStatusLine({ theme: 'dark' }, cmd);
  assert.equal(add.action, 'add');
  assert.deepEqual(add.next, { theme: 'dark', statusLine: { type: 'command', command: cmd } });
  const rep = planStatusLine({ statusLine: { type: 'command', command: 'other' } }, cmd);
  assert.deepEqual([rep.action, rep.previous], ['replace', 'other']);
  const upd = planStatusLine({ statusLine: { type: 'command', command: 'node "/x/claude-statusline.mjs"' } }, '"/usr/bin/node" "/x/claude-statusline.mjs"');
  assert.equal(upd.action, 'update');
});

test('checkCodexLogin distinguishes ChatGPT login, API-key login and no login', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ud-cx-'));
  try {
    assert.match(checkCodexLogin({ CODEX_HOME: dir }).reason, /no login file/);
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-x', tokens: null }));
    assert.match(checkCodexLogin({ CODEX_HOME: dir }).reason, /API key/);
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: 'SECRET' } }));
    assert.deepEqual(checkCodexLogin({ CODEX_HOME: dir }), { ok: true });
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('connect wires up all three CLIs end to end without printing tokens', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ud-home-'));
  try {
    const bin = join(home, 'bin');
    await mkdir(bin);
    const fake = async (name, body) => {
      await writeFile(join(bin, name), `#!/usr/bin/env node\n${body}\n`);
      await chmod(join(bin, name), 0o755);
    };
    await fake('claude', '');
    await fake('codex', '');
    const agy = { status: 'SUCCESS', command: { data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: 0.75 }] }] } } };
    await fake('agy', `process.stdout.write(${JSON.stringify(JSON.stringify(agy))});`);

    await mkdir(join(home, '.claude'));
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'old' } }));
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({ tokens: { access_token: 'SECRET_TOKEN' } }));
    const envPath = join(home, 'dashboard.env');
    await writeFile(envPath, 'PORT=4317\nCHATGPT_USAGE=off\n');

    const r = spawnSync(process.execPath, [SCRIPT, '--yes'], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, USAGE_DASHBOARD_ENV: envPath },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /SECRET_TOKEN/);
    assert.match(r.stdout, /Claude\s+connected/);
    assert.match(r.stdout, /ChatGPT\s+connected/);
    assert.match(r.stdout, /Gemini\s+connected\s+Gemini Models: 5-hour window 25%/);

    const settings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.theme, 'dark');
    assert.ok(settings.statusLine.command.startsWith(`"${process.execPath}" "`));
    assert.match(settings.statusLine.command, /claude-statusline\.mjs"$/);
    assert.match(r.stdout, /Claude\s+connected\s+hook works/);
    assert.ok((await readdir(join(home, '.claude'))).some((f) => f.startsWith('settings.json.bak-')));
    assert.equal(await readFile(envPath, 'utf8'), 'PORT=4317\nCHATGPT_USAGE=on\nGEMINI_AGY=on\n');
  } finally {
    await rm(home, { recursive: true });
  }
});

test('connect leaves Claude settings alone when not confirmed', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ud-home-'));
  try {
    const bin = join(home, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'claude'), '#!/usr/bin/env node\n');
    await chmod(join(bin, 'claude'), 0o755);
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      input: '',
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, USAGE_DASHBOARD_ENV: join(home, 'x.env'), AGY_BIN: join(home, 'none') },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Claude\s+skipped\s+you declined/);
    assert.match(r.stdout, /ChatGPT\s+skipped/);
    assert.match(r.stdout, /Gemini\s+skipped/);
    await assert.rejects(readFile(join(home, '.claude', 'settings.json')));
  } finally {
    await rm(home, { recursive: true });
  }
});
