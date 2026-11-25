// The preliminary data report: what came across, and what the money looks like.
//
// A different document from the findings report. That one lists what is wrong; this one
// is the go-live summary a practice and the deployment team look at first — how many of
// each record type were converted, and the trading picture over the last year, so the
// numbers can be held up against the old PMS.
//
// Reads only what `pull` wrote. Every figure is computed from the files under out/, and
// the computed figures are written to summary.json beside the HTML, so a number on the
// page can always be traced back.
//
// Fields read here are all in spec-fields.json. check-fields.js only scans the rule
// modules, so keep to that list by hand when changing this file.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './store.js';
import { detectMoneyScale } from './money.js';
import { setMoneyScale, moneyScale, parseDate, isBlank } from './util.js';

const DAY = 86_400_000;
const PERIODS = [1, 3, 6, 12];

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lower = (v) => String(v ?? '').trim().toLowerCase();
const isoDay = (d) => d.toISOString().slice(0, 10);

// Finalised invoices only. Drafts and estimates are not revenue, and an archived invoice
// is one the practice withdrew.
const INVOICE_COUNTED = new Set(['completed']);
// Money that actually arrived. A payment later refunded still arrived — the refund is
// reported on its own line — so excluding it here would count the refund twice.
const PAYMENT_COUNTED = new Set(['completed', 'captured', 'authorized', 'refunded']);
const CREDIT_COUNTED = new Set(['issued']);
const REFUND_COUNTED = new Set(['completed']);

const SPECIES = (s) => {
  const v = lower(s);
  if (['dog', 'canine', 'k9'].includes(v)) return 'Dog';
  if (['cat', 'feline'].includes(v)) return 'Cat';
  return 'Other';
};

const minusMonths = (d, n) => {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() - n);
  return out;
};

const monthKey = (d) => d.toISOString().slice(0, 7);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
const longDate = (d) => d ? `${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}` : '—';

// The single most common calendar day among a set of dates, and its share. A migration
// stamps every record it writes with the day it ran, so this is how both the migration
// date and "these payment dates are not real" are spotted.
function modalDay(dates) {
  const counts = new Map();
  for (const d of dates) if (d) counts.set(isoDay(d), (counts.get(isoDay(d)) ?? 0) + 1);
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best ? { day: best, count: n, share: dates.length ? n / dates.length : 0 } : null;
}

function* rows(store, key) {
  yield* store.read(key);
}

const count = (store, key) => {
  let n = 0;
  for (const _ of rows(store, key)) n++;
  return n;
};

