// Section 7 and 6.11.6 — checks that need more than one collection.
//
// This module owns no collection of its own. It streams what it needs from disk and
// leans on the identity indexes built in src/indexes.js, so nothing here is a
// per-record API call.
//
// The two reconciliation rules are the ones the practice cares most about and the ones
// most likely to need adjusting per practice. Both are documented as needing validation
// against known-good records before their output is trusted — see
// references/ruleset-v1.md, Open questions.
import { isBlank, lower, money, parseMoneyString, parseDate } from '../util.js';

// expected = completed invoices − completed payments − issued non-refundable credit
function reconcileClients(ctx) {
  const tolerance = ctx.moneyTolerance ?? 1;
  const invoiced = new Map(), paid = new Map(), credited = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

  for (const i of ctx.store.read('invoices')) {
    if (lower(i.status) === 'completed' && i.clientId) add(invoiced, i.clientId, Number(i.amountDue ?? 0));
  }
  for (const p of ctx.store.read('payments')) {
    if (lower(p.status) === 'completed' && p.clientId) add(paid, p.clientId, Number(p.amount ?? 0));
  }
  for (const c of ctx.store.read('creditNotes')) {
    if (lower(c.status) === 'issued' && c.isRefundable !== true && c.clientId) add(credited, c.clientId, parseMoneyString(c.amount) ?? 0);
  }

  const out = [];
  let totals = { invoiced: 0, paid: 0, credited: 0, balance: 0 };
  for (const [clientId, balance] of ctx.ix.clientBalance) {
    const expected = (invoiced.get(clientId) ?? 0) - (paid.get(clientId) ?? 0) - (credited.get(clientId) ?? 0);
    totals.invoiced += invoiced.get(clientId) ?? 0;
    totals.paid += paid.get(clientId) ?? 0;
    totals.credited += credited.get(clientId) ?? 0;
    totals.balance += balance;
    if (Math.abs(expected - balance) > tolerance) out.push({ clientId, expected, balance, delta: balance - expected });
  }
  return { mismatches: out, totals };
}

