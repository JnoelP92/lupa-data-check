// Section 6.5 — Services.
import { isBlank, lower, breakdown, collisions, money } from '../util.js';

const PRODUCT_WORDS = /\b(tablet|capsule|ml\b|bottle|pack|sachet|syringe|vial|collar|shampoo|food|diet|kg\b|mg\b|wormer|spot[- ]?on)\b/i;
const SERVICE_WORDS = /\b(consult|exam|surgery|professional)\b/i;
const live = (s) => s.isArchived === false;
const margin = (s) => {
  const cost = Number(s.procurementCost ?? 0), price = Number(s.price ?? 0);
  return cost > 0 ? ((price - cost) / cost) * 100 : null;
};

export default {
  key: 'services',
  label: 'Services',
  linkType: 'service',

  tally(ctx, rows) {
    return [
      { label: 'Total services', value: rows.length },
      { label: 'Active', value: rows.filter(live).length },
      { label: 'Archived', value: rows.filter((s) => s.isArchived === true).length },
      { label: 'Sellable', value: rows.filter((s) => s.isSellable === true).length },
      { label: 'By category', breakdown: breakdown(rows, (s) => s.category) },
      { label: 'By VAT rate', breakdown: breakdown(rows, (s) => String(s.vatPercentage ?? '(unset)')) },
      { label: 'Internal name differs from name', value: rows.filter((s) => !isBlank(s.internalName) && lower(s.internalName) !== lower(s.name)).length },
      { label: 'Loss-making (margin < 0)', value: rows.filter((s) => (margin(s) ?? 0) < 0).length },
      { label: 'VAT-exempt eligible', value: rows.filter((s) => s.isVatExemptEligible === true).length },
      { label: 'External service', value: rows.filter((s) => s.isExternal === true).length },
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
      id: 'services.price.freeButSellable', severity: 'review',
      title: 'Sellable service priced at zero',
      why: 'Some are legitimately free — re-checks under a plan — so this needs a human eye.',
      run: (ctx, rows) => rows.filter((s) => Number(s.price ?? 0) === 0 && s.isSellable === true && live(s)).map((s) => ({
        record: s, display: s.name, fields: { category: s.category },
      })),
    },
    {
      id: 'services.margin.negative', severity: 'review',
      title: 'Loss-making service',
      run: (ctx, rows) => rows.filter((s) => (margin(s) ?? 0) < 0).map((s) => ({
        record: s, display: s.name,
        fields: { category: s.category, price: money(s.price, ctx.currency), cost: money(s.procurementCost, ctx.currency), margin: `${margin(s).toFixed(0)}%` },
      })),
    },
    {
      id: 'services.margin.huge', severity: 'review',
      title: 'Markup over 500%',
      run: (ctx, rows) => rows.filter((s) => (margin(s) ?? 0) > 500).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, price: money(s.price, ctx.currency), margin: `${margin(s).toFixed(0)}%` },
      })),
    },
    {
      id: 'services.vat.unexpected', severity: 'review',
      title: 'VAT rate outside the expected set',
      run: (ctx, rows) => rows.filter((s) => !isBlank(s.vatPercentage) && !ctx.vatRates.includes(Number(s.vatPercentage))).map((s) => ({
        record: s, display: s.name, fields: { category: s.category, vatPercentage: s.vatPercentage },
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
      run: (ctx, rows) => rows.filter((s) => live(s) && PRODUCT_WORDS.test(s.name ?? '')).map((s) => ({
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
      title: 'Two active services share a name at the same store',
      group: true,
      run: (ctx, rows) => collisions(rows.filter(live), (s) => `${s.storeId ?? ''}|${lower(s.name)}`)
        .flatMap(([key, group]) => group.map((s) => ({ record: s, display: s.name, groupKey: key, fields: { category: s.category, price: money(s.price, ctx.currency) } }))),
    },
    {
      id: 'services.state.sellableArchived', severity: 'critical',
      title: 'Marked sellable and archived at once',
      run: (ctx, rows) => rows.filter((s) => s.isSellable === true && s.isArchived === true).map((s) => ({
        record: s, display: s.name, fields: { category: s.category },
      })),
    },
  ],
};