export function buildSummary(dir, { now = new Date(), goLive, migrated, asOf } = {}) {
  const store = new Store(dir);
  const meta = store.readJson('meta');
  if (!meta) throw new Error(`No pull found in ${dir}/ — run \`lupa-check pull\` first.`);

  const scale = meta.moneyScale ?? detectMoneyScale(store);
  setMoneyScale(scale.divisor);
  const currency = meta.currency ?? 'GBP';
  const unavailable = Object.keys(meta.unavailable ?? {});
  const pulled = (key) => existsSync(store.jsonlPath(key)) && !unavailable.includes(key);
  const notes = [];

  // ---- Records converted ---------------------------------------------------------

  const clients = { total: 0, active: 0, archived: 0, inCredit: 0, inDebt: 0, balance: 0 };
  const clientCreated = [];
  for (const c of rows(store, 'clients')) {
    clients.total++;
    if (c.isArchived === true) clients.archived++; else clients.active++;
    const bal = Number(c.balance ?? 0);
    clients.balance += bal;
    if (bal > 0) clients.inDebt++;
    if (bal < 0) clients.inCredit++;
    clientCreated.push(parseDate(c.createdAt));
  }

  const pets = { total: 0, deceased: 0, species: {} };
  for (const s of ['Dog', 'Cat', 'Other']) pets.species[s] = { active: 0, inactive: 0, deceased: 0 };
  const otherSpecies = new Map();
  for (const p of rows(store, 'pets')) {
    pets.total++;
    const sp = SPECIES(p.species);
    if (sp === 'Other') {
      const name = isBlank(p.species) ? 'Not recorded' : String(p.species).trim();
      otherSpecies.set(name, (otherSpecies.get(name) ?? 0) + 1);
    }
    const links = p.clientsPets ?? [];
    const dead = p.deceased === true;
    const unowned = links.length > 0 && links.every((cp) => cp.isArchived === true);
    if (dead) { pets.deceased++; pets.species[sp].deceased++; }
    if (dead || unowned) pets.species[sp].inactive++; else pets.species[sp].active++;
  }
  pets.otherSpecies = [...otherSpecies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const products = { total: 0, active: 0, archived: 0, prescriptionOnly: 0 };
  for (const p of rows(store, 'products')) {
    products.total++;
    if (p.isArchived === true) products.archived++; else products.active++;
    if (p.requiresPrescription === true) products.prescriptionOnly++;
  }

  const medical = { total: 0, vaccinations: 0 };
  for (const m of rows(store, 'medicalRecords')) {
    medical.total++;
    if (lower(m.category) === 'vaccination') medical.vaccinations++;
  }

  const employees = store.readJson('employees', null) ?? [...rows(store, 'employees')];
  const employeeName = new Map(employees.map((e) => [e.id, [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || 'Unnamed']));
  const employeeRole = new Map(employees.map((e) => [e.id, e.role ?? '']));

  // ---- Trading window --------------------------------------------------------------

  const invoices = [];
  for (const i of rows(store, 'invoices')) {
    const date = parseDate(i.activeFrom) ?? parseDate(i.createdAt);
    invoices.push({
      id: i.id, status: lower(i.status), date,
      value: Number(i.amountDue ?? 0), paid: Number(i.amountPaid ?? 0),
      vets: i.appointmentEmployeeIds ?? [], createdBy: i.createdByEmployeeId,
    });
  }
  const counted = invoices.filter((i) => INVOICE_COUNTED.has(i.status) && i.date);

  // The report looks back from the end of the migrated trading history, not from today:
  // a migration rehearsed in November against data extracted in October would otherwise
  // show an empty "last month".
  const lastTrading = counted.reduce((m, i) => (i.date <= now && (!m || i.date > m) ? i.date : m), null);
  const end = asOf ? new Date(`${asOf}T23:59:59Z`) : (lastTrading ? new Date(`${isoDay(lastTrading)}T23:59:59Z`) : now);
  const starts = Object.fromEntries(PERIODS.map((m) => [m, minusMonths(end, m)]));
  const inPeriod = (d, m) => d && d > starts[m] && d <= end;

  const months = [];
  for (let k = 11; k >= 0; k--) months.push(monthKey(minusMonths(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 15)), k)));
  const monthly = Object.fromEntries(months.map((k) => [k, { invoiced: 0, invoices: 0, payments: 0, credits: 0, refunds: 0, appointments: 0 }]));

  const period = Object.fromEntries(PERIODS.map((m) => [m, {
    invoices: 0, invoiced: 0, credits: 0, creditCount: 0, payments: 0, paymentCount: 0,
    refunds: 0, refundCount: 0, appointments: 0,
  }]));

  for (const i of counted) {
    for (const m of PERIODS) if (inPeriod(i.date, m)) { period[m].invoices++; period[m].invoiced += i.value; }
    const mk = monthly[monthKey(i.date)];
    if (mk && i.date <= end) { mk.invoiced += i.value; mk.invoices++; }
  }

  // Average and median over the year, on finalised invoices.
  const yearValues = counted.filter((i) => inPeriod(i.date, 12)).map((i) => i.value).sort((a, b) => a - b);
  const median = yearValues.length ? yearValues[Math.floor(yearValues.length / 2)] : 0;

  const payDates = [];
  const methods = new Map();
  for (const p of rows(store, 'payments')) {
    const date = parseDate(p.createdAt);
    payDates.push(date);
    if (!PAYMENT_COUNTED.has(lower(p.status)) || !date) continue;
    const amt = Number(p.amount ?? 0);
    for (const m of PERIODS) if (inPeriod(date, m)) { period[m].payments += amt; period[m].paymentCount++; }
    if (inPeriod(date, 12)) {
      const key = p.method ?? 'not recorded';
      const e = methods.get(key) ?? { count: 0, value: 0 };
      e.count++; e.value += amt; methods.set(key, e);
    }
    const mk = monthly[monthKey(date)];
    if (mk && date <= end) mk.payments += amt;
  }

  for (const c of rows(store, 'creditNotes')) {
    const date = parseDate(c.issuedAt) ?? parseDate(c.createdAt);
    if (!CREDIT_COUNTED.has(lower(c.status)) || !date) continue;
    // Credit note amounts arrive as major-unit strings whatever the other fields do.
    const amt = isBlank(c.amount) ? 0 : Number(c.amount) * moneyScale();
    for (const m of PERIODS) if (inPeriod(date, m)) { period[m].credits += amt; period[m].creditCount++; }
    const mk = monthly[monthKey(date)];
    if (mk && date <= end) mk.credits += amt;
  }

  for (const r of rows(store, 'refunds')) {
    const date = parseDate(r.createdAt);
    if (!REFUND_COUNTED.has(lower(r.status)) || !date) continue;
    const amt = Number(r.amount ?? 0);
    for (const m of PERIODS) if (inPeriod(date, m)) { period[m].refunds += amt; period[m].refundCount++; }
    const mk = monthly[monthKey(date)];
    if (mk && date <= end) mk.refunds += amt;
  }

  // ---- Appointments, and the vet behind each invoice ---------------------------------

  const statusNames = new Map((store.readJson('appointmentStatuses', []) ?? []).map((s) => [s.id, s.name ?? s.label ?? s.id]));
  const appointments = { total: 0, historic: 0, future: 0, migrated: 0, byStatus: new Map() };
  const vetByInvoice = new Map();
  const apptCreated = [];
  for (const a of rows(store, 'appointments')) {
    appointments.total++;
    const start = parseDate(a.start);
    if (start && start > now) appointments.future++; else appointments.historic++;
    if (lower(a.createdFrom) === 'migration') appointments.migrated++;
    apptCreated.push(parseDate(a.createdAt));
    const main = (a.employees ?? []).find((e) => e.isMainEmployee) ?? (a.employees ?? [])[0];
    if (a.storeInvoiceId && main?.id) vetByInvoice.set(a.storeInvoiceId, main.id);
    if (!start) continue;
    for (const m of PERIODS) if (inPeriod(start, m)) period[m].appointments++;
    if (inPeriod(start, 12)) {
      const s = statusNames.get(a.status) ?? a.status ?? 'not recorded';
      appointments.byStatus.set(s, (appointments.byStatus.get(s) ?? 0) + 1);
    }
    const mk = monthly[monthKey(start)];
    if (mk && start <= end) mk.appointments++;
  }

  // Revenue by vet. Attribution, in order of how directly it names the clinician:
  // the main employee on the appointment the invoice belongs to, then the first
  // appointment employee carried on the invoice, then whoever raised it.
  const byVet = Object.fromEntries(PERIODS.map((m) => [m, new Map()]));
  const basis = { appointment: 0, invoice: 0, creator: 0, none: 0 };
  for (const i of counted) {
    if (!inPeriod(i.date, 12)) continue;
    let who = vetByInvoice.get(i.id), how = 'appointment';
    if (!who && i.vets.length) { who = i.vets[0]; how = 'invoice'; }
    if (!who && i.createdBy) { who = i.createdBy; how = 'creator'; }
    if (!who) how = 'none';
    basis[how]++;
    const key = who ?? '__none__';
    for (const m of PERIODS) {
      if (!inPeriod(i.date, m)) continue;
      const e = byVet[m].get(key) ?? { invoices: 0, value: 0 };
      e.invoices++; e.value += i.value;
      byVet[m].set(key, e);
    }
  }
  const vets = [...byVet[12].entries()]
    .map(([id, e]) => ({
      id,
      name: id === '__none__' ? 'Not attributed' : (employeeName.get(id) ?? 'Unknown employee'),
      role: id === '__none__' ? '' : (employeeRole.get(id) ?? ''),
      invoices: e.invoices, value: e.value,
      byPeriod: Object.fromEntries(PERIODS.map((m) => [m, byVet[m].get(id)?.value ?? 0])),
    }))
    .sort((a, b) => (a.id === '__none__') - (b.id === '__none__') || b.value - a.value);

  // ---- Dates, and what they say about the data -----------------------------------

  const migratedDay = migrated ?? modalDay(clientCreated.filter(Boolean))?.day ?? null;
  const migratedDate = migratedDay ? new Date(`${migratedDay}T12:00:00Z`) : null;
  const goLiveDate = goLive ? new Date(`${goLive}T12:00:00Z`) : null;

  const payDay = modalDay(payDates.filter(Boolean));
  if (payDay && payDay.share > 0.5 && payDates.length >= 20) {
    notes.push(`${Math.round(payDay.share * 100)}% of payments carry the date ${longDate(new Date(`${payDay.day}T12:00:00Z`))}. That looks like the day they were migrated rather than the day they were taken, so payments by period below are not a true trading history.`);
  }
  if (!counted.length) notes.push('No finalised invoices came across, so there is no trading history to report.');
  const excluded = invoices.length - counted.length;
  if (excluded) {
    const s = new Map();
    for (const i of invoices) if (!INVOICE_COUNTED.has(i.status)) s.set(i.status || 'no status', (s.get(i.status || 'no status') ?? 0) + 1);
    notes.push(`Revenue counts finalised (completed) invoices only. ${excluded.toLocaleString()} others are left out: ${[...s.entries()].map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ')}.`);
  }
  if (basis.creator + basis.none > 0 && counted.length) {
    const yr = basis.appointment + basis.invoice + basis.creator + basis.none;
    if (basis.creator + basis.none > yr * 0.25) {
      notes.push(`Revenue by vet: ${Math.round(((basis.appointment + basis.invoice) / yr) * 100)}% of the year's invoices name a clinician directly. The rest fall back to whoever raised the invoice${basis.none ? ', or are shown as not attributed' : ''}, so treat that chart as indicative.`);
    }
  }
  if (unavailable.length) notes.push(`Could not be read from Lupa, so not counted: ${unavailable.join(', ')}. These are shown as unavailable, not as zero.`);

  const n = (key, fn) => (pulled(key) ? fn() : null);

  const records = [
    { group: 'Clients and patients', items: [
      { label: 'Clients — active', value: n('clients', () => clients.active) },
      { label: 'Clients — inactive (archived)', value: n('clients', () => clients.archived) },
      { label: 'Clients — total', value: n('clients', () => clients.total), strong: true },
      { label: 'Patients — total', value: n('pets', () => pets.total), strong: true },
      { label: 'Patients — deceased', value: n('pets', () => pets.deceased) },
      { label: 'Insurance policies', value: n('insurancePolicies', () => count(store, 'insurancePolicies')) },
    ] },
    { group: 'Catalogue', items: [
      { label: 'Products — active', value: n('products', () => products.active) },
      { label: 'Products — archived', value: n('products', () => products.archived) },
      { label: 'Products — prescription only', value: n('products', () => products.prescriptionOnly) },
      { label: 'Services', value: n('services', () => count(store, 'services')) },
      { label: 'Bundles', value: n('bundles', () => count(store, 'bundles')) },
      { label: 'Health plans', value: n('healthPlans', () => count(store, 'healthPlans')) },
      { label: 'Health plan subscriptions', value: n('healthPlanSubscriptions', () => count(store, 'healthPlanSubscriptions')) },
    ] },
    { group: 'Clinical history', items: [
      { label: 'Medical records', value: n('medicalRecords', () => medical.total) },
      { label: '… of which vaccinations', value: n('medicalRecords', () => medical.vaccinations) },
      { label: 'Clinical notes', value: n('clinicalNotes', () => count(store, 'clinicalNotes')) },
      { label: 'Prescriptions', value: n('prescriptions', () => count(store, 'prescriptions')) },
      { label: 'Reminder templates', value: n('reminders', () => count(store, 'reminders')) },
    ] },
    { group: 'Diary', items: [
      { label: 'Appointments — historic', value: n('appointments', () => appointments.historic) },
      { label: 'Appointments — future (booked)', value: n('appointments', () => appointments.future) },
      { label: 'Staff records', value: employees.length },
    ] },
    { group: 'Financial', items: [
      { label: 'Invoices', value: n('invoices', () => invoices.length) },
      { label: '… finalised', value: n('invoices', () => counted.length) },
      { label: 'Payments', value: n('payments', () => payDates.length) },
      { label: 'Credit notes', value: n('creditNotes', () => count(store, 'creditNotes')) },
      { label: 'Refunds', value: n('refunds', () => count(store, 'refunds')) },
      { label: 'Estimates', value: n('estimates', () => count(store, 'estimates')) },
    ] },
  ];

  const outstanding = counted.reduce((t, i) => t + Math.max(0, i.value - i.paid), 0);

  return {
    generatedAt: now.toISOString(),
    company: meta.company ?? { name: 'Practice' },
    stores: (meta.stores ?? []).map((s) => s.name ?? s.id),
    environment: meta.environment ?? 'migrations',
    pulledAt: meta.finishedAt ?? meta.startedAt ?? null,
    currency,
    moneyDivisor: scale.divisor,
    goLive: goLiveDate ? isoDay(goLiveDate) : null,
    migrated: migratedDate ? isoDay(migratedDate) : null,
    window: { end: isoDay(end), basis: asOf ? 'given' : (lastTrading ? 'last finalised invoice' : 'today') },
    clients, pets, products, appointments: { ...appointments, byStatus: [...appointments.byStatus.entries()].sort((a, b) => b[1] - a[1]) },
    records,
    period, monthly: months.map((k) => ({ month: k, ...monthly[k] })),
    averageInvoice: Object.fromEntries(PERIODS.map((m) => [m, period[m].invoices ? period[m].invoiced / period[m].invoices : 0])),
    medianInvoice: median,
    outstanding,
    paymentMethods: [...methods.entries()].map(([method, e]) => ({ method, ...e })).sort((a, b) => b.value - a.value),
    vets, attribution: basis,
    notes,
    unavailable,
  };
}

