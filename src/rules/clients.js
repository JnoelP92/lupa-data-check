// Section 6.1 — Clients.
//
// Every rule here is computable from the clients collection plus the stores and
// payment-terms reference sets. The balance-vs-transaction-history reconciliation
// (6.11.6) needs invoices, payments and credit notes, so it lives in the financials
// module and is cross-referenced from the client section at render time.
import { isBlank, lower, phoneKey, breakdown, collisions, money, parseDate, plural } from '../util.js';

// The API's own email pattern. A value that fails this was accepted by an import path
// that did not validate, so it will fail again the first time comms are sent.
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

const PLACEHOLDER_PHONE = [
  /^(\d)\1+$/,            // 0000000000, 1111111111
  /^555\d{7}$/,           // reserved test range
  /^0?1234567/,           // 01234567890 and friends
  /^0?9{7,}$/,
];

const fullName = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || '(no name)';
const live = (c) => c.isArchived === false;

export default {
  key: 'clients',
  label: 'Clients',
  linkType: 'client',

  tally(ctx) {
    const rows = ctx.clients;
    const storeNames = ctx.storeNames;
    const withBalance = rows.filter((c) => Number(c.balance ?? 0) !== 0);
    const inCredit = rows.filter((c) => Number(c.balance ?? 0) < 0);
    const inDebt = rows.filter((c) => Number(c.balance ?? 0) > 0);
    const sum = (list) => list.reduce((t, c) => t + Number(c.balance ?? 0), 0);
    const contactCounts = rows.map((c) => (Array.isArray(c.contacts) ? c.contacts.length : 0));
    const withContacts = contactCounts.filter((n) => n > 0).length;

    return [
      { label: 'Total clients', value: rows.length },
      { label: 'Active', value: rows.filter(live).length },
      { label: 'Archived', value: rows.filter((c) => c.isArchived === true).length },
      { label: 'By store', breakdown: breakdown(rows, (c) => c.primaryStoreId, { labels: storeNames }) },
      { label: 'On billing hold', value: rows.filter((c) => c.billingHold === true).length },
      { label: 'GDPR opt-in', breakdown: breakdown(rows, (c) => String(c.gdprOptIn ?? 'unset')) },
      { label: 'Platform comms opt-in', breakdown: breakdown(rows, (c) => String(c.platformCommsOptIn ?? 'unset')) },
      { label: 'Missing email (active)', value: rows.filter((c) => live(c) && isBlank(c.email)).length },
      { label: 'Missing phone (active)', value: rows.filter((c) => live(c) && isBlank(c.phone)).length },
      { label: 'Missing address line 1 (active)', value: rows.filter((c) => live(c) && isBlank(c.address?.line_1)).length },
      { label: 'Non-zero balance', value: withBalance.length },
      { label: 'In credit', value: `${plural(inCredit.length, 'client')}, ${money(Math.abs(sum(inCredit)), ctx.currency)}` },
      { label: 'In debt', value: `${plural(inDebt.length, 'client')}, ${money(sum(inDebt), ctx.currency)}` },
      { label: 'Net outstanding (debt − credit)', value: money(sum(rows), ctx.currency) },
      {
        label: 'With additional contacts',
        value: `${plural(withContacts, 'client')}, ${(contactCounts.reduce((a, b) => a + b, 0) / (rows.length || 1)).toFixed(2)} avg per client`,
      },
    ];
  },

  rules: [
    {
      id: 'clients.email.missing',
      severity: 'review',
      title: 'Active client with no email address',
      why: 'Cannot be reached by any email comms — reminders, invoices, confirmations.',
      run: (ctx) => ctx.clients.filter((c) => live(c) && isBlank(c.email)).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, phone: c.phone, store: ctx.storeNames.get(c.primaryStoreId) ?? c.primaryStoreId },
      })),
    },
    {
      id: 'clients.phone.missing',
      severity: 'review',
      title: 'Active client with no phone number',
      why: 'Cannot be reached by SMS or call.',
      run: (ctx) => ctx.clients.filter((c) => live(c) && isBlank(c.phone)).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, email: c.email, store: ctx.storeNames.get(c.primaryStoreId) ?? c.primaryStoreId },
      })),
    },
    {
      id: 'clients.email.malformed',
      severity: 'critical',
      title: 'Email address fails the API’s own validation',
      clientFacing: 'Email address does not look valid.',
      why: 'Accepted by an import path that did not validate. Will fail on first send.',
      run: (ctx) => ctx.clients.filter((c) => !isBlank(c.email) && !EMAIL.test(c.email.trim())).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, email: c.email },
      })),
    },
    {
      id: 'clients.phone.implausible',
      severity: 'review',
      title: 'Phone number looks like a placeholder',
      clientFacing: 'Phone number does not look like a real number.',
      run: (ctx) => ctx.clients.filter((c) => {
        if (isBlank(c.phone)) return false;
        const digits = c.phone.replace(/\D/g, '');
        return digits.length < 7 || PLACEHOLDER_PHONE.some((re) => re.test(digits));
      }).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, phone: c.phone },
      })),
    },
    {
      id: 'clients.dob.implausible',
      severity: 'review',
      title: 'Date of birth is in the future or before 1900',
      run: (ctx) => ctx.clients.filter((c) => {
        const d = parseDate(c.dob);
        return d && (d > ctx.now || d.getUTCFullYear() < 1900);
      }).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, dob: c.dob },
      })),
    },
    {
      id: 'clients.address.missing',
      severity: 'info',
      title: 'Active client with no address line 1',
      run: (ctx) => ctx.clients.filter((c) => live(c) && isBlank(c.address?.line_1)).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId },
      })),
    },
    {
      id: 'clients.duplicate.email',
      severity: 'critical',
      title: 'Two or more clients share an email address',
      why: 'Comms go to the wrong household, and merging after go-live is manual.',
      group: true,
      run: (ctx) => collisions(ctx.clients, (c) => lower(c.email)).flatMap(([key, group]) =>
        group.map((c) => ({
          record: c,
          display: fullName(c),
          groupKey: key,
          fields: { numericId: c.numericId, email: c.email, store: ctx.storeNames.get(c.primaryStoreId) ?? c.primaryStoreId },
          reason: `Shared with ${group.length - 1} other client${group.length > 2 ? 's' : ''}`,
        })),
      ),
    },
    {
      id: 'clients.duplicate.phone',
      severity: 'critical',
      title: 'Two or more clients share a phone number',
      why: 'Often a real duplicate record, but households legitimately share a landline — needs a look.',
      group: true,
      run: (ctx) => collisions(ctx.clients, (c) => phoneKey(c.phone)).flatMap(([key, group]) =>
        group.map((c) => ({
          record: c,
          display: fullName(c),
          groupKey: key,
          fields: { numericId: c.numericId, phone: c.phone, store: ctx.storeNames.get(c.primaryStoreId) ?? c.primaryStoreId },
          reason: `Shared with ${group.length - 1} other client${group.length > 2 ? 's' : ''}`,
        })),
      ),
    },
    {
      id: 'clients.duplicate.nameDob',
      severity: 'review',
      title: 'Two or more clients share name and date of birth',
      group: true,
      run: (ctx) => collisions(
        ctx.clients.filter((c) => !isBlank(c.dob)),
        (c) => `${lower(c.firstName)}|${lower(c.lastName)}|${c.dob}`,
      ).flatMap(([key, group]) =>
        group.map((c) => ({
          record: c,
          display: fullName(c),
          groupKey: key,
          fields: { numericId: c.numericId, dob: c.dob, email: c.email, phone: c.phone },
        })),
      ),
    },
    {
      id: 'clients.balance.nonZero',
      severity: 'info',
      title: 'Client with a non-zero balance',
      why: 'The per-client view of the aged-debt figure. Not an error on its own.',
      truncate: 10,
      run: (ctx) => ctx.clients
        .filter((c) => Number(c.balance ?? 0) !== 0)
        .sort((a, b) => Math.abs(Number(b.balance ?? 0)) - Math.abs(Number(a.balance ?? 0)))
        .map((c) => ({
          record: c,
          display: fullName(c),
          fields: {
            numericId: c.numericId,
            balance: money(c.balance, ctx.currency),
            store: ctx.storeNames.get(c.primaryStoreId) ?? c.primaryStoreId,
          },
        })),
    },
    {
      id: 'clients.ref.primaryStore',
      severity: 'critical',
      title: 'Primary store is not a store on this company',
      clientFacing: 'Client is linked to a location that no longer exists.',
      needs: 'stores',
      run: (ctx) => ctx.clients.filter((c) => !isBlank(c.primaryStoreId) && !ctx.storeIds.has(c.primaryStoreId)).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, primaryStoreId: c.primaryStoreId },
      })),
    },
    {
      id: 'clients.ref.paymentTerms',
      severity: 'critical',
      title: 'Payment terms reference does not resolve',
      needs: 'paymentTerms',
      run: (ctx) => ctx.clients.filter((c) => !isBlank(c.paymentTermsId) && !ctx.paymentTermIds.has(c.paymentTermsId)).map((c) => ({
        record: c,
        display: fullName(c),
        fields: { numericId: c.numericId, paymentTermsId: c.paymentTermsId },
      })),
    },
    {
      id: 'clients.contacts.noRoute',
      severity: 'info',
      title: 'Additional contact with neither email nor phone',
      run: (ctx) => ctx.clients.flatMap((c) =>
        (c.contacts ?? [])
          .filter((k) => isBlank(k.email) && isBlank(k.phone))
          .map((k) => ({
            record: c,
            display: fullName(c),
            fields: {
              numericId: c.numericId,
              contact: [k.firstName, k.lastName].filter(Boolean).join(' ') || '(unnamed)',
              relationship: k.relationshipType,
            },
          })),
      ),
    },
  ],
};
