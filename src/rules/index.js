// The rule engine.
//
// Order of operations:
//   1. read the reference sets and meta from the pull
//   2. stream every collection once to build identity indexes (src/indexes.js)
//   3. for each module: load its collection, run tally + rules, release it
//
// Step 3 is why a large practice fits in memory. Only one big collection is resident at
// a time; cross-record rules use the indexes from step 2 rather than holding two.
//
// Two behaviours are load-bearing:
//   - `needs`. A rule depending on a reference set the key could not read is recorded
//     as *skipped*, never as zero hits. A skipped rule that renders as a clean pass is
//     worse than no rule at all.
//   - `truncate`. Rules that legitimately match thousands of rows show the first N and
//     state the true total, so a section stays readable without misleading anyone.
import { Store } from '../store.js';
import { buildIndexes } from '../indexes.js';

import clients from './clients.js';
import pets from './pets.js';
import appointments from './appointments.js';
import products from './products.js';
import services from './services.js';
import bundles from './bundles.js';
import healthPlans from './health-plans.js';
import subscriptions from './subscriptions.js';
import reminders from './reminders.js';
import medicalRecords from './medical-records.js';
import clinicalNotes from './clinical-notes.js';
import prescriptions from './prescriptions.js';
import invoices from './invoices.js';
import payments from './payments.js';
import creditNotes from './credit-notes.js';
import refunds from './refunds.js';
import estimates from './estimates.js';
import employees from './employees.js';
import insurancePolicies from './insurance-policies.js';
import crossRecord from './cross-record.js';

// Ordered by severity impact, not alphabetically: financials and pets first, reminders
// and clinical notes near the end, per section 8.
export const MODULES = [
  invoices, payments, creditNotes, refunds, estimates,
  clients, pets, appointments,
  products, services, bundles,
  healthPlans, subscriptions,
  prescriptions, medicalRecords, insurancePolicies,
  employees, reminders, clinicalNotes,
  crossRecord,
];

export const SEVERITIES = ['critical', 'review', 'info'];

export function buildContext(dir, { now = new Date(), log = () => {} } = {}) {
  const store = new Store(dir);
  const meta = store.readJson('meta');
  if (!meta) throw new Error(`No pull found in ${dir}/ — run \`lupa-check pull\` first.`);

  const stores = store.readJson('stores', []) ?? [];
  const paymentTerms = store.readJson('paymentTerms', []) ?? [];
  const appointmentTypes = store.readJson('appointmentTypes', []) ?? [];
  const referenceLists = store.readJson('referenceLists', []) ?? [];
  const stockLocations = store.readJson('stockLocations', []) ?? [];

  const ctx = {
    meta,
    now,
    currency: meta.currency ?? 'GBP',
    vatRates: meta.vatRates ?? [0, 5, 20],
    unavailable: new Set(Object.keys(meta.unavailable ?? {})),
    counts: meta.counts ?? {},

    storeIds: new Set(stores.map((s) => s.id)),
    storeNames: new Map(stores.map((s) => [s.id, s.name ?? s.id])),
    paymentTermIds: new Set(paymentTerms.map((p) => p.id)),
    appointmentTypeIds: new Set(appointmentTypes.map((t) => t.id)),
    referenceListIds: new Set(referenceLists.map((r) => r.id)),
    stockLocationIds: new Set(stockLocations.map((l) => l.id)),
    enums: store.readJson('enums', {}) ?? {},

    store,
    _loaded: new Map(),
  };

  // How big each reference set actually came back. A set that is EMPTY is different
  // from one that failed to load, and worse: the endpoint answered, so nothing is
  // recorded as unavailable, and every record referencing it gets reported as dangling.
  // On a practice with 36k clients that is a wall of false criticals that reads as a
  // catastrophic finding. Rules depending on an empty set are skipped instead — if the
  // set is genuinely empty and nothing references it, the rule would have found nothing
  // anyway, so skipping costs nothing and never lies.
  ctx.referenceSizes = {
    stores: ctx.storeIds.size,
    paymentTerms: ctx.paymentTermIds.size,
    appointmentTypes: ctx.appointmentTypeIds.size,
    referenceLists: ctx.referenceListIds.size,
    stockLocations: ctx.stockLocationIds.size,
  };

  ctx.ix = buildIndexes(store, { log });
  ctx.referenceSizes.employees = ctx.ix.employeeIds.size;
  ctx.referenceSizes.clients = ctx.ix.clientIds.size;

  // Load a collection on demand; the engine releases it once its module has run.
  ctx.load = (key) => {
    if (!ctx._loaded.has(key)) ctx._loaded.set(key, store.readAll(key));
    return ctx._loaded.get(key);
  };
  ctx.release = (key) => ctx._loaded.delete(key);

  return ctx;
}