// ---- Rendering -------------------------------------------------------------------

// Format money the way the practice's own country writes it: $ in the US, not US$.
const LOCALE = { GBP: 'en-GB', USD: 'en-US', CAD: 'en-CA', AUD: 'en-AU', NZD: 'en-NZ', EUR: 'en-IE' };

function fmtMoney(summary, v, { compact = false } = {}) {
  const n = Number(v ?? 0) / summary.moneyDivisor;
  try {
    return new Intl.NumberFormat(LOCALE[summary.currency] ?? 'en-GB', {
      style: 'currency', currency: summary.currency,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 0 }),
    }).format(n);
  } catch {
    return n.toFixed(0);
  }
}
const fmtN = (v) => (v === null || v === undefined ? '<span class="na">unavailable</span>' : Number(v).toLocaleString('en-GB'));

// Rounded "nice" axis maximum and ticks.
function niceScale(max, ticks = 4) {
  if (max <= 0) return { max: 1, step: 1 / ticks };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { max: step * ticks, step };
}

// Vertical bars, one or two series, shared y-axis. Inline SVG so the report has no
// dependencies and prints exactly as it looks.
function barChart({ labels, series, format, height = 190, width = 680, every = 1 }) {
  const pad = { l: 66, r: 8, t: 10, b: 26 };
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const { max: top, step } = niceScale(max);
  const band = w / labels.length;
  const gap = 2;
  const barW = Math.min(26, (band * 0.72 - gap * (series.length - 1)) / series.length);
  const y = (v) => pad.t + h - (Math.max(0, v) / top) * h;
  let out = `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">`;
  for (let t = 0; t <= top + 1e-9; t += step) {
    out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    out += `<text x="${pad.l - 8}" y="${y(t) + 4}" class="tick" text-anchor="end">${esc(format(t))}</text>`;
  }
  labels.forEach((lab, i) => {
    const groupW = barW * series.length + gap * (series.length - 1);
    const x0 = pad.l + band * i + (band - groupW) / 2;
    series.forEach((s, j) => {
      const v = s.values[i];
      const x = x0 + j * (barW + gap);
      const yy = y(v), bh = pad.t + h - yy;
      if (bh > 0.5) {
        const r = Math.min(4, barW / 2, bh);
        out += `<path d="M${x},${pad.t + h} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${pad.t + h} Z" fill="${s.color}"><title>${esc(`${lab} · ${s.name}: ${format(v, true)}`)}</title></path>`;
      }
    });
    if (i % every === (labels.length - 1) % every) out += `<text x="${pad.l + band * i + band / 2}" y="${height - 8}" class="tick" text-anchor="middle">${esc(lab)}</text>`;
  });
  out += `<line x1="${pad.l}" x2="${width - pad.r}" y1="${pad.t + h}" y2="${pad.t + h}" class="axis"/>`;
  return out + '</svg>';
}

