#!/usr/bin/env node
// Sales and credit notes for one period, by site and Lupa category, Net / VAT / Gross.
//
//   node scripts/period-sales.js --from 2026-09-01 --to 2026-09-30 [--out DIR] [--tz Europe/London]
//   node scripts/period-sales.js ... --baseline out/period-2026-09-01_2026-09-30.snapshot.json
//
// Reads a pull from disk, like everything downstream of src/pull.js. It needs, at least:
//   lupa-check pull --env production --only invoices,creditNotes,products,services
// Pull WITHOUT --since: spotting invoices whose date moved out of the period needs every
// invoice, not only the ones touched recently.
//
// Money: line `price` is VAT-inclusive and post-line-discount (see src/rules/invoices.js),
// so gross is the line price with the invoice-level discount spread pro rata, and net is
// gross / (1 + vat%). Credit note `amount` is a decimal string; `lineItemAmount` is read
// the same way when it is a string and on the detected money scale when it is a number.
//
// What the API cannot tell us: it returns current state only, with no edit history. The
// "changes" sheet therefore shows the evidence that a figure moved (edited after the
// period closed, created in the period but now dated outside it, backdated into it,
// credited later) — not the old value. Every run writes a snapshot; pass it back as
// --baseline next time and the diff shows old and new values exactly.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { detectMoneyScale } from '../src/money.js';
import { writeXlsx } from '../src/xlsx.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const [flag, inline] = argv[i].slice(2).split('=');
    out[flag] = inline ?? (argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (typeof args.from !== 'string' || typeof args.to !== 'string') {
  console.error('Usage: node scripts/period-sales.js --from YYYY-MM-DD --to YYYY-MM-DD [--out DIR] [--baseline FILE]');
  process.exit(1);
}
const FROM = args.from, TO = args.to;
const TZ = typeof args.tz === 'string' ? args.tz : 'Europe/London';
const dir = resolve(String(args.out ?? join(ROOT, 'out')));
const store = new Store(dir);
for (const key of ['invoices', 'creditNotes', 'products', 'services']) {
  if (!existsSync(store.jsonlPath(key))) throw new Error(`No ${key}.jsonl in ${dir}/ — pull it first.`);
}

const meta = store.readJson('meta', {});
const stores = store.readJson('stores', []);
const referenceLists = store.readJson('referenceLists', []);
const { divisor, reason: scaleReason } = detectMoneyScale(store);

// The practice's calendar day, not UTC's: a 00:30 BST invoice on 1 October is October.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const localDay = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : dayFmt.format(d);
};
const inPeriod = (day) => day !== null && day >= FROM && day <= TO;
const afterPeriod = (day) => day !== null && day > TO;

const r2 = (n) => Math.round(n * 100) / 100;
const minor = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) / divisor);
const decimal = (v) => (v === null || v === undefined || v === '' ? 0 : typeof v === 'string' ? Number(v) : Number(v) / divisor);
const net = (gross, vat) => gross / (1 + (Number(vat) || 0) / 100);

const storeName = new Map(stores.map((s) => [s.id, s.name ?? s.id]));
const storeVat = new Map(stores.map((s) => [s.id, Number(s.vatPercentage)]));
const listName = new Map(referenceLists.map((l) => [l.id, l.name]));
const siteOf = (id) => storeName.get(id) ?? (id ? `store ${id.slice(0, 8)}` : '(no store)');

const catalogue = { product: new Map(), service: new Map() };
for (const p of store.read('products')) catalogue.product.set(p.id, p);
for (const s of store.read('services')) catalogue.service.set(s.id, s);

function describe(kind, itemId) {
  const item = catalogue[kind].get(itemId);
  return {
    category: item?.category ?? (item ? '(none)' : '(not in catalogue)'),
    referenceList: item?.referenceListId ? (listName.get(item.referenceListId) ?? item.referenceListId) : '',
  };
}

// Invoice-level discount, spread across lines pro rata to their gross.
function discountFactor(inv, lineGross) {
  const d = Number(inv.discountAmount ?? 0);
  if (!d || !lineGross) return 1;
  if (inv.discountType === '%') return (100 - d) / 100;
  if (inv.discountType === '£') return (lineGross - d / divisor) / lineGross;
  return 1;
}

