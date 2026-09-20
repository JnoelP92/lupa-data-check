// The rule engine. Loads a pull from disk, builds the shared context every rule reads,
// and runs each module's tally and rules.
//
// Two things here matter more than they look:
//
//   - `needs`. A rule that depends on a reference set which the key could not read is
//     recorded as *skipped*, not as zero hits. A skipped rule that renders as a clean
//     pass is worse than no rule at all.
//   - `truncate`. Some rules legitimately match thousands of rows. The report shows the
//     first N and states the true total, so a section stays readable without anyone
//     being misled about scale.
import { Store } from '../store.js';
import clients from './clients.js';

export const MODULES = [clients];

export const SEVERITIES = ['critical', 'review', 'info'];

export function buildContext(dir, { now = new Date() } = {}) {
  const store = new Store(dir);
  const meta = store.readJson('meta');
  if (!meta) throw new Error(`No pull found in ${dir}/ — run \`lupa-check pull\` first.`);

  const stores = store.readJson('stores', []);
  const paymentTerms = store.readJson('paymentTerms', []);

  const ctx = {
    meta,
    now,
    currency: meta.currency ?? 'GBP',
    unavailable: new Set(Object.keys(meta.unavailable ?? {})),
    storeIds: new Set(stores.map((s) => s.id)),
    storeNames: new Map(stores.map((s) => [s.id, s.name ?? s.id])),
    paymentTermIds: new Set(paymentTerms.map((p) => p.id)),
    employeeIds: new Set((store.readJson('employees', []) ?? []).map((e) => e.id)),
    store,
  };

  // Collections are attached lazily-ish: only the ones a loaded module asks for are
  // read into memory. With every module enabled this is the whole practice, which is
  // fine for clients/pets/products and is why the financial modules stream instead.
  for (const mod of MODULES) ctx[mod.key] = store.readAll(mod.key);
  return ctx;
}

export function runRules(ctx, { modules = MODULES } = {}) {
  const sections = [];

  for (const mod of modules) {
    const findings = [];
    const skipped = [];

    for (const rule of mod.rules) {
      if (rule.needs && ctx.unavailable.has(rule.needs)) {
        skipped.push({ id: rule.id, title: rule.title, reason: `reference set "${rule.needs}" was not readable with this key` });
        continue;
      }
      let rows;
      try {
        rows = rule.run(ctx) ?? [];
      } catch (err) {
        skipped.push({ id: rule.id, title: rule.title, reason: `rule threw: ${err.message}` });
        continue;
      }
      if (!rows.length) continue;

      const shown = rule.truncate ? rows.slice(0, rule.truncate) : rows;
      findings.push({
        id: rule.id,
        severity: rule.severity,
        title: rule.title,
        clientFacing: rule.clientFacing ?? rule.title,
        why: rule.why ?? null,
        total: rows.length,
        truncatedTo: rule.truncate && rows.length > rule.truncate ? rule.truncate : null,
        grouped: Boolean(rule.group),
        rows: shown.map((r) => ({
          id: r.record?.id ?? null,
          display: r.display,
          groupKey: r.groupKey ?? null,
          reason: r.reason ?? null,
          fields: r.fields ?? {},
        })),
      });
    }

    const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).reduce((t, f) => t + f.total, 0)]));
    sections.push({
      key: mod.key,
      label: mod.label,
      linkType: mod.linkType,
      scanned: (ctx[mod.key] ?? []).length,
      tally: mod.tally(ctx),
      findings: findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)),
      skipped,
      counts,
      flagged: counts.critical + counts.review + counts.info,
    });
  }

  return sections;
}