// Horizontal bars with the value written at the end of each — the right form for a
// ranked list of names, which would not fit under vertical bars.
function hBarChart({ items, format, width = 680, color }) {
  const row = 24, pad = { l: 150, r: 92, t: 4 };
  const height = pad.t + items.length * row + 4;
  const max = Math.max(1, ...items.map((i) => i.value));
  const w = width - pad.l - pad.r;
  let out = `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img">`;
  items.forEach((it, i) => {
    const y = pad.t + i * row;
    const bw = Math.max(0, (it.value / max) * w);
    out += `<text x="${pad.l - 10}" y="${y + 16}" class="lab" text-anchor="end">${esc(it.label.length > 22 ? `${it.label.slice(0, 21)}…` : it.label)}</text>`;
    if (bw > 0.5) {
      const r = Math.min(4, bw);
      out += `<path d="M${pad.l},${y + 4} H${pad.l + bw - r} Q${pad.l + bw},${y + 4} ${pad.l + bw},${y + 4 + r} V${y + 18 - r} Q${pad.l + bw},${y + 18} ${pad.l + bw - r},${y + 18} H${pad.l} Z" fill="${it.muted ? 'var(--muted-bar)' : color}"><title>${esc(`${it.label}: ${format(it.value)}`)}</title></path>`;
    }
    out += `<text x="${pad.l + bw + 8}" y="${y + 16}" class="val">${esc(format(it.value))}</text>`;
  });
  return out + '</svg>';
}