function invoiceLines(inv) {
  const raw = [
    ...(inv.billingProducts ?? []).map((l) => ({ ...l, kind: 'product', itemId: l.productId })),
    ...(inv.billingServices ?? []).map((l) => ({ ...l, kind: 'service', itemId: l.serviceId })),
  ];
  const lineGross = raw.reduce((t, l) => t + minor(l.price), 0);
  const f = discountFactor(inv, lineGross);
  return raw.map((l) => {
    const vat = l.vatPercentage ?? storeVat.get(inv.storeId) ?? 0;
    const gross = minor(l.price) * f;
    return { ...l, vat: Number(vat), gross, net: net(gross, vat) };
  });
}

// ---- One pass over invoices ---------------------------------------------------------
const lineIndex = new Map(); // billing line id -> { inv, line }, for credit note items
const periodInvoices = [];
const changes = [];
const snapshot = { from: FROM, to: TO, takenAt: new Date().toISOString(), invoices: {}, creditNotes: {} };

for (const inv of store.read('invoices')) {
  const lines = invoiceLines(inv);
  for (const l of lines) if (l.id) lineIndex.set(l.id, { inv, line: l });

  const dated = localDay(inv.activeFrom ?? inv.createdAt);
  const created = localDay(inv.createdAt);
  const updated = localDay(inv.updatedAt);
  const status = inv.status ?? '';
  const gross = lines.reduce((t, l) => t + l.gross, 0);
  const base = {
    site: siteOf(inv.storeId), invoice: inv.invoiceNumber ?? inv.id, status,
    invoiceDate: dated ?? '', createdOn: created ?? '', updatedOn: updated ?? '', gross: r2(gross),
  };

  if (inPeriod(dated)) {
    periodInvoices.push({ inv, lines, dated });
    snapshot.invoices[inv.id] = { number: inv.invoiceNumber, status, dated, gross: r2(gross), updatedAt: inv.updatedAt };
    if (status === 'completed' && afterPeriod(updated)) changes.push({ ...base, change: 'Edited after the period closed', detail: `updatedAt ${inv.updatedAt}` });
    if (afterPeriod(created)) changes.push({ ...base, change: 'Created after the period, dated into it (backdated)', detail: `created ${created}, dated ${dated}` });
    if (status === 'archived') changes.push({ ...base, change: 'Dated in the period but now archived', detail: afterPeriod(updated) ? `archived on/after ${updated}` : '' });
    if (status === 'draft') changes.push({ ...base, change: 'Dated in the period but still draft', detail: '' });
  } else if (inPeriod(created) && dated && status !== 'estimate') {
    changes.push({ ...base, change: 'Created in the period, now dated outside it', detail: `created ${created}, dated ${dated}` });
  }
}

// ---- Sales by site × type × category --------------------------------------------------
const salesKey = (...k) => k.join('\u0000');
const sales = new Map();
const lineRows = [];
let completedCount = 0;
for (const { inv, lines, dated } of periodInvoices) {
  if (inv.status !== 'completed') continue;
  completedCount++;
  for (const l of lines) {
    const { category, referenceList } = describe(l.kind, l.itemId);
    const site = siteOf(inv.storeId);
    const k = salesKey(site, l.kind, category);
    const agg = sales.get(k) ?? { site, type: l.kind, category, lines: 0, qty: 0, net: 0, vat: 0, gross: 0 };
    agg.lines++; agg.qty += Number(l.quantity ?? 0);
    agg.net += l.net; agg.vat += l.gross - l.net; agg.gross += l.gross;
    sales.set(k, agg);
    lineRows.push([site, dated, inv.invoiceNumber ?? inv.id, l.kind, category, referenceList, l.name ?? '',
      Number(l.quantity ?? 0), l.vat, r2(l.net), r2(l.gross - l.net), r2(l.gross)]);
  }
}

