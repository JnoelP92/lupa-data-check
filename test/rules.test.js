import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, runRules } from '../src/rules/index.js';
import { buildReport, renderMarkdown } from '../src/report.js';
import { makePull } from './fixture.js';

const run = (opts) => {
  const dir = makePull(opts);
  const ctx = buildContext(dir, { now: new Date('2026-09-20T12:00:00Z') });
  return { dir, ctx, sections: runRules(ctx) };
};

const finding = (sections, id) => sections[0].findings.find((f) => f.id === id);

test('every seeded defect is caught exactly once', () => {
  const { sections } = run();
  const expected = {
    'clients.email.missing': 1,
    'clients.phone.missing': 1,
    'clients.email.malformed': 1,
    'clients.phone.implausible': 1,
    'clients.dob.implausible': 1,
    'clients.address.missing': 1,
    'clients.duplicate.email': 2,
    'clients.duplicate.phone': 2,
    'clients.duplicate.nameDob': 2,
    'clients.balance.nonZero': 2,
    'clients.ref.primaryStore': 1,
    'clients.ref.paymentTerms': 1,
    'clients.contacts.noRoute': 1,
  };
  for (const [id, total] of Object.entries(expected)) {
    assert.equal(finding(sections, id)?.total, total, `${id} should flag ${total}`);
  }
});

test('archived clients are exempt from missing-contact rules', () => {
  const { sections } = run();
  for (const id of ['clients.email.missing', 'clients.phone.missing', 'clients.address.missing']) {
    const ids = finding(sections, id).rows.map((r) => r.id);
    assert.ok(!ids.includes('c0019'), `${id} must not flag the archived client`);
  }
});

test('duplicate matching normalises case, whitespace and phone formatting', () => {
  const { sections } = run();
  assert.deepEqual(finding(sections, 'clients.duplicate.email').rows.map((r) => r.id).sort(), ['c0008', 'c0009']);
  assert.deepEqual(finding(sections, 'clients.duplicate.phone').rows.map((r) => r.id).sort(), ['c0010', 'c0011']);
  assert.deepEqual(finding(sections, 'clients.duplicate.nameDob').rows.map((r) => r.id).sort(), ['c0012', 'c0013']);
});

test('a rule whose reference set was unreadable is skipped, not passed', () => {
  const { sections } = run({ unavailable: { paymentTerms: 'HTTP 403 forbidden' } });
  assert.equal(finding(sections, 'clients.ref.paymentTerms'), undefined, 'must not appear as a finding');
  const skipped = sections[0].skipped.find((s) => s.id === 'clients.ref.paymentTerms');
  assert.ok(skipped, 'must appear in skipped');
  assert.match(skipped.reason, /paymentTerms/);
});

test('severity counts roll up into the summary', () => {
  const { ctx, sections } = run();
  const report = buildReport(ctx, sections);
  const row = report.summary[0];
  assert.equal(row.category, 'Clients');
  assert.equal(row.scanned, 20);
  assert.equal(row.critical, 1 + 2 + 2 + 1 + 1, 'malformed email + dup email + dup phone + bad store ref + bad terms ref');
  assert.equal(row.flagged, row.critical + row.review + row.info);
});

test('balance tally reports credit and debt separately', () => {
  const { ctx, sections } = run();
  const tally = Object.fromEntries(sections[0].tally.map((t) => [t.label, t.value]));
  assert.match(String(tally['In debt']), /^1 client,/);
  assert.match(String(tally['In credit']), /^1 client,/);
  assert.equal(String(tally['Net outstanding (debt − credit)']), '£85.00');
  void ctx;
});

test('markdown renders with links and a truncation note where one applies', () => {
  const { ctx, sections } = run();
  const md = renderMarkdown(buildReport(ctx, sections));
  assert.match(md, /# Data check — Fixture Veterinary Group/);
  assert.match(md, /https:\/\/work\.lupapets\.com\/clients\/c0004/);
  assert.match(md, /\| Category *\| Scanned/);
});

test('an incomplete pull is called out at the top of the report', () => {
  const { ctx, sections } = run({ unavailable: { paymentTerms: 'HTTP 403 forbidden' } });
  const md = renderMarkdown(buildReport(ctx, sections));
  assert.match(md, /Incomplete pull/);
  assert.match(md, /paymentTerms/);
});
