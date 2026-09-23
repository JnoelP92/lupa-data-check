// Which scale are the money fields actually on?
//
// The spec documents minor units. The migrations environment returns decimals —
// amountDue 1379.46, unitPrice 2.055625, a Caesarian section line at 1193.89. Read as
// minor units that is a £11.94 caesarian, and every total in the report comes out 100x
// too small.
//
// Rather than pick a side, look at the data: a value with a fractional part cannot be
// an integer count of pennies. One clear counter-example is enough, because minor units
// admit none.
const FIELDS = {
  invoices: ['amountDue', 'amountPaid'],
  payments: ['amount'],
  products: ['price', 'procurementCost'],
  services: ['price'],
};

export function detectMoneyScale(store, { sampleSize = 500 } = {}) {
  const evidence = [];
  for (const [collection, fields] of Object.entries(FIELDS)) {
    for (const row of store.sample(collection, sampleSize)) {
      for (const field of fields) {
        const v = row?.[field];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        if (!Number.isInteger(v)) evidence.push(`${collection}.${field} = ${v}`);
      }
    }
    // Also check invoice line prices, where fractional unit prices show up first.
    if (collection === 'invoices') {
      for (const row of store.sample('invoices', sampleSize)) {
        for (const line of [...(row.billingProducts ?? []), ...(row.billingServices ?? [])]) {
          for (const field of ['price', 'unitPrice']) {
            const v = line?.[field];
            if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) {
              evidence.push(`invoice line ${field} = ${v}`);
            }
          }
        }
      }
    }
  }

  if (evidence.length) {
    return {
      units: 'major', divisor: 1, tolerance: 0.01,
      reason: `found ${evidence.length} non-integer money values, e.g. ${evidence.slice(0, 3).join(', ')}`,
    };
  }
  return {
    units: 'minor', divisor: 100, tolerance: 1,
    reason: 'every sampled money value is a whole number, consistent with minor units',
  };
}