// ---- Credit notes -------------------------------------------------------------------
const credits = new Map();
const cnRows = [];
const cnItemRows = [];
for (const cn of store.read('creditNotes')) {
  const issued = localDay(cn.issuedAt ?? cn.createdAt);
  const updated = localDay(cn.updatedAt);
  const site = siteOf(cn.storeId);
  const items = cn.items ?? [];

  // Credits issued after the period against invoices dated in it change that month's net.
  const anyInvoiceInPeriod = items.some((it) => {
    const hit = lineIndex.get(it.billingProductId ?? it.billingServiceId);
    return hit && inPeriod(localDay(hit.inv.activeFrom ?? hit.inv.createdAt));
  });
  if (afterPeriod(issued) && anyInvoiceInPeriod && cn.status !== 'void') {
    changes.push({ site, invoice: `CN ${cn.id.slice(0, 8)}`, status: cn.status, invoiceDate: '', createdOn: localDay(cn.createdAt) ?? '',
      updatedOn: updated ?? '', gross: r2(decimal(cn.amount)), change: 'Credited after the period against an invoice dated in it', detail: `issued ${issued}` });
  }
  if (!inPeriod(issued)) continue;
  if (afterPeriod(updated)) {
    changes.push({ site, invoice: `CN ${cn.id.slice(0, 8)}`, status: cn.status, invoiceDate: issued, createdOn: localDay(cn.createdAt) ?? '',
      updatedOn: updated, gross: r2(decimal(cn.amount)), change: 'Credit note in the period edited after it closed', detail: `updatedAt ${cn.updatedAt}` });
  }
  snapshot.creditNotes[cn.id] = { status: cn.status, issued, amount: r2(decimal(cn.amount)), updatedAt: cn.updatedAt };

  let itemGross = 0, itemNet = 0;
  for (const it of items) {
    const isProduct = Boolean(it.billingProductId);
    const nested = isProduct ? it.billingProduct : it.billingService;
    const hit = lineIndex.get(it.billingProductId ?? it.billingServiceId);
    const kind = isProduct ? 'product' : 'service';
    const itemId = nested?.productId ?? nested?.serviceId ?? hit?.line.itemId;
    const { category, referenceList } = describe(kind, itemId);
    const vat = Number(nested?.vatPercentage ?? hit?.line.vat ?? storeVat.get(cn.storeId) ?? 0);
    const gross = decimal(it.lineItemAmount);
    const n = net(gross, vat);
    itemGross += gross; itemNet += n;
    cnItemRows.push([site, issued, `CN ${cn.id.slice(0, 8)}`, cn.status ?? '', cn.reason ?? '',
      hit?.inv.invoiceNumber ?? '', localDay(hit?.inv.activeFrom) ?? '', kind, category, referenceList,
      nested?.name ?? hit?.line.name ?? '', Number(it.creditQuantity ?? 0), vat, r2(n), r2(gross - n), r2(gross)]);
    if (cn.status === 'issued') {
      const k = salesKey(site, kind, category);
      const agg = credits.get(k) ?? { site, type: kind, category, lines: 0, qty: 0, net: 0, vat: 0, gross: 0 };
      agg.lines++; agg.qty += Number(it.creditQuantity ?? 0);
      agg.net += n; agg.vat += gross - n; agg.gross += gross;
      credits.set(k, agg);
    }
  }
  const extra = decimal(cn.additionalCreditAmount);
  cnRows.push([site, issued, `CN ${cn.id.slice(0, 8)}`, cn.status ?? '', cn.reason ?? '', items.length,
    r2(itemNet), r2(itemGross - itemNet), r2(itemGross), r2(extra), r2(decimal(cn.amount)), cn.id]);
}

// ---- Baseline diff --------------------------------------------------------------------
const baselineRows = [];
if (typeof args.baseline === 'string') {
  const prev = JSON.parse(readFileSync(args.baseline, 'utf8'));
  for (const [kind, label] of [['invoices', 'invoice'], ['creditNotes', 'credit note']]) {
    const now = snapshot[kind], before = prev[kind] ?? {};
    for (const id of new Set([...Object.keys(now), ...Object.keys(before)])) {
      const a = before[id], b = now[id];
      const name = (b ?? a).number ?? `CN ${id.slice(0, 8)}`;
      if (!a) baselineRows.push([label, name, 'Added since baseline', '', '', JSON.stringify(b)]);
      else if (!b) baselineRows.push([label, name, 'No longer in the period (re-dated or removed)', JSON.stringify(a), '', '']);
      else for (const f of ['status', 'dated', 'issued', 'gross', 'amount']) {
        if (f in a && a[f] !== b[f]) baselineRows.push([label, name, `${f} changed`, String(a[f]), String(b[f]), b.updatedAt ?? '']);
      }
    }
  }
}

