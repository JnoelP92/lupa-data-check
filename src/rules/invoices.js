// Section 6.11.1 — Invoices.
//
// Money is integer minor units. Every comparison below stays in integers; formatting to
// pounds happens only when a row is rendered.
//
// The reconciliation formula is the single most load-bearing thing in this file and the
// most likely to be wrong for a given practice. `price` on a line is already
// VAT-inclusive and post-line-discount per the field description, so the expected total
// is the line sum with the invoice-level discount applied. VALIDATE THIS against five
// known-good invoices at a practice that uses bundles before trusting the output: if
// bundle pricing is carried on the wrapper rather than the components, this
// double-counts and the report fills with false criticals.
import { isBlank, lower, breakdown, collisions, money, parseDate } from '../util.js';

const lines = (i) => [...(i.billingProducts ?? []), ...(i.billingServices ?? [])];
const lineSum = (i) => lines(i).reduce((t, l) => t + Number(l.price ?? 0), 0);

export function expectedTotal(invoice) {
  const sum = lineSum(invoice);
  const discount = Number(invoice.discountAmount ?? 0);
  if (!discount) return sum;
  if (invoice.discountType === '%') return Math.round((sum * (100 - discount)) / 100);
  if (invoice.discountType === '£') return sum - discount;
  return sum;
}

const label = (i) => i.invoiceNumber ?? i.id;
const completed = (i) => lower(i.status) === 'completed';

