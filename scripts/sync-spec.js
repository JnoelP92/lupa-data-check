#!/usr/bin/env node
// Reduce Lupa's OpenAPI spec to the one thing the rules care about: which fields each
// collection actually returns.
//
//   node scripts/sync-spec.js --file ~/Downloads/lupa-api.json
//   node scripts/sync-spec.js                      # fetch the live spec
//
// Writes spec-fields.json. The full spec is 1.3MB of mostly request bodies; this keeps
// the ~5KB that scripts/check-fields.js needs, so the check runs offline and the
// snapshot is reviewable in a diff.
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_URL = process.env.LUPA_SPEC_URL ?? 'https://api.lupapets.com/api/external/openapi.json';

// Every list endpoint a rule module reads, plus the arrays nested inside each record.
export const RESOURCES = {
  clients: { path: '/v1/clients', arrays: ['contacts', 'pets'] },
  pets: { path: '/v1/pets', arrays: ['clientsPets', 'weights'] },
  appointments: { path: '/v1/appointments', arrays: ['employees'] },
  products: { path: '/v1/products', arrays: ['productsStocks'] },
  services: { path: '/v1/services', arrays: [] },
  bundles: { path: '/v1/bundles', arrays: [] },
  healthPlans: { path: '/v1/health-plans', arrays: ['allowances'] },
  healthPlanSubscriptions: { path: '/v1/health-plans/subscriptions', arrays: ['usages'] },
  reminders: { path: '/v1/reminders', arrays: [] },
  medicalRecords: { path: '/v1/medical-records', arrays: [] },
  clinicalNotes: { path: '/v1/clinical-notes', arrays: [] },
  prescriptions: { path: '/v1/prescriptions', arrays: ['prescriptionDispenses'] },
  invoices: { path: '/v1/financials/invoices', arrays: ['billingProducts', 'billingServices', 'billingBundles'] },
  payments: { path: '/v1/financials/payments', arrays: [] },
  creditNotes: { path: '/v1/financials/credit-notes', arrays: ['items'] },
  refunds: { path: '/v1/financials/refunds', arrays: [] },
  estimates: { path: '/v1/financials/estimates', arrays: ['billingProducts', 'billingServices'] },
  employees: { path: '/v1/employees', arrays: ['stores', 'visitTypes'] },
  insurancePolicies: { path: '/v1/insurance-policies', arrays: [] },
  stores: { path: '/v1/companies/stores', arrays: [] },
  paymentTerms: { path: '/v1/payment-terms', arrays: [] },
  referenceLists: { path: '/v1/reference-lists', arrays: [] },
  appointmentTypes: { path: '/v1/appointment-types', arrays: [] },
};

function makeDeref(spec) {
  return function deref(node, seen = new Set()) {
    if (node && typeof node === 'object' && node.$ref) {
      if (seen.has(node.$ref)) return {};
      let cur = spec;
      for (const part of node.$ref.replace(/^#\//, '').split('/')) cur = cur?.[part] ?? {};
      return deref(cur, new Set([...seen, node.$ref]));
    }
    return node ?? {};
  };
}

// Walk a response schema down to the object describing ONE record. A list endpoint
// wraps records in {data: [...], hasMore, nextCursor}; the envelope check matters
// because credit notes have their own `items` array that must not be mistaken for one.
function itemSchema(schema, deref, depth = 0) {
  const s = deref(schema);
  if (!s || typeof s !== 'object' || depth > 8) return null;
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(s[key])) {
      const merged = {};
      for (const sub of s[key]) Object.assign(merged, itemSchema(sub, deref, depth + 1) ?? {});
      if (Object.keys(merged).length) return merged;
    }
  }
  if (s.type === 'array') return itemSchema(s.items ?? {}, deref, depth + 1);
  const props = s.properties;
  if (!props) return null;
  const isEnvelope = ['hasMore', 'nextCursor', 'total', 'totalCount'].some((k) => k in props);
  if (isEnvelope) {
    for (const key of ['data', 'items', 'results']) {
      if (key in props) {
        const sub = itemSchema(props[key], deref, depth + 1);
        if (sub) return sub;
      }
    }
  }
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, deref(v)]));
}

function recordSchema(spec, path, deref) {
  const op = spec.paths?.[path]?.get;
  if (!op) return null;
  for (const code of ['200', '201', '2XX', 'default']) {
    const res = deref(op.responses?.[code] ?? null);
    for (const media of Object.values(res?.content ?? {})) {
      const s = itemSchema(media.schema ?? {}, deref);
      if (s) return s;
    }
  }
  return null;
}

export function extract(spec) {
  const deref = makeDeref(spec);
  const out = {};
  const missing = [];
  for (const [key, { path, arrays }] of Object.entries(RESOURCES)) {
    const schema = recordSchema(spec, path, deref);
    if (!schema) { missing.push(`${key} (${path})`); continue; }
    const entry = { path, fields: Object.keys(schema).sort(), nested: {}, enums: {} };
    for (const [f, def] of Object.entries(schema)) {
      if (Array.isArray(def?.enum)) entry.enums[f] = def.enum;
    }
    for (const arr of arrays) {
      let def = deref(schema[arr] ?? {});
      if (def.type === 'array') def = deref(def.items ?? {});
      const props = def.properties;
      if (props) entry.nested[arr] = Object.keys(props).sort();
    }
    out[key] = entry;
  }
  return { out, missing };
}

async function loadSpec() {
  const i = process.argv.indexOf('--file');
  if (i !== -1 && process.argv[i + 1]) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`GET ${SPEC_URL} failed: HTTP ${res.status}`);
  return res.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const spec = await loadSpec();
  const { out, missing } = extract(spec);
  const snapshot = {
    fetchedAt: new Date().toISOString().slice(0, 10),
    title: spec.info?.title ?? null,
    version: spec.info?.version ?? null,
    resources: out,
  };
  writeFileSync(join(ROOT, 'spec-fields.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote spec-fields.json — ${Object.keys(out).length} resources, spec version ${snapshot.version}`);
  if (missing.length) {
    console.error(`\nNo response schema found for:\n  ${missing.join('\n  ')}`);
    process.exit(2);
  }
}
