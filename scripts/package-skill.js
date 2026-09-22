#!/usr/bin/env node
// Build the uploadable skill bundles.
//
//   node scripts/package-skill.js       # writes dist/*.zip
//
// Skills upload one .zip per skill, and the zip must have the SKILL FOLDER as its root
// — not a subfolder, or the upload is rejected.
//
// Each bundle carries the whole tool, not just SKILL.md: a skill's files are available
// in the session, so `check` and `deliverables` run straight from the bundle with
// nothing cloned and nothing installed. Only `pull` needs to happen elsewhere, because
// only `pull` needs to reach Lupa.
import { mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, '.stage');

// Everything the skill needs at runtime. Tests and git metadata stay out.
const PAYLOAD = ['bin', 'src', 'scripts', 'references', 'spec-fields.json', 'package.json', 'README.md'];
const SKILLS = ['lupa-data-check', 'lupa-live-config'];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const skill of SKILLS) {
  const dir = join(STAGE, skill);
  mkdirSync(dir, { recursive: true });

  cpSync(join(ROOT, 'plugin', 'skills', skill, 'SKILL.md'), join(dir, 'SKILL.md'));
  for (const item of PAYLOAD) {
    const from = join(ROOT, item);
    if (existsSync(from)) cpSync(from, join(dir, item), { recursive: true });
  }

  // `zip -r` from the stage directory, so the skill folder is the archive root.
  const out = join(DIST, `${skill}.zip`);
  const r = spawnSync('zip', ['-qr', out, skill, '-x', '*/.DS_Store'], { cwd: STAGE, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || 'zip failed — is the `zip` command available?');
    process.exit(1);
  }
  console.log(`dist/${skill}.zip`);
}

rmSync(STAGE, { recursive: true, force: true });
console.log('\nUpload at Settings → Capabilities → Skills → Add skill. One zip per skill.');
