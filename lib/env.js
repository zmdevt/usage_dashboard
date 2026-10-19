import { readFileSync, existsSync } from 'node:fs';

// Minimal .env loader: KEY=value per line, # comments, optional quotes.
// Real environment variables win over the file.
export function loadEnv(path = '.env') {
  const env = {};
  if (existsSync(path)) {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return { ...env, ...process.env };
}