export function runRules(ctx, { modules = MODULES, only } = {}) {
  const sections = [];
  const wanted = only?.length ? modules.filter((m) => only.includes(m.key)) : modules;

  for (const mod of wanted) {
    // A module with no collection of its own (cross-record) gets an empty rows array.
    const rows = mod.collection === null ? [] : ctx.load(mod.collection ?? mod.key);
    ctx.rows = rows;

    const findings = [];
    const skipped = [];

    for (const rule of mod.rules) {
      const needs = rule.needs ? [rule.needs].flat() : [];
      const unreadable = needs.find((n) => ctx.unavailable.has(n));
      if (unreadable) {
        skipped.push({ id: rule.id, title: rule.title, reason: `reference set "${unreadable}" was not readable with this key` });
        continue;
      }
      const empty = needs.find((n) => ctx.referenceSizes?.[n] === 0);
      if (empty) {
        skipped.push({ id: rule.id, title: rule.title, reason: `reference set "${empty}" came back empty — every reference would be reported as dangling` });
        continue;
      }
      let hits;
      try {
        hits = rule.run(ctx, rows) ?? [];
      } catch (err) {
        skipped.push({ id: rule.id, title: rule.title, reason: `rule threw: ${err.message}` });
        continue;
      }
      if (!hits.length) continue;

      const shown = rule.truncate ? hits.slice(0, rule.truncate) : hits;
      findings.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        clientFacing: rule.clientFacing ?? rule.title,
        why: rule.why ?? null,
        internalOnly: Boolean(rule.internalOnly),
        total: hits.length,
        truncatedTo: rule.truncate && hits.length > rule.truncate ? rule.truncate : null,
        grouped: Boolean(rule.group),
        linkType: rule.linkType ?? mod.linkType,
        rows: shown.map((r) => ({
          id: r.record?.id ?? r.id ?? null,
          display: r.display,
          groupKey: r.groupKey ?? null,
          reason: r.reason ?? null,
          // Some records have no URL of their own and must borrow one — a clinical note
          // links to the pet it is filed against. `linkFor` on the module resolves that.
          link: r.link ?? (mod.linkFor && r.record ? mod.linkFor(ctx, r.record) : null),
          fields: r.fields ?? {},
        })),
      });
    }

    const counts = Object.fromEntries(
      SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).reduce((t, f) => t + f.total, 0)]),
    );

    let tally = [];
    try {
      tally = mod.tally(ctx, rows) ?? [];
    } catch (err) {
      skipped.push({ id: `${mod.key}.tally`, title: 'Tally', reason: `tally threw: ${err.message}` });
    }

    sections.push({
      key: mod.key,
      label: mod.label,
      linkType: mod.linkType,
      clientFacing: mod.clientFacing !== false,
      scanned: mod.collection === null ? (ctx.counts[mod.scannedFrom] ?? 0) : rows.length,
      ran: ctx.counts[mod.collection ?? mod.key] !== undefined || mod.collection === null,
      tally,
      findings: findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
      skipped,
      counts,
      flagged: counts.critical + counts.review + counts.info,
    });

    if (mod.collection !== null) ctx.release(mod.collection ?? mod.key);
    ctx.rows = undefined;
  }

  return sections;
}