const CSS = `
:root {
  --ink: #16241f; --muted: #5b6b64; --line: #dfe5e2; --soft: #f4f7f5; --bg: #ffffff;
  --brand: #0f7a5a; --brand-2: #f47230; --muted-bar: #b9c4bf; --warn: #8a6100; --warn-bg: #fff7e0;
}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html { background: #e9edeb; }
body { margin: 0; color: var(--ink); background: #e9edeb;
  font: 10.5pt/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: 210mm; min-height: 297mm; margin: 10mm auto; background: var(--bg); padding: 16mm 16mm 20mm;
  position: relative; box-shadow: 0 2px 12px rgba(0,0,0,.08); page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
@media print { html, body { background: #fff; } .sheet { margin: 0; box-shadow: none; height: 297mm; overflow: hidden; } }
@media screen and (max-width: 220mm) { .sheet { width: auto; min-height: 0; margin: 0 0 12px; padding: 20px 16px; } }

.band { display: flex; align-items: baseline; gap: 12px; border-bottom: 2.5px solid var(--brand); padding-bottom: 8px; margin-bottom: 18px; }
.wordmark { font-weight: 750; font-size: 15pt; color: var(--brand); letter-spacing: -0.3px; }
.band .co { font-weight: 600; }
.band .pg { margin-left: auto; color: var(--muted); font-size: 9pt; }
.foot { position: absolute; left: 16mm; right: 16mm; bottom: 9mm; gap: 16px; white-space: nowrap; display: flex; justify-content: space-between;
  border-top: 1px solid var(--line); padding-top: 6px; color: var(--muted); font-size: 8pt; }
@media screen and (max-width: 220mm) { .foot { position: static; margin-top: 18px; } }

h1 { font-size: 25pt; line-height: 1.12; letter-spacing: -0.6px; margin: 0 0 8px; }
h2 { font-size: 15pt; letter-spacing: -0.3px; margin: 0 0 4px; }
h3 { font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 18px 0 8px; }
.kicker { display: inline-block; background: var(--brand); color: #fff; font-weight: 650; font-size: 9.5pt;
  padding: 4px 10px; border-radius: 999px; margin-bottom: 14px; letter-spacing: .02em; }
.lede { color: var(--muted); margin: 0 0 14px; max-width: 70ch; }
.cover-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 22px; }
.cover-meta div { border-left: 3px solid var(--brand); padding: 2px 0 2px 10px; }
.cover-meta dt { font-size: 8pt; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.cover-meta dd { margin: 0; font-weight: 600; }

.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 0 6px; }
.tiles.four { grid-template-columns: repeat(4, 1fr); }
.tile { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--soft); }
.tile .k { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.tile .v { font-size: 16pt; font-weight: 700; letter-spacing: -0.4px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.tile .s { font-size: 8.5pt; color: var(--muted); }

.contents { list-style: none; padding: 0; margin: 0; counter-reset: c; }
.contents li { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); counter-increment: c; }
.contents li::before { content: counter(c); font-weight: 700; color: var(--brand); width: 18px; }
.contents .t { font-weight: 600; } .contents .d { color: var(--muted); font-size: 9.5pt; }
.contents .p { margin-left: auto; color: var(--muted); font-size: 9pt; white-space: nowrap; }

.notes { background: var(--warn-bg); border: 1px solid #f0dfa8; border-radius: 8px; padding: 10px 14px; margin-top: 16px; font-size: 9pt; }
.notes b { color: var(--warn); }
.notes ul { margin: 4px 0 0; padding-left: 18px; } .notes li { margin: 3px 0; }

table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 3.5px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
td.num, th.num { text-align: right; }
tr.strong td { font-weight: 700; }
tr.sub td:first-child { padding-left: 18px; color: var(--muted); }
.na { color: var(--muted); font-style: italic; font-weight: 400; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media screen and (max-width: 220mm) { .grid2, .tiles, .tiles.four, .cover-meta { grid-template-columns: 1fr 1fr; } }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 2px 12px 6px; break-inside: avoid; font-size: 9.5pt; }
.card td, .card th { padding: 2.5px 4px; }
.stack > * + * { margin-top: 10px; }
.vets td { font-size: 9pt; } .vets td:first-child { white-space: nowrap; }
.card h3 { margin-top: 10px; }
.species td.num { width: 22%; }

.chart { width: 100%; height: auto; display: block; }
.chart .grid { stroke: var(--line); stroke-width: 1; }
.chart .axis { stroke: #9aa7a1; stroke-width: 1; }
.chart .tick { font-size: 10px; fill: var(--muted); }
.chart .lab { font-size: 11px; fill: var(--ink); }
.chart .val { font-size: 11px; fill: var(--ink); font-weight: 600; }
.legend { display: flex; gap: 16px; font-size: 9pt; color: var(--muted); margin: 2px 0 4px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.caption { font-size: 8.5pt; color: var(--muted); margin: 4px 0 0; }
`;

