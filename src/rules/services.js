// Section 6.5 — Services.
//
// The services resource is far thinner than the other catalogue endpoints. It returns
// only: category, externalReference, id, margin, name, price, referenceListId, storeId
// and timestamps. There is no isSellable, no isArchived, no vatPercentage and no
// procurementCost.
//
// That removes four rules the spec asked for, and they are named in
// references/ruleset-v1.md rather than left as code that quietly matches nothing:
//   - "sellable service priced at zero"  → no isSellable; reported on price alone
//   - "sellable and archived at once"    → neither field exists
//   - "VAT rate outside the expected set" → VAT is a store-level percentage
//   - "margin < 0 from price vs cost"    → the API supplies `margin` directly, used here
import { isBlank, lower, breakdown, collisions, money } from '../util.js';

const PRODUCT_WORDS = /\b(tablet|capsule|ml\b|bottle|pack|sachet|syringe|vial|collar|shampoo|food|diet|kg\b|mg\b|wormer|spot[- ]?on)\b/i;
const SERVICE_WORDS = /\b(consult|exam|surgery|professional)\b/i;

const marginOf = (s) => (isBlank(s.margin) ? null : Number(s.margin));

export default {
  key: 'services',
  label: 'Services',
  linkType: 'service',
  storeFrom: (s) => s.storeId,

  tally(ctx, rows) {
    const withMargin = rows.filter((s) => marginOf(s) !== null);
    return [
      { label: 'Total services', value: rows.length },
      { label: 'By category', breakdown: breakdown(rows, (s) => s.category) },
      { label: 'By store', breakdown: breakdown(rows, (s) => s.storeId, { labels: ctx.storeNames }) },
      { label: 'Priced at zero', value: rows.filter((s) => Number(s.price ?? 0) === 0).length },
      { label: 'Loss-making (margin < 0)', value: rows.filter((s) => (marginOf(s) ?? 0) < 0).length },
      { label: 'No margin recorded', value: rows.length - withMargin.length },
      { label: 'Linked to an external reference', value: rows.filter((s) => !isBlank(s.externalReference)).length },
      { label: 'On a reference list', value: rows.filter((s) => !isBlank(s.referenceListId)).length },
    ];
  },

  rules: [
    {
      id: 'services.price.negative', severity: 'critical',
      title: 'Negative price',
      run: (ctx, rows) => rows.filter((s) => Number(s.price ?? 0) < 0).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, price: money(s.price, ctx.currency) },
      })),
    },
    {
      id: 'services.price.zero', severity: 'review',
      title: 'Service priced at zero',
      clientFacing: 'Service is set up with no price.',
      why: 'Some are legitimately free — re-checks, plan-covered visits — so this needs a human eye.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((s) => Number(s.price ?? 0) === 0).map((s) => ({
        record: s, display: s.name, fields: { category: s.category },
      })),
    },
    {
      id: 'services.margin.negative', severity: 'review',
      title: 'Loss-making service',
      why: 'Margin as the API reports it, not recomputed here.',
      run: (ctx, rows) => rows.filter((s) => (marginOf(s) ?? 0) < 0).map((s) => ({
        record: s, display: s.name,
        fields: { category: s.category, price: money(s.price, ctx.currency), margin: `${marginOf(s).toFixed(0)}%` },
      })),
    },
    {
      id: 'services.margin.huge', severity: 'review',
      title: 'Margin over 500%',
      run: (ctx, rows) => rows.filter((s) => (marginOf(s) ?? 0) > 500).map((s) => ({
        record: s, display: s.name,
        fields: { category: s.category, price: money(s.price, ctx.currency), margin: `${marginOf(s).toFixed(0)}%` },
      })),
    },
    {
      id: 'services.category.otherOrFee', severity: 'info',
      title: 'Categorised as "other" or "fee"',
      why: 'Listed so the practice can decide whether to reclassify.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((s) => ['other', 'fee'].includes(lower(s.category))).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, price: money(s.price, ctx.currency) },
      })),
    },
    {
      id: 'services.category.miscategorised', severity: 'review',
      title: 'Named like a clinical service but categorised as "other"',
      run: (ctx, rows) => rows.filter((s) => lower(s.category) === 'other' && SERVICE_WORDS.test(s.name ?? '')).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, price: money(s.price, ctx.currency) },
      })),
    },
    {
      id: 'services.name.soundsLikeProduct', severity: 'review',
      title: 'Service name describes a product',
      clientFacing: 'This is in the service list but reads like a product.',
      run: (ctx, rows) => rows.filter((s) => PRODUCT_WORDS.test(s.name ?? '')).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, price: money(s.price, ctx.currency) },
      })),
    },
    {
      id: 'services.ref.store', severity: 'critical',
      title: 'Service at a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((s) => !isBlank(s.storeId) && !ctx.storeIds.has(s.storeId)).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, storeId: s.storeId },
      })),
    },
    {
      id: 'services.ref.referenceList', severity: 'critical',
      title: 'Reference list does not resolve',
      needs: 'referenceLists',
      run: (ctx, rows) => rows.filter((s) => !isBlank(s.referenceListId) && !ctx.referenceListIds.has(s.referenceListId)).map((s) => ({
        record: s, display: s.name, fields: { referenceListId: s.referenceListId },
      })),
    },
    {
      id: 'services.duplicate.name', severity: 'review',
      title: 'Two services share a name at the same store',
      group: true,
      run: (ctx, rows) => collisions(rows, (s) => `${s.storeId ?? ''}|${lower(s.name)}`)
        .flatMap(([key, group]) => group.map((s) => ({
          record: s, display: s.name, groupKey: key,
          fields: { category: s.category, price: money(s.price, ctx.currency) },
        }))),
    },
  ],
};
