// Section 6.11.2 — Payments.
import { isBlank, lower, breakdown, money, parseDate, daysAgo } from '../util.js';

const STUCK = new Set(['pending', 'processing', 'authorized']);
const label = (p) => `${p.method ?? 'payment'} ${p.id?.slice(0, 8) ?? ''}`.trim();

export default {
  key: 'payments',
  label: 'Payments',
  linkType: null,

  tally(ctx, rows) {
    const byMethod = new Map();
    for (const p of rows) {
      if (lower(p.status) !== 'completed') continue;
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + Number(p.amount ?? 0));
    }
    const completed = rows.filter((p) => lower(p.status) === 'completed');
    const failed = rows.filter((p) => ['failed', 'cancelled'].includes(lower(p.status)));
    return [
      { label: 'Total payments', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (p) => p.status) },
      { label: 'By method', breakdown: breakdown(rows, (p) => p.method) },
      {
        label: 'Completed value by method',
        breakdown: [...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([key, sum]) => ({
          key: key ?? '(none)', label: key ?? '(none)', count: '', extra: money(sum, ctx.currency),
        })),
      },
      { label: 'Total collected', value: money(completed.reduce((t, p) => t + Number(p.amount ?? 0), 0), ctx.currency) },
      { label: 'Failed or cancelled', value: `${failed.length}, ${money(failed.reduce((t, p) => t + Number(p.amount ?? 0), 0), ctx.currency)}` },
      { label: 'Not allocated to an invoice', value: rows.filter((p) => isBlank(p.storeInvoiceId)).length },
    ];
  },

  rules: [
    {
      id: 'payments.amount.invalid', severity: 'critical',
      title: 'Completed payment of zero or less',
      run: (ctx, rows) => rows.filter((p) => Number(p.amount ?? 0) <= 0 && lower(p.status) === 'completed').map((p) => ({
        record: p, display: label(p), fields: { client: p.clientId, amount: money(p.amount, ctx.currency), method: p.method },
      })),
    },
    {
      id: 'payments.allocation.none', severity: 'review',
      title: 'Completed payment not allocated to any invoice',
      clientFacing: 'Payment received but not applied to an invoice.',
      why: 'Sits as credit on the account. Common and often legitimate, but it explains balance mismatches.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((p) => isBlank(p.storeInvoiceId) && lower(p.status) === 'completed').map((p) => ({
        record: p, display: label(p), fields: { client: p.clientId, amount: money(p.amount, ctx.currency), method: p.method },
      })),
    },
    {
      id: 'payments.status.stuck', severity: 'review',
      title: 'Payment stuck in progress for over a week',
      run: (ctx, rows) => rows.filter((p) => {
        const c = parseDate(p.createdAt);
        return STUCK.has(lower(p.status)) && c && c < daysAgo(7, ctx.now.getTime());
      }).map((p) => ({ record: p, display: label(p), fields: { client: p.clientId, amount: money(p.amount, ctx.currency), status: p.status, createdAt: p.createdAt } })),
    },
    {
      id: 'payments.status.failed', severity: 'info',
      title: 'Failed payment',
      truncate: 25,
      run: (ctx, rows) => rows.filter((p) => lower(p.status) === 'failed').map((p) => ({
        record: p, display: label(p), fields: { client: p.clientId, amount: money(p.amount, ctx.currency), method: p.method },
      })),
    },
    {
      id: 'payments.ref.client', severity: 'critical',
      title: 'Payment from a client that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.clientId) && !ctx.ix.clientIds.has(p.clientId)).map((p) => ({
        record: p, display: label(p), fields: { danglingClientId: p.clientId, amount: money(p.amount, ctx.currency) },
      })),
    },
    {
      id: 'payments.ref.invoice', severity: 'critical',
      title: 'Payment allocated to an invoice that does not exist',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.storeInvoiceId) && !ctx.ix.invoiceIds.has(p.storeInvoiceId)).map((p) => ({
        record: p, display: label(p), fields: { danglingInvoiceId: p.storeInvoiceId, amount: money(p.amount, ctx.currency) },
      })),
    },
    {
      id: 'payments.ref.clientMismatch', severity: 'critical',
      title: 'Payment is on a different client from the invoice it pays',
      why: 'One client’s money is clearing another client’s balance.',
      run: (ctx, rows) => rows.filter((p) => {
        if (isBlank(p.storeInvoiceId) || isBlank(p.clientId)) return false;
        const invoiceClient = ctx.ix.invoiceClient.get(p.storeInvoiceId);
        return invoiceClient && invoiceClient !== p.clientId;
      }).map((p) => ({
        record: p, display: label(p),
        fields: { paymentClient: p.clientId, invoiceClient: ctx.ix.invoiceClient.get(p.storeInvoiceId), amount: money(p.amount, ctx.currency) },
      })),
    },
  ],
};
