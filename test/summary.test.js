import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary, renderSummaryReport } from '../src/summary-report.js';
import { makePull, CLIENTS, PETS, INVOICES } from './fixture.js';

const NOW = new Date('2026-09-20T12:00:00Z');

test('summary counts add up to what was pulled', () => {
  const s = buildSummary(makePull(), { now: NOW });
  assert.equal(s.clients.total, CLIENTS.length);
  assert.equal(s.clients.active + s.clients.archived, CLIENTS.length);
  assert.equal(s.pets.total, PETS.length);
  const bySpecies = ['Dog', 'Cat', 'Other'].reduce((t, k) => t + s.pets.species[k].active + s.pets.species[k].inactive, 0);
  assert.equal(bySpecies, PETS.length, 'every pet lands in exactly one species bucket');
});

test('revenue counts finalised invoices only, and says what it left out', () => {
  const s = buildSummary(makePull(), { now: NOW });
  const completed = INVOICES.filter((i) => i.status === 'completed').length;
  assert.ok(s.period[12].invoices <= completed);
  assert.ok(s.notes.some((n) => /draft/.test(n)), 'excluded drafts are called out, not silently dropped');
});

test('the trading window ends at the last finalised invoice, never in the future', () => {
  const s = buildSummary(makePull(), { now: NOW });
  assert.ok(new Date(s.window.end) <= new Date('2026-09-21'));
  const given = buildSummary(makePull(), { now: NOW, asOf: '2026-08-31' });
  assert.equal(given.window.end, '2026-08-31');
});

test('an unreadable collection renders as unavailable, not as zero', () => {
  const s = buildSummary(makePull({ unavailable: { prescriptions: 'HTTP 500' } }), { now: NOW });
  const rx = s.records.flatMap((g) => g.items).find((i) => i.label === 'Prescriptions');
  assert.equal(rx.value, null);
  assert.match(renderSummaryReport(s), /unavailable/);
});

test('the report is titled with the go-live date when given, and renders cleanly', () => {
  const html = renderSummaryReport(buildSummary(makePull(), { now: NOW, goLive: '2026-10-01' }));
  assert.match(html, /<title>Go-live 1 October 2026 — Fixture Veterinary Group/);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  assert.equal((html.match(/class="sheet"/g) ?? []).length, 4);
});
