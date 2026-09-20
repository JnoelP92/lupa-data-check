// Builds a synthetic pull on disk so the ruleset can be developed and tested without
// an API key, a network, or a real practice's data. Every client below exists to trip
// exactly one rule, which is what makes a failure here point at a line rather than a
// vibe.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STORE_A = '11111111-1111-1111-1111-111111111111';
const STORE_B = '22222222-2222-2222-2222-222222222222';
const TERMS = '33333333-3333-3333-3333-333333333333';

const client = (n, over = {}) => ({
  id: `c${String(n).padStart(4, '0')}`,
  numericId: 1000 + n,
  firstName: 'Test',
  lastName: `Client${n}`,
  email: `client${n}@example.com`,
  phone: `0771234${String(n).padStart(4, '0')}`,
  dob: '1985-04-12',
  address: { line_1: '1 High Street' },
  primaryStoreId: STORE_A,
  paymentTermsId: TERMS,
  balance: 0,
  isArchived: false,
  billingHold: false,
  gdprOptIn: true,
  platformCommsOptIn: true,
  contacts: [],
  ...over,
});

export const CLIENTS = [
  client(1),                                                            // clean
  client(2, { email: null }),                                           // email.missing
  client(3, { phone: null }),                                           // phone.missing
  client(4, { email: 'not-an-email@' }),                                // email.malformed
  client(5, { phone: '0000000000' }),                                   // phone.implausible
  client(6, { dob: '2099-01-01' }),                                     // dob.implausible
  client(7, { address: { line_1: null } }),                             // address.missing
  client(8, { email: 'shared@example.com' }),                           // duplicate.email
  client(9, { email: 'SHARED@example.com  ' }),                         //   "  (case + whitespace)
  client(10, { phone: '07999 111222' }),                                // duplicate.phone
  client(11, { phone: '07999111222' }),                                 //   "  (formatting)
  client(12, { firstName: 'Ann', lastName: 'Shaw', dob: '1970-02-02' }),// duplicate.nameDob
  client(13, { firstName: 'ann', lastName: 'SHAW', dob: '1970-02-02' }),//   "
  client(14, { balance: 12500 }),                                       // balance.nonZero (debt)
  client(15, { balance: -4000 }),                                       //   "             (credit)
  client(16, { primaryStoreId: 'deadbeef-0000-0000-0000-000000000000' }),// ref.primaryStore
  client(17, { paymentTermsId: 'deadbeef-1111-1111-1111-111111111111' }),// ref.paymentTerms
  client(18, { contacts: [{ firstName: 'No', lastName: 'Route', email: null, phone: null, relationshipType: 'spouse' }] }),
  client(19, { isArchived: true, email: null, phone: null }),           // archived: must NOT flag
  client(20, { primaryStoreId: STORE_B }),                              // store breakdown
];

export function makePull({ clients = CLIENTS, unavailable = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lupa-check-'));
  mkdirSync(join(dir, '.checkpoint'), { recursive: true });

  writeFileSync(join(dir, 'stores.json'), JSON.stringify([
    { id: STORE_A, name: 'Main Surgery' },
    { id: STORE_B, name: 'Branch Clinic' },
  ]));
  writeFileSync(join(dir, 'paymentTerms.json'), JSON.stringify([{ id: TERMS, name: '30 days' }]));
  writeFileSync(join(dir, 'employees.json'), JSON.stringify([]));
  writeFileSync(join(dir, 'clients.jsonl'), clients.map((c) => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(join(dir, '.checkpoint', 'clients.json'), JSON.stringify({ cursor: null, lines: clients.length, done: true }));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    rulesetVersion: '1.0.0',
    startedAt: '2026-09-20T09:00:00.000Z',
    finishedAt: '2026-09-20T09:04:00.000Z',
    environment: 'migrations',
    company: { id: 'co-1', name: 'Fixture Veterinary Group' },
    stores: [{ id: STORE_A, name: 'Main Surgery' }, { id: STORE_B, name: 'Branch Clinic' }],
    counts: { clients: clients.length },
    requestCount: 7,
    unavailable,
  }));
  return dir;
}

export { STORE_A, STORE_B, TERMS };
