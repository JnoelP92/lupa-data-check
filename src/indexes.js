// Identity indexes, built by streaming each collection once.
//
// This exists because of one constraint in the spec: referential rules ("petId returns
// 404") must never be per-record GETs. Across every appointment and invoice line that
// would be hundreds of thousands of requests against a 100/min limit — days, not
// minutes, and a different answer every run. Instead each collection is streamed once
// into the sets below, and a referential rule becomes a Set.has().
//
// Only identity and the few fields cross-record rules need are retained. Full records
// are loaded one collection at a time by the engine and released after that module
// runs, so a practice with 400k invoice lines does not have to fit in memory at once.
import { isBlank } from './util.js';

export function buildIndexes(store, { log = () => {} } = {}) {
  const ix = {
    clientIds: new Set(),
    petIds: new Set(),
    productIds: new Set(),
    serviceIds: new Set(),
    bundleIds: new Set(),
    employeeIds: new Set(),
    appointmentIds: new Set(),
    invoiceIds: new Set(),
    paymentIds: new Set(),
    healthPlanIds: new Set(),

    // Cross-record detail, kept deliberately small.
    petOwners: new Map(),        // petId -> [clientId]
    petIsDeceased: new Set(),
    petIsArchived: new Set(),
    clientIsArchived: new Set(),
    clientBalance: new Map(),    // clientId -> minor units
    clientName: new Map(),       // clientId -> display name + numericId
    petName: new Map(),
    productPrice: new Map(),
    servicePrice: new Map(),
    bundlePrice: new Map(),
    planPrice: new Map(),
    paymentAmount: new Map(),    // paymentId -> minor units
    invoiceClient: new Map(),    // invoiceId -> clientId
    invoiceLineKeys: new Set(),  // `${invoiceId}|${billingProductId}` and billingServiceId
    appointmentsByPet: new Map(),// petId -> count
    invoicedPets: new Set(),
    insuredPetIds: new Set(),
    appointmentInvoice: new Map(),// appointmentId -> storeInvoiceId
    appointmentPet: new Map(), // appointmentId -> petId
  };

  for (const c of store.read('clients')) {
    ix.clientIds.add(c.id);
    if (c.isArchived === true) ix.clientIsArchived.add(c.id);
    ix.clientBalance.set(c.id, Number(c.balance ?? 0));
    ix.clientName.set(c.id, { name: [c.firstName, c.lastName].filter(Boolean).join(' ').trim(), numericId: c.numericId });
  }
  for (const p of store.read('pets')) {
    ix.petIds.add(p.id);
    if (p.deceased === true) ix.petIsDeceased.add(p.id);
    const owners = (p.clientsPets ?? []).map((cp) => cp.clientId).filter(Boolean);
    ix.petOwners.set(p.id, owners);
    // Pets have no isArchived of their own — archival is per owner link.
    if ((p.clientsPets ?? []).length && (p.clientsPets ?? []).every((cp) => cp.isArchived === true)) ix.petIsArchived.add(p.id);
    ix.petName.set(p.id, p.name ?? '(unnamed)');
  }
  for (const p of store.read('products')) { ix.productIds.add(p.id); ix.productPrice.set(p.id, Number(p.price ?? 0)); }
  for (const s of store.read('services')) { ix.serviceIds.add(s.id); ix.servicePrice.set(s.id, Number(s.price ?? 0)); }
  for (const b of store.read('bundles')) { ix.bundleIds.add(b.id); ix.bundlePrice.set(b.id, Number(b.price ?? 0)); }
  for (const e of store.read('employees')) ix.employeeIds.add(e.id);
  for (const h of store.read('healthPlans')) { ix.healthPlanIds.add(h.id); ix.planPrice.set(h.id, Number(h.price ?? 0)); }

  for (const a of store.read('appointments')) {
    ix.appointmentIds.add(a.id);
    if (a.petId) ix.appointmentsByPet.set(a.petId, (ix.appointmentsByPet.get(a.petId) ?? 0) + 1);
    // The invoice does not point at the appointment; the appointment points at the
    // invoice. Everything downstream reads this map rather than inventing the reverse.
    if (a.storeInvoiceId) ix.appointmentInvoice.set(a.id, a.storeInvoiceId);
    if (a.petId) ix.appointmentPet.set(a.id, a.petId);
  }
  for (const i of store.read('invoices')) {
    ix.invoiceIds.add(i.id);
    if (i.clientId) ix.invoiceClient.set(i.id, i.clientId);
    if (i.petId) ix.invoicedPets.add(i.petId);
    for (const l of i.billingProducts ?? []) if (!isBlank(l.id)) ix.invoiceLineKeys.add(`${i.id}|${l.id}`);
    for (const l of i.billingServices ?? []) if (!isBlank(l.id)) ix.invoiceLineKeys.add(`${i.id}|${l.id}`);
  }
  for (const p of store.read('payments')) { ix.paymentIds.add(p.id); ix.paymentAmount.set(p.id, Number(p.amount ?? 0)); }
  for (const p of store.read('insurancePolicies')) { if (p.isArchived !== true && p.petId) ix.insuredPetIds.add(p.petId); }

  // Employees also come from the reference pull; union the two so a company whose
  // employees endpoint paginates differently still resolves.
  for (const e of store.readJson('employees', []) ?? []) ix.employeeIds.add(e.id);

  log(`  indexes: ${ix.clientIds.size} clients, ${ix.petIds.size} pets, ${ix.productIds.size} products, ${ix.invoiceIds.size} invoices`);
  return ix;
}
