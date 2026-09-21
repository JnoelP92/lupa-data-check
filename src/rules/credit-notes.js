// Section 6.11.3 — Credit notes.
//
// `amount` and `additionalCreditAmount` come back as STRINGS ("12.47") rather than
// integer minor units, unlike every other money field on the API. They are parsed once
// here and everything downstream stays in integers.
import { isBlank, lower, breakdown, money, parseMoneyString } from '../util.js';

const amountOf = (c) => parseMoneyString(c.amount) ?? 0;
// No human-readable number on this resource, so a short id is the best handle there is.
const label = (c) => (c.id ? `CN ${c.id.slice(0, 8)}` : '(credit note)');

export default {
  key: 'creditNotes',
  label: 'Credit notes',
  linkType: null,

  tally(ctx, rows) {
    const issued = rows.filter((c) => lower(c.status) === 'issued');
    const refundable = rows.filter((c) => c.isRefundable === true);
    return [
      { label: 'Total credit notes', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (c) => c.status) },
      { label: 'By reason', breakdown: breakdown(rows, (c) => c.reason) },
      { label: 'Issued value', value: money(issued.reduce((t, c) => t + amountOf(c), 0), ctx.currency) },
      { label: 'Additional credit issued', value: money(issued.reduce((t, c) => t + (parseMoneyString(c.additionalCreditAmount) ?? 0), 0), ctx.currency) },
      { label: 'Refundable', value: `${refundable.length}, ${money(refundable.reduce((t, c) => t + amountOf(c), 0), ctx.currency)}` },
    ];
  },

  rules: [
    {
      id: 'creditNotes.amount.invalid', severity: 'critical',
      title: 'Credit note for zero or less',
      run: (ctx, rows) => rows.filter((c) => amountOf(c) <= 0).map((c) => ({
        record: c, display: label(c), fields: { client: c.clientId, amount: c.amount, reason: c.reason },
      })),
    },
    {
      id: 'creditNotes.reason.migration', severity: 'review',
      title: 'Credit issued with reason "unknown due to migration"',
      clientFacing: 'Credit on the account with no recorded reason.',
      why: 'The previous system did not say why the credit existed. Worth confirming these are real before go-live, because they reduce what the client owes.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((c) => lower(c.reason) === 'unknown_due_to_migration').map((c) => ({
        record: c, display: label(c),
        fields: { client: c.clientId, amount: money(amountOf(c), ctx.currency), status: c.status },
      })),
    },
    {
      id: 'creditNotes.items.none', severity: 'review',
      title: 'Issued credit note with no lines',
      run: (ctx, rows) => rows.filter((c) => lower(c.status) === 'issued' && !(c.items ?? []).length).map((c) => ({
        record: c, display: label(c), fields: { client: c.clientId, amount: money(amountOf(c), ctx.currency) },
      })),
    },
    {
      id: 'creditNotes.status.issuedNoDate', severity: 'critical',
      title: 'Issued with no issue date',
      run: (ctx, rows) => rows.filter((c) => lower(c.status) === 'issued' && isBlank(c.issuedAt)).map((c) => ({
        record: c, display: label(c), fields: { client: c.clientId, amount: money(amountOf(c), ctx.currency) },
      })),
    },
    {
      id: 'creditNotes.status.draftWithDate', severity: 'review',
      title: 'Draft with an issue date already set',
      run: (ctx, rows) => rows.filter((c) => lower(c.status) === 'draft' && !isBlank(c.issuedAt)).map((c) => ({
        record: c, display: label(c), fields: { client: c.clientId, issuedAt: c.issuedAt },
      })),
    },
    {
      id: 'creditNotes.ref.client', severity: 'critical',
      title: 'Credit note for a client that does not exist',
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.clientId) && !ctx.ix.clientIds.has(c.clientId)).map((c) => ({
        record: c, display: label(c), fields: { danglingClientId: c.clientId },
      })),
    },
    {
      id: 'creditNotes.ref.invoice', severity: 'critical',
      title: 'Credit note against an invoice that does not exist',
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.storeInvoiceId) && !ctx.ix.invoiceIds.has(c.storeInvoiceId)).map((c) => ({
        record: c, display: label(c), fields: { danglingInvoiceId: c.storeInvoiceId },
      })),
    },
    {
      id: 'creditNotes.ref.pet', severity: 'critical',
      title: 'Credit note for a pet that does not exist',
      run: (ctx, rows) => rows.filter((c) => !isBlank(c.petId) && !ctx.ix.petIds.has(c.petId)).map((c) => ({
        record: c, display: label(c), fields: { danglingPetId: c.petId },
      })),
    },
    {
      id: 'creditNotes.items.notOnInvoice', severity: 'critical',
      title: 'Credit note line does not match a line on the invoice it credits',
      why: 'Credits something that was never charged.',
      run: (ctx, rows) => rows.flatMap((c) => {
        if (isBlank(c.storeInvoiceId) || !ctx.ix.invoiceIds.has(c.storeInvoiceId)) return [];
        return (c.items ?? [])
          .filter((it) => {
            const lineId = it.billingProductId ?? it.billingServiceId;
            return !isBlank(lineId) && !ctx.ix.invoiceLineKeys.has(`${c.storeInvoiceId}|${lineId}`);
          })
          .map((it) => ({
            record: c, display: label(c),
            fields: { invoice: c.storeInvoiceId, danglingLineId: it.billingProductId ?? it.billingServiceId },
          }));
      }),
    },
  ],
};