// ---- Output -------------------------------------------------------------------------
const sortAgg = (m) => [...m.values()].sort((a, b) => a.site.localeCompare(b.site) || a.type.localeCompare(b.type) || a.category.localeCompare(b.category));
const aggRows = (m) => {
  const rows = sortAgg(m).map((a) => [a.site, a.type, a.category, a.lines, r2(a.qty), r2(a.net), r2(a.vat), r2(a.gross)]);
  const bySite = new Map();
  for (const a of m.values()) {
    const t = bySite.get(a.site) ?? { lines: 0, qty: 0, net: 0, vat: 0, gross: 0 };
    t.lines += a.lines; t.qty += a.qty; t.net += a.net; t.vat += a.vat; t.gross += a.gross;
    bySite.set(a.site, t);
  }
  for (const [site, t] of [...bySite].sort()) rows.push([site, 'TOTAL', '', t.lines, r2(t.qty), r2(t.net), r2(t.vat), r2(t.gross)]);
  const all = [...bySite.values()].reduce((t, x) => ({ lines: t.lines + x.lines, net: t.net + x.net, vat: t.vat + x.vat, gross: t.gross + x.gross }), { lines: 0, net: 0, vat: 0, gross: 0 });
  rows.push(['ALL SITES', 'TOTAL', '', all.lines, '', r2(all.net), r2(all.vat), r2(all.gross)]);
  return rows;
};
const aggHeaders = ['Site', 'Type', 'Lupa category', 'Lines', 'Qty', 'Net', 'VAT', 'Gross'];
const changeHeaders = ['Site', 'Record', 'Status', 'Dated', 'Created', 'Last updated', 'Gross now', 'What changed', 'Detail'];
const changeRows = changes.map((c) => [c.site, c.invoice, c.status, c.invoiceDate, c.createdOn, c.updatedOn, c.gross, c.change, c.detail]);

const stem = join(dir, `period-${FROM}_${TO}`);
const sheets = [
  { name: 'Sales by category', headers: aggHeaders, rows: aggRows(sales) },
  { name: 'Credits by category', headers: aggHeaders, rows: aggRows(credits) },
  { name: 'Invoice lines', headers: ['Site', 'Invoice date', 'Invoice', 'Type', 'Lupa category', 'Reference list', 'Item', 'Qty', 'VAT %', 'Net', 'VAT', 'Gross'], rows: lineRows },
  { name: 'Credit notes', headers: ['Site', 'Issued', 'Credit note', 'Status', 'Reason', 'Items', 'Items net', 'Items VAT', 'Items gross', 'Additional credit', 'Amount', 'Id'], rows: cnRows },
  { name: 'Credit note items', headers: ['Site', 'Issued', 'Credit note', 'Status', 'Reason', 'Invoice', 'Invoice date', 'Type', 'Lupa category', 'Reference list', 'Item', 'Qty', 'VAT %', 'Net', 'VAT', 'Gross'], rows: cnItemRows },
  { name: 'Changes since period', headers: changeHeaders, rows: changeRows },
  ...(baselineRows.length || args.baseline ? [{ name: 'Diff vs baseline', headers: ['Type', 'Record', 'Change', 'Before', 'After', 'Updated at'], rows: baselineRows }] : []),
];
writeXlsx(`${stem}.xlsx`, sheets);
writeFileSync(`${stem}.snapshot.json`, JSON.stringify(snapshot));

const notCompleted = periodInvoices.filter((p) => p.inv.status !== 'completed').length;
const changeCounts = changes.reduce((m, c) => m.set(c.change, (m.get(c.change) ?? 0) + 1), new Map());
console.error(`${meta.company?.name ?? 'Practice'} · ${FROM} to ${TO} (${TZ}) · pulled ${meta.finishedAt ?? '?'} from ${meta.environment ?? '?'}`);
console.error(`Money scale: ${divisor === 1 ? 'major' : 'minor'} units (${scaleReason})`);
console.error(`Invoices dated in period: ${periodInvoices.length} (${completedCount} completed, ${notCompleted} other)`);
console.error(`Credit notes issued in period: ${cnRows.length} (${cnItemRows.length} items)`);
for (const [site, t] of new Map(aggRows(sales).filter((r) => r[1] === 'TOTAL').map((r) => [r[0], r]))) {
  console.error(`  sales   ${site.padEnd(28)} net ${String(t[5]).padStart(12)}  vat ${String(t[6]).padStart(11)}  gross ${String(t[7]).padStart(12)}`);
}
for (const [site, t] of new Map(aggRows(credits).filter((r) => r[1] === 'TOTAL').map((r) => [r[0], r]))) {
  console.error(`  credits ${site.padEnd(28)} net ${String(t[5]).padStart(12)}  vat ${String(t[6]).padStart(11)}  gross ${String(t[7]).padStart(12)}`);
}
for (const [what, n] of changeCounts) console.error(`  change: ${what} — ${n}`);
console.error(`\nWrote ${stem}.xlsx and ${stem}.snapshot.json`);
