// Section 6.4 — Products.
//
// Two conventions from the migration work carry into the rules here:
//   - price is per-pack and VAT-inclusive, and margin is markup on cost rather than
//     margin on sale, so `margin` is computed as (price - cost) / cost.
//   - `measureUnit` is not settable through the API; a PUT mirrors it onto `unit`. A
//     finding against it is therefore a UI job for the practice, and the rule says so.
import { isBlank, lower, breakdown, collisions, money, plural } from '../util.js';

// Units that describe a dose rather than a container. A product whose sellable unit is
// one of these and which has no subunit is almost always a pack sold as if it were a
// single tablet.
const DOSE_UNITS = new Set(['tablet', 'tab', 'capsule', 'cap', 'ml', 'millilitre', 'milliliter', 'mg', 'sachet', 'dose', 'vial', 'ampoule']);
const CONTAINER_UNITS = new Set(['bottle', 'box', 'pack', 'packet', 'tub', 'bag', 'carton', 'tube', 'jar']);
const SERVICE_WORDS = /\b(consult|consultation|exam|examination|surgery|procedure|appointment|check[- ]?up|fee|admission|anaesthe|operation|scan|x[- ]?ray)\b/i;

const markup = (p) => {
  const cost = Number(p.procurementCost ?? 0), price = Number(p.price ?? 0);
  return cost > 0 ? ((price - cost) / cost) * 100 : null;
};
const stocks = (p) => (p.productsStocks ?? []).filter((s) => s.isArchived !== true);
const totalStock = (p) => stocks(p).reduce((t, s) => t + Number(s.quantity ?? 0), 0);
const live = (p) => p.isArchived === false;