export function renderSummaryReport(s, { preparedBy } = {}) {
  const m = (v, o) => fmtMoney(s, v, o);
  const p12 = s.period[12];
  const datePrefix = s.goLive
    ? `Go-live ${longDate(new Date(`${s.goLive}T12:00:00Z`))}`
    : s.migrated ? `Migrated ${longDate(new Date(`${s.migrated}T12:00:00Z`))}` : 'Preliminary';
  const title = `${datePrefix} — ${s.company.name}`;
  const env = s.environment === 'production' ? 'Live site' : 'Migration site';
  const endDate = new Date(`${s.window.end}T12:00:00Z`);
  const totalPages = 4;

  const band = (n) => `<div class="band"><span class="wordmark">Lupa</span><span class="co">${esc(s.company.name)}</span><span class="pg">Preliminary data report · page ${n} of ${totalPages}</span></div>`;
  const foot = `<div class="foot"><span>${esc(datePrefix)} · ${esc(env)}</span><span>Prepared ${esc(longDate(new Date(s.generatedAt)))}${preparedBy ? ` by ${esc(preparedBy)}` : ''} · preliminary, subject to sign-off</span></div>`;

  const activePets = ['Dog', 'Cat', 'Other'].reduce((t, k) => t + s.pets.species[k].active, 0);

  // ---- Page 1 -----
  const page1 = `<section class="sheet">${band(1)}
<span class="kicker">${esc(datePrefix)}</span>
<h1>${esc(s.company.name)}<br>Preliminary data report</h1>
<p class="lede">A first look at the data now held in Lupa: how many of each record type came across from the previous system, and what the practice's trading looks like over the last year. Use it to check the conversion against the old system's own reports before go-live.</p>

<dl class="cover-meta">
  <div><dt>${s.goLive ? 'Go-live' : 'Data migrated'}</dt><dd>${esc(longDate(new Date(`${s.goLive ?? s.migrated ?? s.generatedAt.slice(0, 10)}T12:00:00Z`)))}</dd></div>
  <div><dt>Environment</dt><dd>${esc(env)}</dd></div>
  <div><dt>Trading figures up to</dt><dd>${esc(longDate(endDate))}</dd></div>
</dl>

<h3>At a glance</h3>
<div class="tiles">
  <div class="tile"><div class="k">Active clients</div><div class="v">${fmtN(s.clients.active)}</div><div class="s">of ${fmtN(s.clients.total)} converted</div></div>
  <div class="tile"><div class="k">Active patients</div><div class="v">${fmtN(activePets)}</div><div class="s">of ${fmtN(s.pets.total)} converted</div></div>
  <div class="tile"><div class="k">Invoiced, last 12 months</div><div class="v">${m(p12.invoiced)}</div><div class="s">${fmtN(p12.invoices)} finalised invoices</div></div>
  <div class="tile"><div class="k">Average invoice</div><div class="v">${m(s.averageInvoice[12])}</div><div class="s">median ${m(s.medianInvoice)}</div></div>
  <div class="tile"><div class="k">Appointments, last 12 months</div><div class="v">${fmtN(p12.appointments)}</div><div class="s">${fmtN(s.appointments.future)} booked ahead</div></div>
  <div class="tile"><div class="k">Outstanding on invoices</div><div class="v">${m(s.outstanding)}</div><div class="s">${fmtN(s.clients.inDebt)} clients owe money</div></div>
</div>

<h3>Contents</h3>
<ol class="contents">
  <li><div><div class="t">Summary</div><div class="d">Key dates and headline figures</div></div><span class="p">page 1</span></li>
  <li><div><div class="t">Records converted</div><div class="d">Clients, patients by species, catalogue, clinical history, diary and financial records</div></div><span class="p">page 2</span></li>
  <li><div><div class="t">Financial overview</div><div class="d">Invoices, credit notes, payments and refunds over 1, 3, 6 and 12 months, and month by month</div></div><span class="p">page 3</span></li>
  <li><div><div class="t">Revenue by vet and activity</div><div class="d">Revenue per clinician, average invoice value and appointment volumes</div></div><span class="p">page 4</span></li>
</ol>

${s.notes.length ? `<div class="notes"><b>Read with these in mind</b><ul>${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
${foot}</section>`;

  // ---- Page 2 -----
  const sp = s.pets.species;
  const speciesRows = ['Dog', 'Cat', 'Other'].map((k) => `<tr><td>${k}</td><td class="num">${fmtN(sp[k].active)}</td><td class="num">${fmtN(sp[k].inactive)}</td><td class="num"><b>${fmtN(sp[k].active + sp[k].inactive)}</b></td></tr>`).join('');
  const spTotal = ['Dog', 'Cat', 'Other'].reduce((t, k) => ({ a: t.a + sp[k].active, i: t.i + sp[k].inactive }), { a: 0, i: 0 });
  const group = (g) => `<div class="card"><h3>${esc(g.group)}</h3><table><tbody>${g.items.map((it) => `<tr class="${it.strong ? 'strong' : ''}${it.label.startsWith('…') ? ' sub' : ''}"><td>${esc(it.label.replace(/^… /, ''))}</td><td class="num">${fmtN(it.value)}</td></tr>`).join('')}</tbody></table></div>`;
  const byGroup = Object.fromEntries(s.records.map((g) => [g.group, g]));

  const page2 = `<section class="sheet">${band(2)}
<h2>Records converted</h2>
<p class="lede">What Lupa holds now, read back through the API rather than taken from the export file. Compare each line with the equivalent report from the previous system.</p>

<div class="tiles four">
  <div class="tile"><div class="k">Clients</div><div class="v">${fmtN(s.clients.total)}</div><div class="s">${fmtN(s.clients.active)} active · ${fmtN(s.clients.archived)} inactive</div></div>
  <div class="tile"><div class="k">Patients</div><div class="v">${fmtN(s.pets.total)}</div><div class="s">${fmtN(spTotal.a)} active · ${fmtN(spTotal.i)} inactive</div></div>
  <div class="tile"><div class="k">Products</div><div class="v">${fmtN(s.products.total)}</div><div class="s">${fmtN(s.products.active)} active</div></div>
  <div class="tile"><div class="k">Invoices</div><div class="v">${fmtN(byGroup.Financial.items[0].value)}</div><div class="s">${fmtN(byGroup.Financial.items[1].value)} finalised</div></div>
</div>

<div class="grid2" style="margin-top:12px">
  <div class="stack">
    <div class="card"><h3>Patients by species</h3>
    <table class="species"><thead><tr><th>Species</th><th class="num">Active</th><th class="num">Inactive</th><th class="num">Total</th></tr></thead>
    <tbody>${speciesRows}<tr class="strong"><td>All</td><td class="num">${fmtN(spTotal.a)}</td><td class="num">${fmtN(spTotal.i)}</td><td class="num">${fmtN(spTotal.a + spTotal.i)}</td></tr></tbody></table>
    <p class="caption">Inactive means deceased (${fmtN(s.pets.deceased)}) or no longer linked to an active owner.${s.pets.otherSpecies.length ? ` "Other" is mostly ${esc(s.pets.otherSpecies.slice(0, 4).map(([k, v]) => `${k} (${v.toLocaleString('en-GB')})`).join(', '))}.` : ''}</p>
    </div>
    ${group(byGroup['Clients and patients'])}
    ${group(byGroup.Diary)}
  </div>
  <div class="stack">
    ${group(byGroup.Catalogue)}
    ${group(byGroup['Clinical history'])}
    ${group(byGroup.Financial)}
  </div>
</div>
<p class="caption" style="margin-top:10px">Client communications (sent emails and SMS) are not available through the Lupa API, so they are not counted here. Check them in the practice's communications log.</p>
${foot}</section>`;

  // ---- Page 3 -----
  const P = [1, 3, 6, 12];
  const prow = (label, fn, { strong, sub } = {}) => `<tr class="${strong ? 'strong' : ''}${sub ? ' sub' : ''}"><td>${label}</td>${P.map((k) => `<td class="num">${fn(s.period[k], k)}</td>`).join('')}</tr>`;
  const monthsLab = s.monthly.map((r) => monthLabel(r.month));
  const compact = (v, full) => (full ? m(v) : m(v, { compact: true }));
  const page3 = `<section class="sheet">${band(3)}
<h2>Financial overview</h2>
<p class="lede">Rolling periods ending ${esc(longDate(endDate))}${s.window.basis === 'given' ? '' : ', the date of the last finalised invoice'}. Invoices are dated by invoice date, credit notes by issue date, and payments and refunds by the date they were recorded.</p>

<table>
  <thead><tr><th></th>${P.map((k) => `<th class="num">Last ${k} month${k > 1 ? 's' : ''}</th>`).join('')}</tr></thead>
  <tbody>
    ${prow('Finalised invoices', (p) => fmtN(p.invoices))}
    ${prow('Invoiced', (p) => m(p.invoiced), { strong: true })}
    ${prow('Credit notes issued', (p) => m(p.credits))}
    ${prow('Net invoiced', (p) => m(p.invoiced - p.credits), { strong: true })}
    ${prow('Payments received', (p) => m(p.payments))}
    ${prow('Refunds paid', (p) => m(p.refunds))}
    ${prow('Net cash received', (p) => m(p.payments - p.refunds), { strong: true })}
    ${prow('Average invoice value', (p) => m(p.invoices ? p.invoiced / p.invoices : 0))}
  </tbody>
</table>

<h3>Invoiced and received, month by month</h3>
<div class="legend"><span><i style="background:var(--brand)"></i>Invoiced</span><span><i style="background:var(--brand-2)"></i>Payments received</span></div>
${barChart({
    labels: monthsLab,
    series: [
      { name: 'Invoiced', color: 'var(--brand)', values: s.monthly.map((r) => r.invoiced) },
      { name: 'Payments received', color: 'var(--brand-2)', values: s.monthly.map((r) => r.payments) },
    ],
    format: compact,
  })}
<p class="caption">${esc(monthLabel(s.monthly[s.monthly.length - 1].month))} runs to ${esc(longDate(endDate))} only.</p>

<div class="grid2" style="margin-top:10px">
  <div class="card"><h3>Credit notes and refunds by month</h3>
  <table><thead><tr><th>Month</th><th class="num">Credit notes</th><th class="num">Refunds</th></tr></thead><tbody>
  ${s.monthly.slice(-5).map((r) => `<tr><td>${monthLabel(r.month)}</td><td class="num">${m(r.credits)}</td><td class="num">${m(r.refunds)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="card"><h3>Payments by method, last 12 months</h3>
  <table><thead><tr><th>Method</th><th class="num">Count</th><th class="num">Value</th></tr></thead><tbody>
  ${s.paymentMethods.length ? s.paymentMethods.slice(0, 5).map((r) => `<tr><td>${esc(r.method.replace(/_/g, ' '))}</td><td class="num">${fmtN(r.count)}</td><td class="num">${m(r.value)}</td></tr>`).join('') : '<tr><td colspan="3" class="na">No payments in the period</td></tr>'}
  </tbody></table></div>
</div>
${foot}</section>`;

  // ---- Page 4 -----
  const top = s.vets.slice(0, 12);
  const page4 = `<section class="sheet">${band(4)}
<h2>Revenue by vet and activity</h2>
<p class="lede">Finalised invoice value over the last 12 months, attributed to the clinician on the appointment the invoice belongs to where there is one, otherwise to the clinician carried on the invoice, otherwise to whoever raised it.</p>

${top.length ? hBarChart({
    items: top.map((v) => ({ label: v.name, value: v.value, muted: v.id === '__none__' })),
    format: (v) => m(v),
    color: 'var(--brand)',
  }) : '<p class="na">No finalised invoices in the last 12 months.</p>'}

<table class="vets" style="margin-top:10px">
  <thead><tr><th>Clinician</th><th>Role</th><th class="num">Invoices (12m)</th><th class="num">Avg invoice</th>${P.map((k) => `<th class="num">${k}m</th>`).join('')}<th class="num">Share</th></tr></thead>
  <tbody>
  ${top.map((v) => `<tr><td>${esc(v.name)}</td><td>${esc(v.role)}</td><td class="num">${fmtN(v.invoices)}</td><td class="num">${m(v.invoices ? v.value / v.invoices : 0)}</td>${P.map((k) => `<td class="num">${m(v.byPeriod[k], { compact: true })}</td>`).join('')}<td class="num">${p12.invoiced ? Math.round((v.value / p12.invoiced) * 100) : 0}%</td></tr>`).join('')}
  ${s.vets.length > top.length ? `<tr><td colspan="${8 + 1}" class="caption">${s.vets.length - top.length} further staff with smaller totals not shown.</td></tr>` : ''}
  </tbody>
</table>

<div class="grid2" style="margin-top:14px">
  <div>
    <h3 style="margin-top:0">Appointments per month</h3>
    ${barChart({
      labels: monthsLab,
      series: [{ name: 'Appointments', color: 'var(--brand)', values: s.monthly.map((r) => r.appointments) }],
      format: (v) => Math.round(v).toLocaleString('en-GB'),
      height: 200, width: 360, every: 3,
    })}
  </div>
  <div>
    <h3 style="margin-top:0">Activity by period</h3>
    <table><thead><tr><th></th>${P.map((k) => `<th class="num">${k}m</th>`).join('')}</tr></thead><tbody>
      <tr><td>Appointments</td>${P.map((k) => `<td class="num">${fmtN(s.period[k].appointments)}</td>`).join('')}</tr>
      <tr><td>Invoices</td>${P.map((k) => `<td class="num">${fmtN(s.period[k].invoices)}</td>`).join('')}</tr>
      <tr class="strong"><td>Avg invoice</td>${P.map((k) => `<td class="num">${m(s.averageInvoice[k])}</td>`).join('')}</tr>
    </tbody></table>
    ${s.appointments.byStatus.length ? `<h3>Appointment status, last 12 months</h3><table><tbody>${s.appointments.byStatus.slice(0, 6).map(([k, v]) => `<tr><td>${esc(String(k).replace(/_/g, ' '))}</td><td class="num">${fmtN(v)}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>
</div>
${foot}</section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Preliminary data report</title>
<style>${CSS}</style></head>
<body>${page1}${page2}${page3}${page4}</body></html>`;
}

export function writeSummaryReport(dir, opts = {}) {
  const summary = buildSummary(dir, opts);
  const html = renderSummaryReport(summary, opts);
  const htmlPath = join(dir, 'summary-report.html');
  const jsonPath = join(dir, 'summary.json');
  writeFileSync(htmlPath, html);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  return { html: htmlPath, json: jsonPath, summary };
}
