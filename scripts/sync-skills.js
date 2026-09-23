#!/usr/bin/env node
// Copy the canonical skills into .claude/skills/ so they load when someone opens this
// folder as a project in Claude Code.
//
//   node scripts/sync-skills.js        # after editing any SKILL.md
//
// Why two copies of the same file:
//
//   plugin/skills/   the plugin layout a marketplace install requires, and the source
//                    of truth. A plugin sourced at the repo root does not sync.
//   .claude/skills/  what Claude Code reads from an opened folder, with no install
//                    step, no marketplace and no admin.
//
// A symlink between them was tried and removed: with the plugin root at the repo root,
// anything walking the tree followed it back into itself, and it was a live suspect
// while marketplace sync was failing. Two real files and a test that they match is
// duller and harder to break.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'plugin', 'skills');
const DEST = join(ROOT, '.claude', 'skills');

export function syncSkills({ check = false } = {}) {
  const skills = readdirSync(SRC, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const drifted = [];

  for (const skill of skills) {
    const from = readFileSync(join(SRC, skill, 'SKILL.md'), 'utf8');
    const target = join(DEST, skill, 'SKILL.md');
    let current = null;
    try { current = readFileSync(target, 'utf8'); } catch { /* not there yet */ }
    if (current === from) continue;
    drifted.push(skill);
    if (check) continue;
    mkdirSync(join(DEST, skill), { recursive: true });
    writeFileSync(target, from);
  }

  // A skill deleted from the source should not linger in the copy.
  let stale = [];
  try {
    stale = readdirSync(DEST, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !skills.includes(e.name)).map((e) => e.name);
  } catch { /* nothing copied yet */ }
  if (!check) for (const s of stale) rmSync(join(DEST, s), { recursive: true, force: true });

  return { skills, drifted, stale };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const { skills, drifted, stale } = syncSkills({ check });
  if (check && (drifted.length || stale.length)) {
    console.error(`.claude/skills is out of date: ${[...drifted, ...stale].join(', ')}`);
    console.error('Run: npm run sync:skills');
    process.exit(2);
  }
  console.log(check
    ? `.claude/skills matches plugin/skills (${skills.length} skills).`
    : `Synced ${skills.length} skills${drifted.length ? `: ${drifted.join(', ')}` : ' (already current)'}.`);
}
