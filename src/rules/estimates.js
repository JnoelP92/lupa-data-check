// Section 6.11.5 — Estimates.
//
// Same shape as invoices, tracked separately. "Never converted" is a heuristic: no
// invoice for the same client and pet in the 30 days after the estimate. It will
// over-report at practices that invoice long after the estimate, which is why it is
// Review rather than Critical.
import { isBlank, money, parseDate } from '../util.js';
import { expectedTotal } from './invoices.js';

const label = (e) => e.invoiceNumber ?? e.id?.slice(0, 8) ?? '(estimate)';
const THIRTY_DAYS = 30 * 86_400_000;

// Built once per run and reused by both rules below.
function unconverted(ctx, rows) {
  const invoiceKeys = new Map();
  for (const i of ctx.store.read('invoices')) {
    const from = parseDate(i.activeFrom);
    if (!from || !i.clientId) continue;
    const key = `${i.clientId}|${i.petId ?? ''}`;
    if (!invoiceKeys.has(key)) invoiceKeys.set(key, []);
    invoiceKeys.get(key).push(from.getTime());
  }
  return rows.filter((e) => {
    const from = parseDate(e.activeFrom);
    if (!from) return false;
    const times = invoiceKeys.get(`${e.clientId}|${e.petId ?? ''}`) ?? [];
    return !times.some((t) => t >= from.getTime() && t <= from.getTime() + THIRTY_DAYS);
  });
}

export default {
  key: 'estimates',
  label: 'Estimates',
  linkType: 'invoice',

  tally(ctx, rows) {
    const stale = unconverted(ctx, rows).filter((e) => {
      const from = parseDate(e.activeFrom);
      return from && (ctx.now - from) / 86_400_000 > 90;
    });
    return [
      { label: 'Total estimates', value: rows.length },
      { label: 'Total estimated', value: money(rows.reduce((t, e) => t + Number(e.amountDue ?? 0), 0), ctx.currency) },
      { label: 'Never converted to an invoice', value: unconverted(ctx, rows).length },
      { label: 'Over 90 days old and still standalone', value: stale.length },
    ];
  },

  rules: [
    {
      id: 'estimates.total.mismatch', severity: 'critical',
      title: 'Estimate total does not match the sum of its lines',
      truncate: 25,
      run: (ctx, rows) => rows.filter((e) => Math.abs(expectedTotal(e) - Number(e.amountDue ?? 0)) > ctx.moneyTolerance).map((e) => ({
        record: e, display: label(e),
        fields: { client: e.clientId, amountDue: money(e.amountDue, ctx.currency), expected: money(expectedTotal(e), ctx.currency) },
      })),
    },
    {
      id: 'estimates.stale', severity: 'review',
      title: 'Estimate over 90 days old that never became an invoice',
      clientFacing: 'Old estimate still open.',
      truncate: 25,
      run: (ctx, rows) => unconverted(ctx, rows).filter((e) => {
        const from = parseDate(e.activeFrom);
        return from && (ctx.now - from) / 86_400_000 > 90;
      }).map((e) => ({
        record: e, display: label(e),
        fields: { client: e.clientId, pet: e.petId, date: e.activeFrom, amountDue: money(e.amountDue, ctx.currency) },
      })),
    },
    {
      id: 'estimates.ref.client', severity: 'critical',
      title: 'Estimate for a client that does not exist',
      run: (ctx, rows) => rows.filter((e) => !isBlank(e.clientId) && !ctx.ix.clientIds.has(e.clientId)).map((e) => ({
        record: e, display: label(e), fields: { danglingClientId: e.clientId },
      })),
    },
    {
      id: 'estimates.ref.pet', severity: 'critical',
      title: 'Estimate for a pet that does not exist',
      run: (ctx, rows) => rows.filter((e) => !isBlank(e.petId) && !ctx.ix.petIds.has(e.petId)).map((e) => ({
        record: e, display: label(e), fields: { danglingPetId: e.petId },
      })),
    },
    {
      id: 'estimates.ref.store', severity: 'critical',
      title: 'Estimate at a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((e) => !isBlank(e.storeId) && !ctx.storeIds.has(e.storeId)).map((e) => ({
        record: e, display: label(e), fields: { storeId: e.storeId },
      })),
    },
  ],
};
