// Section 6.11.4 — Refunds.
import { isBlank, lower, breakdown, money, parseDate, daysAgo } from '../util.js';

const label = (r) => `${r.reason ?? 'refund'} ${r.id?.slice(0, 8) ?? ''}`.trim();

export default {
  key: 'refunds',
  label: 'Refunds',
  linkType: null,

  tally(ctx, rows) {
    const completed = rows.filter((r) => lower(r.status) === 'completed');
    return [
      { label: 'Total refunds', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (r) => r.status) },
      { label: 'By reason', breakdown: breakdown(rows, (r) => r.reason) },
      { label: 'Completed value', value: money(completed.reduce((t, r) => t + Number(r.amount ?? 0), 0), ctx.currency) },
    ];
  },

  rules: [
    {
      id: 'refunds.amount.invalid', severity: 'critical',
      title: 'Refund for zero or less',
      run: (ctx, rows) => rows.filter((r) => Number(r.amount ?? 0) <= 0).map((r) => ({
        record: r, display: label(r), fields: { client: r.clientId, amount: money(r.amount, ctx.currency), reason: r.reason },
      })),
    },
    {
      id: 'refunds.reason.unknown', severity: 'review',
      title: 'Refund with reason "unknown"',
      run: (ctx, rows) => rows.filter((r) => lower(r.reason) === 'unknown').map((r) => ({
        record: r, display: label(r), fields: { client: r.clientId, amount: money(r.amount, ctx.currency) },
      })),
    },
    {
      id: 'refunds.status.stuck', severity: 'review',
      title: 'Refund pending for over a week',
      clientFacing: 'Refund started but never completed.',
      run: (ctx, rows) => rows.filter((r) => {
        const c = parseDate(r.createdAt);
        return lower(r.status) === 'pending' && c && c < daysAgo(7, ctx.now.getTime());
      }).map((r) => ({ record: r, display: label(r), fields: { client: r.clientId, amount: money(r.amount, ctx.currency), createdAt: r.createdAt } })),
    },
    {
      id: 'refunds.payment.none', severity: 'critical',
      title: 'Refund with no source payment',
      why: 'Money out with nothing recording where it came from.',
      run: (ctx, rows) => rows.filter((r) => isBlank(r.paymentId)).map((r) => ({
        record: r, display: label(r), fields: { client: r.clientId, amount: money(r.amount, ctx.currency) },
      })),
    },
    {
      id: 'refunds.ref.payment', severity: 'critical',
      title: 'Source payment does not exist',
      run: (ctx, rows) => rows.filter((r) => !isBlank(r.paymentId) && !ctx.ix.paymentIds.has(r.paymentId)).map((r) => ({
        record: r, display: label(r), fields: { danglingPaymentId: r.paymentId, amount: money(r.amount, ctx.currency) },
      })),
    },
    {
      id: 'refunds.ref.client', severity: 'critical',
      title: 'Refund to a client that does not exist',
      run: (ctx, rows) => rows.filter((r) => !isBlank(r.clientId) && !ctx.ix.clientIds.has(r.clientId)).map((r) => ({
        record: r, display: label(r), fields: { danglingClientId: r.clientId },
      })),
    },
    {
      id: 'refunds.amount.exceedsPayment', severity: 'critical',
      title: 'Refund is larger than the payment it refunds',
      run: (ctx, rows) => rows.filter((r) => {
        if (isBlank(r.paymentId)) return false;
        const paid = ctx.ix.paymentAmount.get(r.paymentId);
        return paid !== undefined && Number(r.amount ?? 0) > paid;
      }).map((r) => ({
        record: r, display: label(r),
        fields: { refund: money(r.amount, ctx.currency), payment: money(ctx.ix.paymentAmount.get(r.paymentId), ctx.currency) },
      })),
    },
  ],
};
