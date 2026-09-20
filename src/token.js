// Resolve this session's Lupa API key, per invocation.
//
// Order: an exported $LUPA_API_TOKEN, then the macOS keychain slot, then a gitignored
// .env. Resolving on every call is what makes this work from an agent session, where
// each command runs in a fresh shell and exported variables do not carry over.
//
// In a Cowork VM there is no keychain, so the key lands in .env inside the session
// sandbox and dies with it. That is the intended lifetime: one key, one store, one
// session, read-only.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE = 'lupa-api';
const ACCOUNT = 'current';

export function resolveToken(root) {
  if (process.env.LUPA_API_TOKEN) return process.env.LUPA_API_TOKEN;
  if (process.platform === 'darwin') {
    const r = spawnSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    const line = readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('LUPA_API_TOKEN='));
    if (line) return line.slice('LUPA_API_TOKEN='.length).trim();
  }
  return undefined;
}

export function storeToken(root, key) {
  if (process.platform === 'darwin') {
    // Fed to `security -i` on stdin, never as an argv value that ps could read.
    const r = spawnSync('security', ['-i'], {
      input: `add-generic-password -s ${SERVICE} -a ${ACCOUNT} -U -w ${key}\n`,
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr?.trim() || 'keychain write failed');
    return 'login keychain (lupa-api/current)';
  }
  const envPath = join(root, '.env');
  writeFileSync(envPath, `LUPA_API_TOKEN=${key}\n`, { mode: 0o600 });
  return `${envPath} (mode 600, gitignored)`;
}
