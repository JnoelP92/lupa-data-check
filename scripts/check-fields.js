#!/usr/bin/env node
// Does every field a rule reads actually exist on the API?
//
//   node scripts/check-fields.js      # exit 2 if a rule reads a field that is not there
//
// This exists because of a specific failure mode: a rule that reads a field the API
// does not return matches nothing, reports nothing, and is indistinguishable from a
// rule that ran and found the data clean. It is the one bug in this tool that makes the
// output actively misleading rather than merely wrong, so it gets its own check.
//
// Run it after any rule change, and after `sync-spec.js` reports the API has moved.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(ROOT, 'spec-fields.json'), 'utf8'));

// Rule module -> the resource whose records it iterates.
const MODULE_RESOURCE = {
  'clients.js': 'clients', 'pets.js': 'pets', 'appointments.js': 'appointments',
  'products.js': 'products', 'services.js': 'services', 'bundles.js': 'bundles',
  'health-plans.js': 'healthPlans', 'subscriptions.js': 'healthPlanSubscriptions',
  'reminders.js': 'reminders', 'medical-records.js': 'medicalRecords',
  'clinical-notes.js': 'clinicalNotes', 'prescriptions.js': 'prescriptions',
  'invoices.js': 'invoices', 'payments.js': 'payments', 'credit-notes.js': 'creditNotes',
  'refunds.js': 'refunds', 'estimates.js': 'estimates', 'employees.js': 'employees',
  'insurance-policies.js': 'insurancePolicies',
};

// Property names that belong to JavaScript, not to a Lupa record.
const JS = new Set(`length map filter reduce some every slice sort flatMap find findIndex
includes push concat join toFixed replace replaceAll trim toLowerCase toUpperCase split
test match has get set add delete size entries values keys getTime getUTCFullYear
toISOString padStart padEnd startsWith endsWith indexOf charAt repeat flat reverse
toString valueOf then catch`.split(/\s+/));

// Things on ctx, not on a record.
const CTX = new Set(`now currency vatRates unavailable counts storeIds storeNames
paymentTermIds appointmentTypeIds referenceListIds stockLocationIds insuredPetIds enums
store ix load release rows meta clientIds petIds productIds serviceIds bundleIds
employeeIds appointmentIds invoiceIds paymentIds healthPlanIds petOwners petIsDeceased
petIsArchived clientIsArchived clientBalance clientName petName productPrice servicePrice
bundlePrice planPrice paymentAmount invoiceClient invoiceLineKeys appointmentsByPet
invoicedPets appointmentInvoice storeVat`.split(/\s+/));

// Locals a rule builds for itself, and fields on a finding row rather than a record.
const LOCAL = new Set(`record display fields reason groupKey link id severity title
clientFacing why internalOnly total truncatedTo grouped rows key label count extra
url search note expected balance delta clientId invoiced paid credited item`.split(/\s+/));

let problems = 0;
const files = readdirSync(join(ROOT, 'src', 'rules')).filter((f) => f.endsWith('.js') && f !== 'index.js');

for (const file of files.sort()) {
  const resourceKey = MODULE_RESOURCE[file];
  if (!resourceKey) continue; // cross-record.js reads several; it is covered by the others
  const resource = snapshot.resources[resourceKey];
  if (!resource) {
    console.error(`${file}: no snapshot for resource "${resourceKey}" — run sync-spec.js`);
    problems++;
    continue;
  }

  const allowed = new Set([...resource.fields, ...Object.values(resource.nested).flat()]);
  const src = readFileSync(join(ROOT, 'src', 'rules', file), 'utf8');

  // Property reads off a short variable: the record, or an element of one of its arrays.
  const used = new Set();
  for (const m of src.matchAll(/\b(?:[a-z]|it|cp|st|inst|sub)\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);

  const missing = [...used].filter((f) => !allowed.has(f) && !JS.has(f) && !CTX.has(f) && !LOCAL.has(f)).sort();
  if (missing.length) {
    console.error(`\n${file}  (${resource.path})`);
    for (const f of missing) console.error(`   reads .${f} — not on this resource`);
    problems += missing.length;
  }
}

if (problems) {
  console.error(`\n${problems} field reference${problems === 1 ? '' : 's'} not backed by the spec snapshot (${snapshot.fetchedAt}).`);
  console.error('A rule reading a field the API does not return reports nothing and looks like a clean pass.');
  process.exit(2);
}
console.log(`All rule fields exist on the API (spec snapshot ${snapshot.fetchedAt}).`);
