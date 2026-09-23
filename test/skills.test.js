import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkills } from '../scripts/sync-skills.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Two copies of each skill exist on purpose — see scripts/sync-skills.js. This asserts
// they never drift, because a stale .claude/skills copy is invisible: Claude Code would
// happily load the old instructions and nothing would look wrong.
test('.claude/skills matches plugin/skills', () => {
  const { drifted, stale } = syncSkills({ check: true });
  assert.deepEqual(drifted, [], 'run: npm run sync:skills');
  assert.deepEqual(stale, [], 'a removed skill is still in .claude/skills');
});

test('both skill locations carry every skill, with usable frontmatter', () => {
  const names = readdirSync(join(ROOT, 'plugin', 'skills'));
  assert.ok(names.length >= 2);
  for (const dir of ['plugin/skills', '.claude/skills']) {
    for (const name of names) {
      const md = readFileSync(join(ROOT, dir, name, 'SKILL.md'), 'utf8');
      assert.match(md, /^---\n/, `${dir}/${name} has no frontmatter`);
      assert.match(md, new RegExp(`^name: ${name}$`, 'm'), `${dir}/${name} name mismatch`);
      assert.match(md, /^description: .{40,}/m, `${dir}/${name} needs a description that can trigger it`);
    }
  }
});