export default {
  key: 'products',
  label: 'Products',
  linkType: 'product',

  tally(ctx, rows) {
    const withFee = rows.filter((p) => Number(p.dispensingFee ?? 0) > 0);
    return [
      { label: 'Total products', value: rows.length },
      { label: 'Active', value: rows.filter(live).length },
      { label: 'Archived', value: rows.filter((p) => p.isArchived === true).length },
      { label: 'Sellable', value: rows.filter((p) => p.isSellable === true).length },
      { label: 'Stock controlled', value: rows.filter((p) => p.isStockControlEnabled === true).length },
      { label: 'Stock control OFF', value: rows.filter((p) => p.isStockControlEnabled === false).length },
      { label: 'Prescription only', value: rows.filter((p) => p.requiresPrescription === true).length },
      { label: 'By category', breakdown: breakdown(rows, (p) => p.category) },
      { label: 'By VAT rate', breakdown: breakdown(rows, (p) => String(p.vatPercentage ?? '(unset)')) },
      { label: 'With a dispensing fee, by category', breakdown: breakdown(withFee, (p) => p.category) },
      { label: 'With a subunit', value: rows.filter((p) => p.hasSubunit === true).length },
      { label: 'Missing unit', value: rows.filter((p) => isBlank(p.unit)).length },
      { label: 'Missing measure unit', value: rows.filter((p) => isBlank(p.measureUnit)).length },
      { label: 'With batch tracking', value: rows.filter((p) => stocks(p).some((s) => !isBlank(s.batchId))).length },
      { label: 'With negative stock', value: rows.filter((p) => stocks(p).some((s) => Number(s.quantity ?? 0) < 0)).length },
      { label: 'Stock controlled but zero total stock', value: rows.filter((p) => p.isStockControlEnabled === true && totalStock(p) === 0).length },
      { label: 'Has supplier but no item code', value: rows.filter((p) => !isBlank(p.supplierProductId) && isBlank(p.itemCode)).length },
      { label: 'Has item code but no supplier', value: rows.filter((p) => !isBlank(p.itemCode) && isBlank(p.supplierProductId)).length },
    ];
  },

  rules: [
    {
      id: 'products.price.belowCost', severity: 'critical',
      title: 'Selling below cost',
      clientFacing: 'Product sells for less than it costs to buy.',
      run: (ctx, rows) => rows.filter((p) => Number(p.price ?? 0) < Number(p.procurementCost ?? 0) && Number(p.procurementCost ?? 0) > 0).map((p) => ({
        record: p, display: p.name,
        fields: { itemCode: p.itemCode, category: p.category, price: money(p.price, ctx.currency), cost: money(p.procurementCost, ctx.currency), markup: `${markup(p)?.toFixed(0)}%` },
      })),
    },
    {
      id: 'products.price.zeroMarkup', severity: 'review',
      title: 'Sold at exactly cost price',
      run: (ctx, rows) => rows.filter((p) => Number(p.price ?? 0) > 0 && Number(p.price) === Number(p.procurementCost ?? -1)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category, price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'products.price.freeButSellable', severity: 'review',
      title: 'Sellable product priced at zero',
      run: (ctx, rows) => rows.filter((p) => Number(p.price ?? 0) === 0 && p.isSellable === true && live(p)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category },
      })),
    },
    {
      id: 'products.price.negative', severity: 'critical',
      title: 'Negative price',
      run: (ctx, rows) => rows.filter((p) => Number(p.price ?? 0) < 0).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'products.cost.unknown', severity: 'info',
      title: 'No procurement cost recorded',
      why: 'Margin reporting will be wrong for these until a cost is entered.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((p) => Number(p.procurementCost ?? 0) === 0 && live(p)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category, price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'products.price.hugeMarkup', severity: 'review',
      title: 'Markup over 500%',
      run: (ctx, rows) => rows.filter((p) => (markup(p) ?? 0) > 500).map((p) => ({
        record: p, display: p.name,
        fields: { itemCode: p.itemCode, category: p.category, price: money(p.price, ctx.currency), cost: money(p.procurementCost, ctx.currency), markup: `${markup(p).toFixed(0)}%` },
      })),
    },
    {
      id: 'products.vat.unexpected', severity: 'review',
      title: 'VAT rate outside the expected set',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.vatPercentage) && !ctx.vatRates.includes(Number(p.vatPercentage))).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, vatPercentage: p.vatPercentage },
      })),
    },
    {
      id: 'products.vat.minority', severity: 'review',
      title: 'VAT rate differs from the majority in its category',
      why: 'A handful of items on a different rate from everything around them is usually an import artefact, not a decision.',
      run: (ctx, rows) => {
        const byCategory = new Map();
        for (const p of rows) {
          if (isBlank(p.vatPercentage)) continue;
          if (!byCategory.has(p.category)) byCategory.set(p.category, new Map());
          const m = byCategory.get(p.category);
          m.set(Number(p.vatPercentage), (m.get(Number(p.vatPercentage)) ?? 0) + 1);
        }
        const majority = new Map();
        for (const [cat, m] of byCategory) {
          const [rate, count] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
          const total = [...m.values()].reduce((a, b) => a + b, 0);
          // Only call a majority when it actually dominates.
          if (count / total >= 0.8) majority.set(cat, rate);
        }
        return rows.filter((p) => majority.has(p.category) && !isBlank(p.vatPercentage) && Number(p.vatPercentage) !== majority.get(p.category))
          .map((p) => ({
            record: p, display: p.name,
            fields: { itemCode: p.itemCode, category: p.category, vatPercentage: p.vatPercentage, majority: `${majority.get(p.category)}%` },
          }));
      },
    },
    {
      id: 'products.name.soundsLikeService', severity: 'critical',
      title: 'Product name describes a service',
      clientFacing: 'This is in the product list but reads like a service.',
      why: 'Miscategorised at import. Invisible until someone bills it and the stock count moves.',
      run: (ctx, rows) => rows.filter((p) => live(p) && SERVICE_WORDS.test(p.name ?? '')).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category, price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'products.unit.missing', severity: 'critical',
      title: 'Sellable product with no unit',
      run: (ctx, rows) => rows.filter((p) => isBlank(p.unit) && p.isSellable === true).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category },
      })),
    },
    {
      id: 'products.measureUnit.missing', severity: 'review',
      title: 'No measure unit',
      why: 'Not settable through the API — a PUT mirrors `unit` onto it. Fixing this is a UI job for the practice.',
      truncate: 25,
      run: (ctx, rows) => rows.filter((p) => isBlank(p.measureUnit) && live(p)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, unit: p.unit },
      })),
    },
    {
      id: 'products.subunit.incomplete', severity: 'critical',
      title: 'Has a subunit but the subunit is not fully configured',
      why: 'Dispensing by subunit will price wrongly or fail outright.',
      run: (ctx, rows) => rows.filter((p) => p.hasSubunit === true && (isBlank(p.subunit) || isBlank(p.subunitMultiplier) || Number(p.subunitMultiplier) <= 0)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, subunit: p.subunit, subunitMultiplier: p.subunitMultiplier },
      })),
    },
    {
      id: 'products.subunit.orphanFields', severity: 'review',
      title: 'Subunit fields set but subunits are switched off',
      run: (ctx, rows) => rows.filter((p) => p.hasSubunit !== true && (!isBlank(p.subunit) || !isBlank(p.subunitMultiplier))).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, subunit: p.subunit, subunitMultiplier: p.subunitMultiplier },
      })),
    },
    {
      id: 'products.sellableUnits.contradiction', severity: 'critical',
      title: 'Sellable-units setting requires a subunit that does not exist',
      run: (ctx, rows) => rows.filter((p) => p.hasSubunit !== true && ['only_subunit_sellable', 'both_units_sellable'].includes(lower(p.sellableUnits))).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, sellableUnits: p.sellableUnits },
      })),
    },
    {
      id: 'products.unit.inverted', severity: 'critical',
      title: 'Unit is smaller than its subunit',
      clientFacing: 'The pack unit and the dispensing unit look the wrong way round.',
      why: 'Every dispense off this product prices by the wrong multiple.',
      run: (ctx, rows) => rows.filter((p) =>
        p.hasSubunit === true && DOSE_UNITS.has(lower(p.unit)) && CONTAINER_UNITS.has(lower(p.subunit)),
      ).map((p) => ({ record: p, display: p.name, fields: { itemCode: p.itemCode, unit: p.unit, subunit: p.subunit } })),
    },
    {
      id: 'products.unit.doseWithoutSubunit', severity: 'critical',
      title: 'Sold by a dose unit with no subunit configured',
      clientFacing: 'Priced per pack but sold as if it were a single tablet or millilitre.',
      why: 'The classic per-pack price applied to a single tablet. Check the price before changing the unit.',
      run: (ctx, rows) => rows.filter((p) => p.hasSubunit !== true && p.isSellable === true && live(p) && DOSE_UNITS.has(lower(p.unit))).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, unit: p.unit, price: money(p.price, ctx.currency) },
      })),
    },
    {
      id: 'products.fee.negative', severity: 'critical',
      title: 'Negative dispensing fee',
      run: (ctx, rows) => rows.filter((p) => Number(p.dispensingFee ?? 0) < 0).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, dispensingFee: money(p.dispensingFee, ctx.currency) },
      })),
    },
    {
      id: 'products.fee.injectableNoFee', severity: 'review',
      title: 'Sellable injectable with no dispensing fee',
      run: (ctx, rows) => rows.filter((p) => lower(p.category) === 'injectables' && Number(p.dispensingFee ?? 0) === 0 && p.isSellable === true).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode },
      })),
    },
    {
      id: 'products.fee.medicationNoFee', severity: 'review',
      title: 'Sellable over-the-counter medication with no dispensing fee',
      run: (ctx, rows) => rows.filter((p) => lower(p.category) === 'general_medication' && p.requiresPrescription === false && Number(p.dispensingFee ?? 0) === 0 && p.isSellable === true).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode },
      })),
    },
    {
      id: 'products.stock.negative', severity: 'critical',
      title: 'Negative stock at a location',
      run: (ctx, rows) => rows.flatMap((p) => stocks(p).filter((s) => Number(s.quantity ?? 0) < 0).map((s) => ({
        record: p, display: p.name,
        fields: { itemCode: p.itemCode, location: ctx.storeNames.get(s.stockLocationId) ?? s.stockLocationId, quantity: s.quantity },
      }))),
    },
    {
      id: 'products.stock.noRecords', severity: 'review',
      title: 'Stock controlled but no stock record at any location',
      run: (ctx, rows) => rows.filter((p) => p.isStockControlEnabled === true && !stocks(p).length).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category },
      })),
    },
    {
      id: 'products.stock.implausible', severity: 'review',
      title: 'Total stock over 1,000 units',
      why: 'Usually a pack quantity entered as if it were subunits.',
      run: (ctx, rows) => rows.filter((p) => totalStock(p) > 1000).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, total: totalStock(p), unit: p.unit },
      })),
    },
    {
      id: 'products.stock.minAboveOptimal', severity: 'review',
      title: 'Minimum stock level is above the optimal level',
      why: 'Some practices deliberately set min == opt; only min > opt is contradictory.',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.minimumStockLevel) && !isBlank(p.optimalStockLevel) && Number(p.minimumStockLevel) > Number(p.optimalStockLevel)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, min: p.minimumStockLevel, optimal: p.optimalStockLevel },
      })),
    },
    {
      id: 'products.supplier.noItemCode', severity: 'review',
      title: 'Has a supplier but no item code',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.supplierProductId) && isBlank(p.itemCode) && live(p)).map((p) => ({
        record: p, display: p.name, fields: { category: p.category, supplierProductId: p.supplierProductId },
      })),
    },
    {
      id: 'products.supplier.noSupplier', severity: 'info',
      title: 'Has an item code but no supplier',
      truncate: 25,
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.itemCode) && isBlank(p.supplierProductId) && live(p)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category },
      })),
    },
    {
      id: 'products.ref.store', severity: 'critical',
      title: 'Product at a store that is not on this company',
      needs: 'stores',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.storeId) && !ctx.storeIds.has(p.storeId)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, storeId: p.storeId },
      })),
    },
    {
      id: 'products.ref.referenceList', severity: 'critical',
      title: 'Reference list does not resolve',
      needs: 'referenceLists',
      run: (ctx, rows) => rows.filter((p) => !isBlank(p.referenceListId) && !ctx.referenceListIds.has(p.referenceListId)).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, referenceListId: p.referenceListId },
      })),
    },
    {
      id: 'products.duplicate.barcode', severity: 'critical',
      title: 'Two products share a barcode',
      group: true,
      run: (ctx, rows) => collisions(rows, (p) => (isBlank(p.barcode) ? null : String(p.barcode).trim()))
        .flatMap(([key, group]) => group.map((p) => ({ record: p, display: p.name, groupKey: key, fields: { barcode: p.barcode, category: p.category } }))),
    },
    {
      id: 'products.duplicate.itemCode', severity: 'critical',
      title: 'Two products share an item code',
      group: true,
      run: (ctx, rows) => collisions(rows, (p) => (isBlank(p.itemCode) ? null : String(p.itemCode).trim()))
        .flatMap(([key, group]) => group.map((p) => ({ record: p, display: p.name, groupKey: key, fields: { itemCode: p.itemCode, category: p.category } }))),
    },
    {
      id: 'products.duplicate.name', severity: 'review',
      title: 'Two active products share a name at the same store',
      group: true,
      run: (ctx, rows) => collisions(rows.filter(live), (p) => `${p.storeId ?? ''}|${lower(p.name)}`)
        .flatMap(([key, group]) => group.map((p) => ({ record: p, display: p.name, groupKey: key, fields: { itemCode: p.itemCode, category: p.category } }))),
    },
    {
      id: 'products.state.sellableArchived', severity: 'critical',
      title: 'Marked sellable and archived at once',
      run: (ctx, rows) => rows.filter((p) => p.isSellable === true && p.isArchived === true).map((p) => ({
        record: p, display: p.name, fields: { itemCode: p.itemCode, category: p.category },
      })),
    },
  ],
};
