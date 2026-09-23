import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, runRules } from '../src/rules/index.js';
import { buildReport } from '../src/report.js';
import { renderClientReport } from '../src/client-report.js';
import { renderDockCopy, renderEmail, renderLinearTickets } from '../src/deliverables.js';
import { clientSafeFields, looksLikeUuid } from '../src/redact.js';
import { makePull } from './fixture.js';

const NOW = new Date('2026-09-20T12:00:00Z');
let cached;
function report() {
  if (cached) return cached;
  const ctx = buildContext(makePull(), { now: NOW });
  cached = buildReport(ctx, runRules(ctx));
  return cached;
}

test('redaction strips UUIDs and internal reference plumbing but keeps practice identifiers', () => {
  const out = clientSafeFields({
    numericId: 1042,
    itemCode: 'ABC-1',
    invoiceNumber: 'INV-9',
    microchip: '900123456789012',
    primaryStoreId: '11111111-1111-1111-1111-111111111111',
    danglingClientId: 'c0001',
    petId: 'p01',
    snippet: 'clinical free text',
    price: '£20.00',
  });
  assert.deepEqual(Object.keys(out).sort(), ['invoiceNumber', 'itemCode', 'microchip', 'numericId', 'price']);
});

test('looksLikeUuid only matches actual UUIDs', () => {
  assert.ok(looksLikeUuid('11111111-1111-1111-1111-111111111111'));
  assert.ok(!looksLikeUuid('c0001'));
  assert.ok(!looksLikeUuid('INV-in01'));
  assert.ok(!looksLikeUuid(1042));
});

test('the client report contains no UUIDs anywhere', () => {
  const html = renderClientReport(report());
  const found = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
  assert.equal(found, null, `client report leaked UUIDs: ${found?.slice(0, 3)}`);
});

test('the client report drops Info findings and internal-only rules', () => {
  const html = renderClientReport(report());
  assert.doesNotMatch(html, /badge info/);
  // clinicalNotes.type.* are marked internalOnly and quote note content.
  assert.doesNotMatch(html, /written as if the client will read it/);
  assert.doesNotMatch(html, /clinical free text/);
});

test('the client report uses softened wording, not the internal rule title', () => {
  const html = renderClientReport(report());
  assert.match(html, /Email address does not look valid\./);
  assert.doesNotMatch(html, /fails the API/);
  assert.match(html, /linked to a location that no longer exists/);
  assert.doesNotMatch(html, /primaryStoreId/);
});

test('the client report keeps the reconciliation totals and every Lupa link', () => {
  const html = renderClientReport(report());
  assert.match(html, /Where the money stands/);
  assert.match(html, /Total invoiced/);
  assert.match(html, /work\.lupapets\.com\/clients\//);
});

test('the client report has contents links and a way back to the summary', () => {
  const html = renderClientReport(report());
  assert.match(html, /Record by record/);
  assert.match(html, /href="#clients"/);
  assert.match(html, /Back to summary/);
  // Summary and contents sit side by side in one row, so navigation needs no scrolling.
  assert.match(html, /class="nav-row"/);
  assert.match(html, /Fixture Veterinary Group/);
});

test('a verdict of include:false removes a finding from every client deliverable', () => {
  const verdicts = { 'clients.email.malformed': { include: false } };
  const html = renderClientReport(report(), { verdicts });
  const dock = renderDockCopy(report(), { verdicts });
  assert.doesNotMatch(html, /Email address does not look valid\./);
  assert.doesNotMatch(dock, /Email address does not look valid\./);
  // and is still present without the verdict
  assert.match(renderClientReport(report()), /Email address does not look valid\./);
});

test('Dock copy is plain text with no tables, links or UUIDs', () => {
  const dock = renderDockCopy(report());
  assert.doesNotMatch(dock, /[<>|]/);
  assert.doesNotMatch(dock, /https?:\/\//);
  assert.equal(dock.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi), null);
  assert.match(dock, /Fixture Veterinary Group/);
  assert.match(dock, /items to fix before go-live/);
});

test('the email is a draft with a subject and the agreed opening', () => {
  const { subject, body } = renderEmail(report(), { contactName: 'Sam', senderName: 'Josh' });
  assert.match(subject, /Fixture Veterinary Group/);
  assert.match(body, /^Hi Sam,/);
  assert.match(body, /findings from our first pass check/);
  assert.match(body, /Josh$/);
  assert.equal(body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi), null);
});

test('Linear tickets are only produced for findings explicitly marked for one', () => {
  assert.deepEqual(renderLinearTickets(report(), { verdicts: {} }), []);
  assert.deepEqual(renderLinearTickets(report(), {}), []);

  const tickets = renderLinearTickets(report(), {
    verdicts: { 'clients.duplicate.email': { ticket: true, note: 'merge after go-live' } },
    team: 'Engineers',
  });
  assert.equal(tickets.length, 1);
  assert.match(tickets[0].title, /Fixture Veterinary Group/);
  assert.equal(tickets[0].team, 'Engineers');
  assert.match(tickets[0].description, /merge after go-live/);
  assert.match(tickets[0].description, /clients\.duplicate\.email/);
  assert.ok(tickets[0].labels.includes('critical'));
});

test('the workbook carries record ids and clickable links', async () => {
  const { buildWorkbook } = await import('../src/deliverables.js');
  const { buildContext, runRules } = await import('../src/rules/index.js');
  const { writeReport } = await import('../src/report.js');
  const { makePull } = await import('./fixture.js');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');

  const dir = makePull();
  const ctx = buildContext(dir, { now: new Date('2026-09-20T12:00:00Z') });
  const built = buildReport(ctx, runRules(ctx));
  writeReport(dir, built);                   // writes findings.jsonl, which the workbook reads
  const wb = await buildWorkbook(dir, JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')));
  assert.ok(wb, 'a workbook should be produced');

  const names = execFileSync('unzip', ['-l', join(dir, 'findings.xlsx')], { encoding: 'utf8' });
  assert.match(names, /xl\/worksheets\/_rels\/sheet\d+\.xml\.rels/, 'hyperlink rels part is present');

  const sheet1 = execFileSync('unzip', ['-p', join(dir, 'findings.xlsx'), 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
  assert.match(sheet1, /<hyperlinks>/, 'sheet declares hyperlinks');
  assert.match(sheet1, />ID</, 'first column is the record id');
  assert.match(sheet1, />Open in Lupa</, 'last column is the link');

  const rels = execFileSync('unzip', ['-p', join(dir, 'findings.xlsx'), 'xl/worksheets/_rels/sheet1.xml.rels'], { encoding: 'utf8' });
  assert.match(rels, /work\.lupapets\.com/);
  assert.match(rels, /TargetMode="External"/);
});

test('a settings-scoped row always carries something to search for', async () => {
  const { link } = await import('../src/links.js');
  // Empty strings are not absent values to `??`, and this API returns them freely.
  assert.equal(link('product', { itemCode: '', barcode: '  ', name: 'Vettrol Vettest' }).search, 'Vettrol Vettest');
  assert.equal(link('product', { itemCode: 'IC-1', name: 'Other' }).search, 'IC-1');
  assert.equal(link('service', { name: '' }).search, undefined);
});
