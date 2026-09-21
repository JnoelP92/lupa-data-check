// Section 6.6 — Bundles.
//
// The bundle response exposes nesting (parentBundleIds / childBundleIds) but not the
// products and services inside a bundle. Component-level checking therefore has to come
// from invoices, by matching billingProducts[] / billingServices[] back to their
// billingBundleId — that lives in the cross-record module, not here.
import { isBlank, lower, breakdown, collisions, money } from '../util.js';

export default {
  key: 'bundles',
  label: 'Bundles',
  linkType: 'bundle',

  tally(ctx, rows) {
    return [
      { label: 'Total bundles', value: rows.length },
      { label: 'Priced at zero', value: rows.filter((b) => Number(b.price ?? 0) === 0).length },
      { label: 'With nested children', value: rows.filter((b) => (b.childBundleIds ?? []).length).length },
      { label: 'Nested inside another', value: rows.filter((b) => (b.parentBundleIds ?? []).length).length },
      { label: 'By store', breakdown: breakdown(rows, (b) => b.storeId, { labels: ctx.storeNames }) },
    ];
  },

  rules: [
    {
      id: 'bundles.price.negative', severity: 'critical',
      title: 'Negative price',
      run: (ctx, rows) => rows.filter((b) => Number(b.price ?? 0) < 0).map((b) => ({
        record: b, display: b.name, fields: { price: money(b.price, ctx.currency) },
      })),
    },
    {
      id: 'bundles.price.zero', severity: 'review',
      title: 'Bundle priced at zero',
      why: 'Legitimate for free-at-point-of-use bundles under a plan, but worth confirming.',
      run: (ctx, rows) => rows.filter((b) => Number(b.price ?? 0) === 0).map((b) => ({
        record: b, display: b.name, fields: { store: ctx.storeNames.get(b.storeId) ?? b.storeId },
      })),
    },
    {
      id: 'bundles.nesting.self', severity: 'critical',
      title: 'Bundle contains itself',
      run: (ctx, rows) => rows.filter((b) => (b.childBundleIds ?? []).includes(b.id)).map((b) => ({
        record: b, display: b.name, fields: { id: b.id },
      })),
    },
    {
      id: 'bundles.nesting.danglingChild', severity: 'critical',
      title: 'Nested child bundle does not exist',
      run: (ctx, rows) => rows.flatMap((b) => (b.childBundleIds ?? []).filter((c) => !ctx.ix.bundleIds.has(c)).map((c) => ({
        record: b, display: b.name, fields: { danglingChildId: c },
      }))),
    },
    {
      id: 'bundles.nesting.danglingParent', severity: 'critical',
      title: 'Parent bundle does not exist',
      run: (ctx, rows) => rows.flatMap((b) => (b.parentBundleIds ?? []).filter((p) => !ctx.ix.bundleIds.has(p)).map((p) => ({
        record: b, display: b.name, fields: { danglingParentId: p },
      }))),
    },
    {
      id: 'bundles.duplicate.name', severity: 'review',
      title: 'Two bundles share a name at the same store',
      group: true,
      run: (ctx, rows) => collisions(rows, (b) => `${b.storeId ?? ''}|${lower(b.name)}`)
        .flatMap(([key, group]) => group.map((b) => ({ record: b, display: b.name, groupKey: key, fields: { price: money(b.price, ctx.currency) } }))),
    },
    {
      id: 'bundles.ref.store', severity: 'critical',
      title: 'Bundle at a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((b) => !isBlank(b.storeId) && !ctx.storeIds.has(b.storeId)).map((b) => ({
        record: b, display: b.name, fields: { storeId: b.storeId },
      })),
    },
  ],
};