export default {
  key: 'invoices',
  label: 'Invoices',
  linkType: 'invoice',

  tally(ctx, rows) {
    const due = rows.reduce((t, i) => t + Number(i.amountDue ?? 0), 0);
    const paid = rows.reduce((t, i) => t + Number(i.amountPaid ?? 0), 0);

    // Aged receivables, per section 6.11.6. This is the number Dock compares against
    // the legacy PMS, so it is a tally rather than a finding.
    const buckets = { '0-30': [0, 0], '31-60': [0, 0], '61-90': [0, 0], '91+': [0, 0] };
    for (const i of rows) {
      const outstanding = Number(i.amountDue ?? 0) - Number(i.amountPaid ?? 0);
      if (outstanding <= 0) continue;
      const from = parseDate(i.activeFrom);
      if (!from) continue;
      const age = (ctx.now - from) / 86_400_000;
      const key = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '91+';
      buckets[key][0]++;
      buckets[key][1] += outstanding;
    }

    return [
      { label: 'Total invoices', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (i) => i.status) },
      { label: 'By payment status', breakdown: breakdown(rows, (i) => i.paymentStatus) },
      { label: 'By store', breakdown: breakdown(rows, (i) => i.storeId, { labels: ctx.storeNames }) },
      { label: 'Total invoiced', value: money(due, ctx.currency) },
      { label: 'Total collected', value: money(paid, ctx.currency) },
      { label: 'Total outstanding', value: money(due - paid, ctx.currency) },
      { label: 'With a negative line', value: rows.filter((i) => lines(i).some((l) => Number(l.price ?? 0) < 0)).length },
      { label: 'With a bundle', value: rows.filter((i) => (i.billingBundles ?? []).length).length },
      { label: 'With no lines at all', value: rows.filter((i) => !lines(i).length && !(i.billingBundles ?? []).length).length },
      { label: 'With an invoice-level discount', value: rows.filter((i) => Number(i.discountAmount ?? 0) > 0).length },
      {
        label: 'Aged receivables',
        breakdown: Object.entries(buckets).map(([key, [count, sum]]) => ({
          key, label: `${key} days`, count, extra: money(sum, ctx.currency),
        })),
      },
    ];
  },

  rules: [
    {
      id: 'invoices.total.mismatch', severity: 'critical',
      title: 'Invoice total does not match the sum of its lines',
      clientFacing: 'Invoice total does not match what is on it.',
      why: 'Tolerance is one minor unit for rounding. Validate the formula against known-good invoices before acting on a large count here.',
      truncate: 50,
      run: (ctx, rows) => rows.filter((i) => Math.abs(expectedTotal(i) - Number(i.amountDue ?? 0)) > ctx.moneyTolerance).map((i) => ({
        record: i, display: label(i),
        fields: {
          client: ctx.ix.clientName.get(i.clientId)?.numericId ?? i.clientId,
          date: i.activeFrom,
          amountDue: money(i.amountDue, ctx.currency),
          expected: money(expectedTotal(i), ctx.currency),
          delta: money(Number(i.amountDue ?? 0) - expectedTotal(i), ctx.currency),
        },
      })),
    },
    {
      id: 'invoices.payment.overAllocated', severity: 'critical',
      title: 'More paid than the invoice is for',
      // Guarded on a positive total: a credit-style invoice with a negative amountDue
      // and nothing paid is not over-allocated, it is just negative.
      run: (ctx, rows) => rows.filter((i) => Number(i.amountDue ?? 0) > 0 && Number(i.amountPaid ?? 0) > Number(i.amountDue ?? 0)).map((i) => ({
        record: i, display: label(i),
        fields: { amountDue: money(i.amountDue, ctx.currency), amountPaid: money(i.amountPaid, ctx.currency) },
      })),
    },
    {
      id: 'invoices.payment.paidButUnderpaid', severity: 'critical',
      title: 'Marked paid but not fully paid',
      run: (ctx, rows) => rows.filter((i) => lower(i.paymentStatus) === 'paid' && Number(i.amountPaid ?? 0) < Number(i.amountDue ?? 0)).map((i) => ({
        record: i, display: label(i),
        fields: { amountDue: money(i.amountDue, ctx.currency), amountPaid: money(i.amountPaid, ctx.currency) },
      })),
    },
    {
      id: 'invoices.payment.paidButNothingPaid', severity: 'critical',
      title: 'Marked paid with nothing paid at all',
      run: (ctx, rows) => rows.filter((i) => lower(i.paymentStatus) === 'paid' && Number(i.amountPaid ?? 0) === 0 && Number(i.amountDue ?? 0) > 0).map((i) => ({
        record: i, display: label(i), fields: { amountDue: money(i.amountDue, ctx.currency) },
      })),
    },
    {
      id: 'invoices.payment.unpaidButPaid', severity: 'critical',
      title: 'Marked unpaid but money has been taken',
      why: 'The client has paid and will be chased anyway.',
      // Drafts are covered by invoices.status.draftWithPayment.
      run: (ctx, rows) => rows.filter((i) => lower(i.status) !== 'draft' && lower(i.paymentStatus) === 'unpaid' && Number(i.amountPaid ?? 0) > 0).map((i) => ({
        record: i, display: label(i),
        fields: { amountDue: money(i.amountDue, ctx.currency), amountPaid: money(i.amountPaid, ctx.currency) },
      })),
    },
    {
      id: 'invoices.payment.partialButFull', severity: 'critical',
      title: 'Marked partially paid but fully paid',
      run: (ctx, rows) => rows.filter((i) => lower(i.paymentStatus) === 'partially_paid' && Number(i.amountPaid ?? 0) >= Number(i.amountDue ?? 0)).map((i) => ({
        record: i, display: label(i),
        fields: { amountDue: money(i.amountDue, ctx.currency), amountPaid: money(i.amountPaid, ctx.currency) },
      })),
    },
    {
      id: 'invoices.status.emptyCompleted', severity: 'review',
      title: 'Completed invoice with no lines and nothing to pay',
      run: (ctx, rows) => rows.filter((i) => completed(i) && Number(i.amountDue ?? 0) === 0 && !lines(i).length).map((i) => ({
        record: i, display: label(i), fields: { client: i.clientId, date: i.activeFrom },
      })),
    },
    {
      id: 'invoices.status.chargeWithoutLines', severity: 'critical',
      title: 'Completed invoice with a value but nothing on it',
      clientFacing: 'Invoice has a total but no items listed.',
      run: (ctx, rows) => rows.filter((i) => completed(i) && !lines(i).length && !(i.billingBundles ?? []).length && Number(i.amountDue ?? 0) > 0).map((i) => ({
        record: i, display: label(i), fields: { amountDue: money(i.amountDue, ctx.currency), date: i.activeFrom },
      })),
    },
    {
      id: 'invoices.status.staleDraft', severity: 'review',
      title: 'Draft invoice older than 30 days',
      truncate: 25,
      run: (ctx, rows) => rows.filter((i) => {
        const d = parseDate(i.activeFrom);
        return lower(i.status) === 'draft' && d && (ctx.now - d) / 86_400_000 > 30;
      }).map((i) => ({ record: i, display: label(i), fields: { date: i.activeFrom, amountDue: money(i.amountDue, ctx.currency) } })),
    },
    {
      id: 'invoices.status.draftWithPayment', severity: 'review',
      title: 'Draft invoice with money already taken against it',
      run: (ctx, rows) => rows.filter((i) => lower(i.status) === 'draft' && Number(i.amountPaid ?? 0) > 0).map((i) => ({
        record: i, display: label(i), fields: { amountPaid: money(i.amountPaid, ctx.currency) },
      })),
    },
    {
      id: 'invoices.line.negative', severity: 'review',
      title: 'Invoice line with a negative price',
      why: 'Corrections and refunds legitimately land as negative lines, but they need eyeballing.',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => lines(i).filter((l) => Number(l.price ?? 0) < 0).map((l) => ({
        record: i, display: label(i),
        fields: { line: l.name, price: money(l.price, ctx.currency), quantity: l.quantity },
      }))),
    },
    {
      id: 'invoices.line.zeroQuantity', severity: 'review',
      title: 'Invoice line with zero quantity',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => lines(i).filter((l) => Number(l.quantity ?? 0) === 0).map((l) => ({
        record: i, display: label(i), fields: { line: l.name, price: money(l.price, ctx.currency) },
      }))),
    },
    {
      id: 'invoices.line.freeButCatalogued', severity: 'review',
      title: 'Line charged at zero where the catalogue price is not zero',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => [
        ...(i.billingProducts ?? []).filter((l) => Number(l.unitPrice ?? 0) === 0 && (ctx.ix.productPrice.get(l.productId) ?? 0) > 0)
          .map((l) => ({ record: i, display: label(i), fields: { line: l.name, catalogue: money(ctx.ix.productPrice.get(l.productId), ctx.currency) } })),
        ...(i.billingServices ?? []).filter((l) => Number(l.unitPrice ?? 0) === 0 && (ctx.ix.servicePrice.get(l.serviceId) ?? 0) > 0)
          .map((l) => ({ record: i, display: label(i), fields: { line: l.name, catalogue: money(ctx.ix.servicePrice.get(l.serviceId), ctx.currency) } })),
      ]),
    },
    {
      id: 'invoices.line.discountExceedsLine', severity: 'critical',
      title: 'Line discount is larger than the line itself',
      run: (ctx, rows) => rows.flatMap((i) => lines(i)
        .filter((l) => l.discountType !== '%' && Number(l.discount ?? 0) > Number(l.unitPrice ?? 0) * Number(l.quantity ?? 0))
        .map((l) => ({
          record: i, display: label(i),
          fields: { line: l.name, discount: money(l.discount, ctx.currency), lineTotal: money(Number(l.unitPrice ?? 0) * Number(l.quantity ?? 0), ctx.currency) },
        }))),
    },
    {
      id: 'invoices.line.discountOver100', severity: 'critical',
      title: 'Percentage discount over 100%',
      run: (ctx, rows) => rows.flatMap((i) => lines(i)
        .filter((l) => l.discountType === '%' && Number(l.discount ?? 0) > 100)
        .map((l) => ({ record: i, display: label(i), fields: { line: l.name, discount: `${l.discount}%` } }))),
    },
    {
      id: 'invoices.line.vatUnexpected', severity: 'review',
      title: 'Invoice line on an unexpected VAT rate',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => lines(i)
        .filter((l) => !isBlank(l.vatPercentage) && !ctx.vatRates.includes(Number(l.vatPercentage)))
        .map((l) => ({ record: i, display: label(i), fields: { line: l.name, vatPercentage: l.vatPercentage } }))),
    },
    {
      id: 'invoices.line.danglingProduct', severity: 'info',
      title: 'Invoice line for a product that no longer exists',
      why: 'Usually the product was archived after the sale, which is fine. Listed for completeness.',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => (i.billingProducts ?? [])
        .filter((l) => !isBlank(l.productId) && !ctx.ix.productIds.has(l.productId))
        .map((l) => ({ record: i, display: label(i), fields: { line: l.name, danglingProductId: l.productId } }))),
    },
    {
      id: 'invoices.line.danglingService', severity: 'info',
      title: 'Invoice line for a service that no longer exists',
      truncate: 25,
      run: (ctx, rows) => rows.flatMap((i) => (i.billingServices ?? [])
        .filter((l) => !isBlank(l.serviceId) && !ctx.ix.serviceIds.has(l.serviceId))
        .map((l) => ({ record: i, display: label(i), fields: { line: l.name, danglingServiceId: l.serviceId } }))),
    },
    {
      id: 'invoices.duplicate.number', severity: 'critical',
      title: 'Two invoices share an invoice number at the same store',
      group: true,
      run: (ctx, rows) => collisions(rows, (i) => (isBlank(i.invoiceNumber) ? null : `${i.storeId ?? ''}|${i.invoiceNumber}`))
        .flatMap(([key, group]) => group.map((i) => ({
          record: i, display: label(i), groupKey: key,
          fields: { client: i.clientId, date: i.activeFrom, amountDue: money(i.amountDue, ctx.currency) },
        }))),
    },
    {
      id: 'invoices.duplicate.possibleImport', severity: 'review',
      title: 'Same client, same date, same amount, more than once',
      why: 'The signature of an import that ran twice.',
      group: true,
      run: (ctx, rows) => collisions(
        rows.filter((i) => lower(i.status) !== 'draft' && i.clientId && i.activeFrom),
        (i) => `${i.clientId}|${i.activeFrom}|${i.amountDue}`,
      ).flatMap(([key, group]) => group.map((i) => ({
        record: i, display: label(i), groupKey: key,
        fields: { client: i.clientId, date: i.activeFrom, amountDue: money(i.amountDue, ctx.currency) },
      }))),
    },
    {
      id: 'invoices.bundle.danglingParent', severity: 'critical',
      title: 'Nested bundle on an invoice points at a bundle not on that invoice',
      run: (ctx, rows) => rows.flatMap((i) => {
        const present = new Set((i.billingBundles ?? []).map((b) => b.id));
        return (i.billingBundles ?? [])
          .filter((b) => !isBlank(b.parentBillingBundleId) && !present.has(b.parentBillingBundleId))
          .map((b) => ({ record: i, display: label(i), fields: { bundle: b.name ?? b.id, danglingParent: b.parentBillingBundleId } }));
      }),
    },
    {
      id: 'invoices.ref.client', severity: 'critical',
      title: 'Invoice for a client that does not exist',
      run: (ctx, rows) => rows.filter((i) => !isBlank(i.clientId) && !ctx.ix.clientIds.has(i.clientId)).map((i) => ({
        record: i, display: label(i), fields: { danglingClientId: i.clientId, amountDue: money(i.amountDue, ctx.currency) },
      })),
    },
    {
      id: 'invoices.ref.pet', severity: 'critical',
      title: 'Invoice for a pet that does not exist',
      run: (ctx, rows) => rows.filter((i) => !isBlank(i.petId) && !ctx.ix.petIds.has(i.petId)).map((i) => ({
        record: i, display: label(i), fields: { danglingPetId: i.petId },
      })),
    },
    {
      id: 'invoices.ref.employee', severity: 'critical',
      title: 'Invoice raised by an employee that does not exist',
      needs: 'employees',
      run: (ctx, rows) => rows.filter((i) => !isBlank(i.createdByEmployeeId) && !ctx.ix.employeeIds.has(i.createdByEmployeeId)).map((i) => ({
        record: i, display: label(i), fields: { danglingEmployeeId: i.createdByEmployeeId },
      })),
    },
    {
      id: 'invoices.ref.store', severity: 'critical',
      title: 'Invoice at a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((i) => !isBlank(i.storeId) && !ctx.storeIds.has(i.storeId)).map((i) => ({
        record: i, display: label(i), fields: { storeId: i.storeId },
      })),
    },
  ],
};
