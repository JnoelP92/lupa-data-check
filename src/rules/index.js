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
import { detectMoneyScale } from '../money.js';
import { setMoneyScale } from '../util.js';

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

// No rule renders more than this many rows into the report, whatever it matched. The
// full set always goes to findings.jsonl. A finding with 80,000 rows in a document is
// not more informative than one with 100 rows and an honest total — it is just
// unopenable.
export const MAX_ROWS = 100;

// A rule that matches most of its category is not listing exceptions, it is describing
// the dataset. "236,515 prescriptions have no expiry date" is one fact about a
// migration; printed as 236,515 findings it buries everything else in the report.
// Findings over this share of their category are reported as characteristics instead,
// counted separately from the actionable totals.
export const SATURATION_SHARE = 0.5;
export const SATURATION_MIN = 100;

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

  // Before any rule runs, and before any money is formatted.
  ctx.money = meta.moneyScale ?? detectMoneyScale(store);
  setMoneyScale(ctx.money.divisor);
  ctx.moneyTolerance = ctx.money.tolerance;
  log(`  money: ${ctx.money.units} units — ${ctx.money.reason}`);

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
    const rows = mod.collection === null ? [] : mod.fromJson ? (ctx.store.readJson(mod.key, []) ?? []) : ctx.load(mod.collection ?? mod.key);
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

      const cap = Math.min(rule.truncate ?? MAX_ROWS, MAX_ROWS);
      // What this rule ranged over. Cross-record rules own no collection and each one
      // scans something different — a pet rule against 72,258 pets, a client rule
      // against 36,669 clients — so they name it. Without this the denominator falls
      // back to 1 and every cross-record finding looks like 100% of its category.
      const scannedCount = rule.scanOf
        ? (ctx.counts[rule.scanOf] ?? 0)
        : (rows.length || (mod.collection === null ? (ctx.counts[mod.scannedFrom] ?? 0) : 0));
      const systemic = scannedCount > 0
        && hits.length >= SATURATION_MIN
        && hits.length / scannedCount >= SATURATION_SHARE;
      // A saturated rule needs a handful of examples, not a hundred.
      const shown = hits.slice(0, systemic ? 3 : cap);
      // Duplicate rules list every member; the useful number is how many collisions
      // there are. 302 products sharing one placeholder code is one problem.
      const groupCount = rule.group ? new Set(hits.map((h) => h.groupKey)).size : null;

      const withStore = (r) => {
        if (!mod.storeFrom) return r.fields ?? {};
        const id = mod.storeFrom(r.record ?? {});
        if (!id) return r.fields ?? {};
        return { store: ctx.storeNames.get(id) ?? id, ...(r.fields ?? {}) };
      };

      findings.push({
        id: rule.id,
        severity: rule.severity,
        systemic,
        share: scannedCount > 0 ? Math.round((hits.length / scannedCount) * 100) : null,
        groupCount,
        title: rule.title,
        clientFacing: rule.clientFacing ?? rule.title,
        why: rule.why ?? null,
        internalOnly: Boolean(rule.internalOnly),
        total: hits.length,
        truncatedTo: hits.length > shown.length ? shown.length : null,
        grouped: Boolean(rule.group),
        linkType: rule.linkType ?? mod.linkType,
        // Which store a record belongs to, resolved once here rather than repeated in
        // every rule's fields. Multi-site practices need it on every row to be readable
        // at all, and it costs a single-site practice one narrow column.
        // (applied below via withStore)
        allRows: hits.map((r) => ({
          id: r.record?.id ?? r.id ?? null,
          display: r.display,
          fields: withStore(r),
        })),
        rows: shown.map((r) => ({
          id: r.record?.id ?? r.id ?? null,
          display: r.display,
          groupKey: r.groupKey ?? null,
          reason: r.reason ?? null,
          // Some records have no URL of their own and must borrow one — a clinical note
          // links to the pet it is filed against. `linkFor` on the module resolves that.
          link: r.link ?? (mod.linkFor && r.record ? mod.linkFor(ctx, r.record) : null),
          fields: withStore(r),
        })),
      });
    }

    // Systemic findings are counted apart, so the headline numbers stay a list of
    // things to work through rather than a restatement of the collection size.
    const actionable = findings.filter((f) => !f.systemic);
    const counts = Object.fromEntries(
      SEVERITIES.map((s) => [s, actionable.filter((f) => f.severity === s).reduce((t, f) => t + f.total, 0)]),
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
      // Zero records is not zero findings. A collection that came back empty has not
      // been checked, and must never render as a category that passed.
      empty: mod.collection !== null && rows.length === 0,
      fromJson: Boolean(mod.fromJson),
      tally,
      findings: findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
      skipped,
      counts,
      systemicCount: findings.filter((f) => f.systemic).length,
      flagged: counts.critical + counts.review + counts.info,
    });

    if (mod.collection !== null && !mod.fromJson) ctx.release(mod.collection ?? mod.key);
    ctx.rows = undefined;
  }

  return sections;
}
