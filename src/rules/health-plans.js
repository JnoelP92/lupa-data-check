// Section 6.12.1 — Health plan definitions.
import { isBlank, lower, breakdown, collisions, money } from '../util.js';

const ITEM_ALLOWANCES = new Set(['individual_product', 'individual_service']);
const CATEGORY_ALLOWANCES = new Set(['product_category', 'service_category']);

export default {
  key: 'healthPlans',
  label: 'Health plans',
  linkType: 'healthPlan',

  tally(ctx, rows) {
    const allowances = rows.flatMap((p) => p.allowances ?? []);
    return [
      { label: 'Total plans', value: rows.length },
      { label: 'By status', breakdown: breakdown(rows, (p) => p.status) },
      { label: 'By billing period', breakdown: breakdown(rows, (p) => p.billingPeriod) },
      { label: 'By subscriber type', breakdown: breakdown(rows, (p) => p.targetSubscriberType) },
      { label: 'With no allowances', value: rows.filter((p) => !(p.allowances ?? []).length).length },
      { label: 'Total allowances', value: allowances.length },
      { label: 'Allowances by type', breakdown: breakdown(allowances, (a) => a.type) },
      { label: 'Archived allowances', value: allowances.filter((a) => lower(a.status) === 'archived').length },
    ];
  },

  rules: [
    {
      id: 'healthPlans.price.invalid', severity: 'critical',
      title: 'Active plan priced at zero or below',
      run: (ctx, rows) => rows.filter((p) => lower(p.status) === 'active' && Number(p.price ?? 0) <= 0).map((p) => ({
        record: p, display: p.name, fields: { price: money(p.price, ctx.currency), billingPeriod: p.billingPeriod },
      })),
    },
    {
      id: 'healthPlans.allowances.none', severity: 'critical',
      title: 'Active plan with no benefits at all',
      clientFacing: 'Plan is live but includes nothing.',
      run: (ctx, rows) => rows.filter((p) => lower(p.status) === 'active' && !(p.allowances ?? []).length).map((p) => ({
        record: p, display: p.name, fields: { price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'healthPlans.duplicate.name', severity: 'review',
      title: 'Two active plans share a name',
      group: true,
      run: (ctx, rows) => collisions(rows.filter((p) => lower(p.status) === 'active'), (p) => lower(p.name))
        .flatMap(([key, group]) => group.map((p) => ({ record: p, display: p.name, groupKey: key, fields: { price: money(p.price, ctx.currency) } }))),
    },
    {
      id: 'healthPlans.allowance.danglingItem', severity: 'critical',
      title: 'Allowance points at a product or service that does not exist',
      run: (ctx, rows) => rows.flatMap((p) => (p.allowances ?? [])
        .filter((a) => ITEM_ALLOWANCES.has(lower(a.type)))
        .filter((a) => {
          if (isBlank(a.item)) return true;
          return !ctx.ix.productIds.has(a.item) && !ctx.ix.serviceIds.has(a.item);
        })
        .map((a) => ({
          record: p, display: p.name,
          fields: { allowance: a.name ?? a.type, danglingItem: a.item ?? '(none)' },
        }))),
    },
    {
      id: 'healthPlans.allowance.unknownCategory', severity: 'critical',
      title: 'Allowance points at a category that is not a valid enum value',
      run: (ctx, rows) => {
        const valid = new Set([
          ...(ctx.enums.productCategory ?? []),
          ...(ctx.enums.serviceCategory ?? []),
        ].map((v) => lower(typeof v === 'string' ? v : v?.value ?? v?.name)));
        if (!valid.size) return [];
        return rows.flatMap((p) => (p.allowances ?? [])
          .filter((a) => CATEGORY_ALLOWANCES.has(lower(a.type)) && !isBlank(a.item) && !valid.has(lower(a.item)))
          .map((a) => ({ record: p, display: p.name, fields: { allowance: a.name ?? a.type, category: a.item } })));
      },
    },
    {
      id: 'healthPlans.allowance.unbounded', severity: 'review',
      title: 'Active allowance with no limit configured',
      why: 'Reads as unlimited. Sometimes intended, usually not.',
      run: (ctx, rows) => rows.flatMap((p) => (p.allowances ?? [])
        .filter((a) => lower(a.status) === 'active' && (isBlank(a.config) || (typeof a.config === 'object' && !Object.keys(a.config).length)))
        .map((a) => ({ record: p, display: p.name, fields: { allowance: a.name ?? a.type, type: a.type } }))),
    },
    {
      id: 'healthPlans.allowance.noAppliesTo', severity: 'critical',
      title: 'Allowance with no appliesTo',
      run: (ctx, rows) => rows.flatMap((p) => (p.allowances ?? [])
        .filter((a) => isBlank(a.appliesTo))
        .map((a) => ({ record: p, display: p.name, fields: { allowance: a.name ?? a.type, type: a.type } }))),
    },
  ],
};