export default {
  key: 'crossRecord',
  label: 'Cross-record checks',
  linkType: 'client',
  collection: null,
  scannedFrom: 'clients',

  tally(ctx) {
    const { totals } = reconcileClients(ctx);
    const topDebtors = [...ctx.ix.clientBalance.entries()]
      .filter(([, b]) => b > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id, b]) => ({
        key: id,
        label: `${ctx.ix.clientName.get(id)?.name ?? id} (#${ctx.ix.clientName.get(id)?.numericId ?? '?'})`,
        count: '',
        extra: money(b, ctx.currency),
      }));

    const petsWithoutAppointments = [...ctx.ix.petIds].filter((p) => !ctx.ix.appointmentsByPet.has(p)).length;
    const petsWithoutInvoices = [...ctx.ix.petIds].filter((p) => !ctx.ix.invoicedPets.has(p)).length;

    return [
      { label: 'Total invoiced (completed)', value: money(totals.invoiced, ctx.currency) },
      { label: 'Total collected (completed)', value: money(totals.paid, ctx.currency) },
      { label: 'Total credited (issued, non-refundable)', value: money(totals.credited, ctx.currency) },
      { label: 'Expected total balance', value: money(totals.invoiced - totals.paid - totals.credited, ctx.currency) },
      { label: 'Actual total of client balances', value: money(totals.balance, ctx.currency) },
      { label: 'Difference', value: money(totals.balance - (totals.invoiced - totals.paid - totals.credited), ctx.currency) },
      { label: 'Pets with no appointment ever', value: petsWithoutAppointments },
      { label: 'Pets never on an invoice', value: petsWithoutInvoices },
      { label: 'Top 20 clients by outstanding balance', breakdown: topDebtors },
    ];
  },

  rules: [
    {
      id: 'cross.balance.topLevelMismatch', severity: 'critical',
      title: 'Practice-wide balance does not reconcile',
      clientFacing: 'The overall account balance does not match the invoices, payments and credits behind it.',
      why: 'One row. If this reconciles, the per-client mismatches below are allocation problems rather than missing records.',
      run: (ctx) => {
        const { totals } = reconcileClients(ctx);
        const expected = totals.invoiced - totals.paid - totals.credited;
        const delta = totals.balance - expected;
        // A hundred tolerance-units: real rounding drift, not a broken ledger.
        if (Math.abs(delta) <= (ctx.moneyTolerance ?? 1) * 100) return [];
        return [{
          id: 'top-level',
          display: 'Whole practice',
          fields: {
            invoiced: money(totals.invoiced, ctx.currency),
            paid: money(totals.paid, ctx.currency),
            credited: money(totals.credited, ctx.currency),
            expectedBalance: money(expected, ctx.currency),
            actualBalance: money(totals.balance, ctx.currency),
            delta: money(delta, ctx.currency),
          },
        }];
      },
    },
    {
      id: 'cross.balance.clientMismatch', severity: 'critical',
      scanOf: 'clients',
      title: 'Client balance does not match their invoices, payments and credits',
      clientFacing: 'Account balance does not match the transactions behind it.',
      why: 'Validate the formula against a few known-clean clients before acting on a large count. Practices vary in whether refundable credit reduces the balance.',
      truncate: 25,
      run: (ctx) => reconcileClients(ctx).mismatches
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .map((m) => ({
          id: m.clientId,
          display: ctx.ix.clientName.get(m.clientId)?.name ?? m.clientId,
          fields: {
            numericId: ctx.ix.clientName.get(m.clientId)?.numericId,
            expected: money(m.expected, ctx.currency),
            actual: money(m.balance, ctx.currency),
            delta: money(m.delta, ctx.currency),
          },
        })),
    },
    {
      id: 'cross.pets.noHistory', severity: 'info',
      scanOf: 'pets',
      title: 'Active pet with no appointment and no invoice ever',
      why: 'Either a record that never transacted, or history that did not come across.',
      linkType: 'pet',
      truncate: 25,
      run: (ctx) => {
        const out = [];
        for (const p of ctx.store.read('pets')) {
          if (p.deceased === true || ctx.ix.petIsArchived.has(p.id)) continue;
          if (ctx.ix.appointmentsByPet.has(p.id) || ctx.ix.invoicedPets.has(p.id)) continue;
          out.push({ record: p, display: p.name ?? '(unnamed)', fields: { species: p.species, owner: (p.clientsPets ?? [])[0]?.clientId } });
        }
        return out;
      },
    },
    {
      id: 'cross.appointments.noCharge', severity: 'review',
      scanOf: 'appointments',
      title: 'Completed appointment with no charge against it',
      clientFacing: 'Completed appointment with nothing billed.',
      why: 'Legitimate for free re-checks and plan-covered visits. Worth a look at the volume rather than the individual rows.',
      linkType: 'appointment',
      truncate: 25,
      run: (ctx) => {
        const chargedInvoices = new Set();
        for (const i of ctx.store.read('invoices')) {
          if (Number(i.amountDue ?? 0) > 0) chargedInvoices.add(i.id);
        }
        const out = [];
        for (const a of ctx.store.read('appointments')) {
          if (lower(a.status) !== 'completed') continue;
          const invoiceId = a.storeInvoiceId;
          if (invoiceId && chargedInvoices.has(invoiceId)) continue;
          out.push({
            record: a, display: a.title ?? a.visitTypeName ?? '(untitled)',
            fields: { start: a.start, pet: ctx.ix.petName.get(a.petId) ?? a.petId, invoiced: invoiceId ? 'zero-value invoice' : 'no invoice' },
          });
        }
        return out;
      },
    },
    {
      id: 'cross.bundles.priceVsComponents', severity: 'review',
      scanOf: 'bundles',
      title: 'Bundle price does not match the sum of what is inside it',
      clientFacing: 'Bundle price does not match the items it contains.',
      why: 'Derived from invoice instances, since the bundle endpoint does not list members. Only reported where it holds consistently across instances.',
      linkType: 'bundle',
      run: (ctx) => {
        // For each bundle seen on an invoice, collect the component sum of each instance.
        const sums = new Map(); // storeBundleId -> number[]
        for (const i of ctx.store.read('invoices')) {
          const instances = i.billingBundles ?? [];
          if (!instances.length) continue;
          const byInstance = new Map();
          for (const l of [...(i.billingProducts ?? []), ...(i.billingServices ?? [])]) {
            if (isBlank(l.billingBundleId)) continue;
            byInstance.set(l.billingBundleId, (byInstance.get(l.billingBundleId) ?? 0) + Number(l.price ?? 0));
          }
          for (const inst of instances) {
            const componentSum = byInstance.get(inst.id);
            if (componentSum === undefined) continue;
            const key = inst.storeBundleId ?? inst.bundleId;
            if (isBlank(key)) continue;
            if (!sums.has(key)) sums.set(key, []);
            sums.get(key).push(componentSum);
          }
        }
        const out = [];
        for (const [bundleId, observed] of sums) {
          const price = ctx.ix.bundlePrice.get(bundleId);
          if (price === undefined || !observed.length) continue;
          // Only flag when every observed instance disagrees — one odd invoice is noise.
          if (!observed.every((s) => Math.abs(s - price) > 1)) continue;
          const typical = Math.round(observed.reduce((a, b) => a + b, 0) / observed.length);
          out.push({
            id: bundleId,
            display: bundleId,
            fields: {
              bundlePrice: money(price, ctx.currency),
              typicalComponents: money(typical, ctx.currency),
              delta: money(typical - price, ctx.currency),
              instances: observed.length,
            },
          });
        }
        return out;
      },
    },
    {
      id: 'cross.prescriptions.neverCharged', severity: 'info',
      scanOf: 'prescriptions',
      title: 'Prescription written but never charged for',
      why: 'May be goodwill, may be a missed charge. Volume matters more than the individual rows.',
      linkType: 'prescription',
      truncate: 25,
      run: (ctx) => {
        // pet|product -> [invoice dates]
        const charged = new Map();
        for (const i of ctx.store.read('invoices')) {
          const when = parseDate(i.activeFrom);
          if (!when || isBlank(i.petId)) continue;
          for (const l of i.billingProducts ?? []) {
            if (isBlank(l.productId)) continue;
            const key = `${i.petId}|${l.productId}`;
            if (!charged.has(key)) charged.set(key, []);
            charged.get(key).push(when.getTime());
          }
        }
        const out = [];
        for (const p of ctx.store.read('prescriptions')) {
          if (p.isPrescribedOnly !== true || lower(p.dispenseTrackingMode) !== 'written_prescription_only') continue;
          if (isBlank(p.petId) || isBlank(p.sourceProductId)) continue;
          const start = parseDate(p.startDate)?.getTime();
          const end = parseDate(p.endDate)?.getTime() ?? start;
          if (start === undefined) continue;
          const hits = charged.get(`${p.petId}|${p.sourceProductId}`) ?? [];
          if (hits.some((t) => t >= start && t <= end)) continue;
          out.push({
            record: p, display: p.productName ?? '(no product)',
            fields: { pet: ctx.ix.petName.get(p.petId) ?? p.petId, startDate: p.startDate, endDate: p.endDate },
          });
        }
        return out;
      },
    },
  ],
};
