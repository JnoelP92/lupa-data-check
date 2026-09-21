import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The one bug in this tool that makes the output actively misleading rather than merely
// wrong: a rule reading a field the API does not return matches nothing, reports
// nothing, and is indistinguishable from a clean pass. It gets an assertion of its own
// so it cannot come back quietly.
test('every field a rule reads exists on the API', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-fields.js')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `\n${r.stderr}${r.stdout}`);
});
