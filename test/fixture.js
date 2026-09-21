// A synthetic practice on disk, so the whole pipeline can be exercised without an API
// key, a network, or anyone's real data.
//
// Every record below exists to trip a specific rule. That is what makes a test failure
// point at a line of rule code rather than at a feeling. Records named `*Clean` are the
// control: they must never appear in a finding.
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STORE_A = '11111111-1111-1111-1111-111111111111';
export const STORE_B = '22222222-2222-2222-2222-222222222222';
export const TERMS = '33333333-3333-3333-3333-333333333333';
export const GHOST_STORE = 'deadbeef-0000-0000-0000-000000000000';
export const VISIT_TYPE = '44444444-4444-4444-4444-444444444444';
export const REF_LIST = '55555555-5555-5555-5555-555555555555';

const client = (n, over = {}) => ({
  id: `c${String(n).padStart(4, '0')}`, numericId: 1000 + n,
  firstName: 'Test', lastName: `Client${n}`,
  email: `client${n}@example.com`, phone: `0771234${String(n).padStart(4, '0')}`,
  dob: '1985-04-12', address: { line_1: '1 High Street' },
  primaryStoreId: STORE_A, paymentTermsId: TERMS, balance: 0,
  isArchived: false, billingHold: false, gdprOptIn: true, platformCommsOptIn: true,
  contacts: [], ...over,
});

export const CLIENTS = [
  client(1),
  client(2, { email: null }),
  client(3, { phone: null }),
  client(4, { email: 'not-an-email@' }),
  client(5, { phone: '0000000000' }),
  client(6, { dob: '2099-01-01' }),
  client(7, { address: { line_1: null } }),
  client(8, { email: 'shared@example.com' }),
  client(9, { email: 'SHARED@example.com  ' }),
  client(10, { phone: '07999 111222' }),
  client(11, { phone: '07999111222' }),
  client(12, { firstName: 'Ann', lastName: 'Shaw', dob: '1970-02-02' }),
  client(13, { firstName: 'ann', lastName: 'SHAW', dob: '1970-02-02' }),
  client(14, { balance: 12500 }),
  client(15, { balance: -5000 }),
  client(16, { primaryStoreId: GHOST_STORE }),
  client(17, { paymentTermsId: 'deadbeef-1111-1111-1111-111111111111' }),
  client(18, { contacts: [{ firstName: 'No', lastName: 'Route', email: null, phone: null, relationshipType: 'spouse' }] }),
  client(19, { isArchived: true, email: null, phone: null }),
  client(20, { primaryStoreId: STORE_B }),
];

const pet = (id, over = {}) => ({
  id, name: `Pet${id}`, species: 'Dog', breed: 'Labrador', sex: 'male',
  dob: '2019-06-01', deceased: false, deceasedDate: null, neutered: false, neuteredDate: null,
  microchipped: true, microchip: `9001234567890${id.slice(-2)}`, isArchived: false,
  clientsPets: [{ clientId: 'c0001', isArchived: false }], weights: [{ kg: 22 }], ...over,
});

export const PETS = [
  pet('p01'),
  pet('p02', { species: null }),
  pet('p03', { dob: null }),
  pet('p04', { dob: '2099-01-01' }),
  pet('p05', { sex: null }),
  pet('p06', { microchipped: true, microchip: null }),
  pet('p07', { microchip: 'ABC123' }),
  pet('p08', { deceased: true, deceasedDate: null }),
  pet('p09', { deceased: false, deceasedDate: '2024-01-01' }),
  pet('p10', { neutered: true, neuteredDate: null }),
  pet('p11', { weights: [] }),
  pet('p12', { clientsPets: [] }),
  pet('p13', { clientsPets: [{ clientId: 'c0001', isArchived: true }] }),
  pet('p14', { clientsPets: [{ clientId: 'ghost-client', isArchived: false }] }),
  pet('p15', { microchip: '111122223333444' }),
  pet('p16', { microchip: '111122223333444' }),
  pet('p17', { name: 'Rex', dob: '2020-01-01', clientsPets: [{ clientId: 'c0002', isArchived: false }] }),
  pet('p18', { name: 'Rex', dob: '2020-01-01', clientsPets: [{ clientId: 'c0002', isArchived: false }] }),
  pet('p19', { deceased: true, deceasedDate: '2024-03-01' }),
];

export const EMPLOYEES = [
  { id: 'e01', firstName: 'Ada', lastName: 'Vet', email: 'ada@clinic.test', role: 'vet', rcvsRegistrationNumber: 'RCVS1', status: 'active', stores: [{ id: STORE_A, showInCalendar: true, isOnlineBookingPoc: true }], visitTypes: [VISIT_TYPE] },
  { id: 'e02', firstName: 'Bo', lastName: 'Nurse', email: null, role: 'nurse', status: 'active', stores: [{ id: STORE_A, showInCalendar: true }], visitTypes: [VISIT_TYPE] },
  { id: 'e03', firstName: 'Cy', lastName: 'Vet', email: 'cy@clinic.test', role: 'vet', rcvsRegistrationNumber: null, status: 'active', stores: [{ id: STORE_A, showInCalendar: true }], visitTypes: [VISIT_TYPE] },
  { id: 'e04', firstName: 'Di', lastName: 'Admin', email: 'di@clinic.test', role: 'admin', status: 'active', stores: [], visitTypes: [VISIT_TYPE] },
  { id: 'e05', firstName: 'Ed', lastName: 'Admin', email: 'ed@clinic.test', role: 'admin', status: 'active', stores: [{ id: STORE_A, showInCalendar: false }], visitTypes: [] },
  { id: 'e06', firstName: 'Ada', lastName: 'Vet', email: 'ada@clinic.test', role: 'vet', rcvsRegistrationNumber: 'RCVS2', status: 'active', stores: [{ id: GHOST_STORE, showInCalendar: true }], visitTypes: [VISIT_TYPE] },
];

// Each appointment gets its own day, so only the records that are meant to collide do.
const appt = (id, over = {}) => {
  const day = String(Number(id.slice(2))).padStart(2, '0');
  return {
    id, title: `Consult ${id}`, petId: 'p01', clientId: 'c0001', storeId: STORE_A,
    start: `2026-08-${day}T09:00:00Z`, end: `2026-08-${day}T09:30:00Z`, status: 'completed',
    visitTypeId: VISIT_TYPE, visitTypeName: 'Consult', visitTypeCategory: 'consult',
    employees: [{ id: 'e01', isMainEmployee: true }], checkedInAt: null, storeInvoiceId: null, ...over,
  };
};

export const APPOINTMENTS = [
  appt('ap01', { storeInvoiceId: 'in28' }),
  appt('ap02', { start: '2026-08-02T10:00:00Z', end: '2026-08-02T09:00:00Z' }),
  appt('ap03', { start: '2026-08-03T09:00:00Z', end: '2026-08-03T09:00:00Z' }),
  appt('ap04', { start: '2026-08-04T08:00:00Z', end: '2026-08-04T20:00:00Z' }),
  appt('ap05', { start: '2027-01-01T09:00:00Z', end: '2027-01-01T09:30:00Z' }),
  appt('ap06', { start: '2026-01-01T09:00:00Z', end: '2026-01-01T09:30:00Z', status: 'confirmed' }),
  appt('ap07', { start: '2026-09-19T09:00:00Z', end: '2026-09-19T09:30:00Z', status: 'requested', checkedInAt: '2026-09-19T08:55:00Z' }),
  appt('ap08', { storeId: null }),
  appt('ap09', { storeId: GHOST_STORE }),
  appt('ap10', { petId: 'ghost-pet' }),
  appt('ap11', { clientId: 'ghost-client' }),
  appt('ap12', { petId: 'p01', clientId: 'c0003' }),
  appt('ap13', { visitTypeId: null, visitTypeName: null }),
  appt('ap14', { visitTypeId: 'ghost-type' }),
  appt('ap15', { visitTypeName: null }),
  appt('ap16', { employees: [{ id: 'ghost-emp', isMainEmployee: true }] }),
  appt('ap17', { petId: 'p05', start: '2026-09-01T09:00:00Z', end: '2026-09-01T09:30:00Z' }),
  appt('ap18', { petId: 'p05', start: '2026-09-01T09:00:00Z', end: '2026-09-01T09:30:00Z' }),
  appt('ap19', { employees: [] }),
  appt('ap20', { start: '2026-08-25T09:00:00Z', end: '2026-08-25T09:30:00Z', checkedInAt: '2026-08-20T09:00:00Z' }),
];

const product = (id, over = {}) => ({
  id, name: `Product ${id}`, itemCode: `IC-${id}`, barcode: `BC-${id}`, category: 'nutrition',
  price: 2000, procurementCost: 1000, margin: 100, vatPercentage: 20, isSellable: true, isArchived: false,
  isStockControlEnabled: true, requiresPrescription: false, hasSubunit: false,
  subunit: null, subunitMultiplier: null, sellableUnits: 'only_unit_sellable',
  unit: 'bag', measureUnit: 'bag', dispensingFee: 0, storeId: STORE_A,
  supplierProductId: 'sup-1', referenceListId: REF_LIST,
  minimumStockLevel: 5, optimalStockLevel: 10,
  productsStocks: [{ stockLocationId: STORE_A, quantity: 8, isArchived: false, batchId: null }], ...over,
});

export const PRODUCTS = [
  product('pr01'),
  product('pr02', { price: 500, procurementCost: 1000, margin: -50 }),
  product('pr03', { price: 1000, procurementCost: 1000, margin: 0 }),
  product('pr04', { price: 0 }),
  product('pr05', { price: -100 }),
  product('pr06', { procurementCost: 0, margin: null }),
  product('pr07', { price: 100000, procurementCost: 1000, margin: 9900 }),
  product('pr08', { vatPercentage: 17.5 }),
  product('pr09', { name: 'Consultation Fee' }),
  product('pr10', { unit: null }),
  product('pr11', { measureUnit: null }),
  product('pr12', { hasSubunit: true, subunit: null, subunitMultiplier: null }),
  product('pr13', { hasSubunit: false, subunit: 'tablet', subunitMultiplier: 10 }),
  product('pr14', { hasSubunit: false, sellableUnits: 'both_units_sellable' }),
  product('pr15', { hasSubunit: true, unit: 'tablet', subunit: 'bottle', subunitMultiplier: 100 }),
  product('pr16', { hasSubunit: false, unit: 'tablet', category: 'general_medication' }),
  product('pr17', { dispensingFee: -50 }),
  product('pr18', { category: 'injectables', dispensingFee: 0 }),
  product('pr19', { productsStocks: [{ stockLocationId: STORE_A, quantity: -3, isArchived: false }] }),
  product('pr20', { productsStocks: [] }),
  product('pr21', { productsStocks: [{ stockLocationId: STORE_A, quantity: 5000, isArchived: false }] }),
  product('pr22', { minimumStockLevel: 20, optimalStockLevel: 10 }),
  product('pr23', { supplierProductId: 'sup-2', itemCode: null }),
  product('pr24', { itemCode: 'IC-24', supplierProductId: null }),
  product('pr25', { storeId: GHOST_STORE }),
  product('pr26', { referenceListId: 'ghost-list' }),
  product('pr27', { barcode: 'DUP-BC' }),
  product('pr28', { barcode: 'DUP-BC' }),
  product('pr29', { itemCode: 'DUP-IC' }),
  product('pr30', { itemCode: 'DUP-IC' }),
  product('pr31', { name: 'Same Name' }),
  product('pr32', { name: 'same name' }),
  product('pr33', { isSellable: true, isArchived: true }),
];

const service = (id, over = {}) => ({
  id, name: `Service ${id}`, category: 'consult', price: 4000, margin: 300,
  storeId: STORE_A, referenceListId: REF_LIST, externalReference: null, ...over,
});

export const SERVICES = [
  service('sv01'),
  service('sv02', { price: -100 }),
  service('sv03', { price: 0 }),
  service('sv04', { margin: -20 }),
  service('sv05', { margin: 900 }),
  service('sv06', { category: 'other' }),
  service('sv07', { category: 'other', name: 'Consult follow up' }),
  service('sv08', { name: 'Wormer tablet' }),
  service('sv09', { storeId: GHOST_STORE }),
  service('sv10', { referenceListId: 'ghost-list' }),
  service('sv11', { name: 'Dup Service' }),
  service('sv12', { name: 'dup service' }),
];

export const BUNDLES = [
  { id: 'bn01', name: 'Puppy Pack', price: 5000, storeId: STORE_A, childBundleIds: [], parentBundleIds: [] },
  { id: 'bn02', name: 'Free Pack', price: 0, storeId: STORE_A, childBundleIds: [], parentBundleIds: [] },
  { id: 'bn03', name: 'Neg Pack', price: -100, storeId: STORE_A, childBundleIds: [], parentBundleIds: [] },
  { id: 'bn04', name: 'Self Pack', price: 100, storeId: STORE_A, childBundleIds: ['bn04'], parentBundleIds: [] },
  { id: 'bn05', name: 'Dangling Parent', price: 100, storeId: STORE_A, childBundleIds: ['ghost-bundle'], parentBundleIds: ['ghost-bundle'] },
  { id: 'bn06', name: 'Dup Bundle', price: 100, storeId: STORE_A, childBundleIds: [], parentBundleIds: [] },
  { id: 'bn07', name: 'dup bundle', price: 100, storeId: STORE_A, childBundleIds: [], parentBundleIds: [] },
  { id: 'bn08', name: 'Ghost Store Bundle', price: 100, storeId: GHOST_STORE, childBundleIds: [], parentBundleIds: [] },
];

export const HEALTH_PLANS = [
  { id: 'hp01', name: 'Wellness', status: 'active', price: 2000, billingPeriod: 'monthly', targetSubscriberType: 'pet', allowances: [{ id: 'al1', name: 'Vacc', type: 'individual_service', item: 'sv01', status: 'active', appliesTo: 'pet', config: { limit: 1 } }] },
  { id: 'hp02', name: 'Free Plan', status: 'active', price: 0, billingPeriod: 'monthly', targetSubscriberType: 'pet', allowances: [] },
  { id: 'hp03', name: 'Wellness', status: 'active', price: 3000, billingPeriod: 'annually', targetSubscriberType: 'client', allowances: [{ id: 'al2', name: 'Ghost', type: 'individual_product', item: 'ghost-product', status: 'active', appliesTo: 'pet', config: { limit: 2 } }] },
  { id: 'hp04', name: 'Unbounded', status: 'active', price: 1000, billingPeriod: 'monthly', targetSubscriberType: 'pet', allowances: [{ id: 'al3', name: 'No limit', type: 'product_category', item: 'nutrition', status: 'active', appliesTo: 'pet', config: {} }, { id: 'al4', name: 'No appliesTo', type: 'product_category', item: 'nutrition', status: 'active', appliesTo: null, config: { limit: 1 } }] },
];

const sub = (id, over = {}) => ({
  id, healthPlanId: 'hp01', subscriberType: 'pet', subscriberId: 'p01', status: 'active',
  startedOn: '2026-01-01', endedOn: null, paymentDay: 1,
  createdAt: '2026-01-01T00:00:00Z', usages: [], cancellationReason: null, ...over,
});

export const SUBSCRIPTIONS = [
  sub('sb01'),
  sub('sb02', { subscriberId: 'p03', endedOn: '2026-05-01' }),
  sub('sb03', { subscriberId: 'p04', startedOn: '2027-01-01' }),
  sub('sb04', { subscriberId: 'p06', status: 'cancelled', endedOn: null, cancellationReason: 'moved' }),
  sub('sb05', { subscriberId: 'p07', status: 'pending_payment', createdAt: '2026-01-01T00:00:00Z' }),
  sub('sb06', { subscriberId: 'ghost-pet' }),
  sub('sb07', { healthPlanId: 'ghost-plan' }),
  sub('sb08', { subscriberId: 'p08' }),
  sub('sb09', { subscriberType: 'client', subscriberId: 'c0019' }),
  sub('sb10', { subscriberId: 'p05' }),
  sub('sb11', { subscriberId: 'p05' }),
  sub('sb13', { subscriberId: 'p11', paymentDay: null }),
];

export const REMINDERS = [
  { id: 'rm01', name: 'Booster', status: 'active', petScheduleType: 'VACCINATION', reminderMediums: ['email'], remindDaysBefore: 14, remindIfMissed: true, remindDaysAfter: 7, enableAutoRepeat: true, interval: '12m' },
  { id: 'rm02', name: 'No channel', status: 'active', petScheduleType: 'VACCINATION', reminderMediums: [], remindDaysBefore: 14, remindIfMissed: false, enableAutoRepeat: false },
  { id: 'rm03', name: 'No lead', status: 'active', petScheduleType: 'CUSTOM', reminderMediums: ['sms'], remindDaysBefore: 0, remindIfMissed: false, enableAutoRepeat: false },
  { id: 'rm04', name: 'Negative lead', status: 'active', petScheduleType: 'CUSTOM', reminderMediums: ['sms'], remindDaysBefore: -3, remindIfMissed: false, enableAutoRepeat: false },
  { id: 'rm05', name: 'Missed no delay', status: 'active', petScheduleType: 'CUSTOM', reminderMediums: ['sms'], remindDaysBefore: 7, remindIfMissed: true, remindDaysAfter: 0, enableAutoRepeat: false },
  { id: 'rm06', name: 'Repeat no interval', status: 'active', petScheduleType: 'CUSTOM', reminderMediums: ['sms'], remindDaysBefore: 7, remindIfMissed: false, enableAutoRepeat: true, interval: null },
  { id: 'rm07', name: 'Draft one', status: 'draft', petScheduleType: 'CUSTOM', reminderMediums: ['sms'], remindDaysBefore: 7, remindIfMissed: false, enableAutoRepeat: false },
  { id: 'rm08', name: 'Booster', status: 'active', petScheduleType: 'VACCINATION', reminderMediums: ['email'], remindDaysBefore: 14, remindIfMissed: false, enableAutoRepeat: false },
];

export const CLINICAL_NOTES = [
  { id: 'cl01', content: 'Routine check, all well.', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl02', content: '   ', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl03', content: 'Weight Ã¢â€™Ã¢â€™Ã¢â€™ recorded', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl04', content: 'No author here', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: null, isArchived: false },
  { id: 'cl05', content: 'Ghost author', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'ghost-emp', isArchived: false },
  { id: 'cl06', content: 'Ghost appointment', contentType: 'CLINICAL', entityType: 'APPOINTMENT', entityId: 'ghost-appt', employeeId: 'e01', isArchived: false },
  { id: 'cl07', content: 'Ghost pet', contentType: 'CLINICAL', entityType: 'PET', entityId: 'ghost-pet', employeeId: 'e01', isArchived: false },
  { id: 'cl08', content: 'Chip 900123456789012 noted', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl09', content: 'x'.repeat(5100), contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl10', content: 'Please tell the owner about the diet', contentType: 'INTERNAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
  { id: 'cl11', content: 'Do not tell the client about this', contentType: 'CLINICAL', entityType: 'PET', entityId: 'p01', employeeId: 'e01', isArchived: false },
];

const medrec = (id, over = {}) => ({
  id, petId: 'p01', type: 'preventive', category: 'vaccination', title: `Record ${id}`,
  description: 'desc', date: '2026-01-15', endDate: null, nextDueDate: '2027-01-15',
  appointmentId: null, ...over,
});

export const MEDICAL_RECORDS = [
  medrec('mr01'),
  medrec('mr02', { date: null }),
  medrec('mr03', { title: null }),
  medrec('mr04', { nextDueDate: null }),
  medrec('mr05', { date: '2027-06-01' }),
  medrec('mr06', { date: '2026-01-15', endDate: '2025-01-15' }),
  medrec('mr07', { date: '1985-01-01', nextDueDate: null, type: 'diagnosis', category: 'illness' }),
  medrec('mr08', { petId: 'ghost-pet' }),
  medrec('mr09', { appointmentId: 'ghost-appt' }),
  medrec('mr10', { petId: 'p05', date: '2024-01-15', nextDueDate: '2025-01-15' }),
];

const rx = (id, over = {}) => ({
  id, petId: 'p01', clientId: 'c0001', productName: 'Wormer', sourceProductId: 'pr01',
  employeeId: 'e01', status: 'completed', quantity: 10, unit: 'tablet',
  startDate: '2026-01-01', endDate: '2026-02-01', expiryDate: '2026-06-01',
  refillLimit: 2, isPrescribedOnly: true, dispenseTrackingMode: 'with_dispenses',
  prescriptionDispenses: [{ id: 'd1', isCancelled: false, authorisedAt: '2026-01-01T09:00:00Z', handedToClientAt: '2026-01-01T09:30:00Z' }],
  appointmentId: null, ...over,
});

export const PRESCRIPTIONS = [
  rx('rx01'),
  rx('rx02', { employeeId: null }),
  rx('rx03', { sourceProductId: null }),
  rx('rx04', { productName: null }),
  rx('rx05', { quantity: 0 }),
  rx('rx06', { unit: null }),
  rx('rx07', { expiryDate: null }),
  rx('rx08', { status: 'pending', expiryDate: '2026-01-01' }),
  rx('rx09', { startDate: '2026-03-01', endDate: '2026-01-01' }),
  rx('rx10', { status: 'pending', startDate: '2027-01-01', endDate: '2027-02-01', expiryDate: '2027-06-01' }),
  rx('rx11', { startDate: '2025-01-01', endDate: '2026-06-01' }),
  rx('rx12', { refillLimit: -1 }),
  rx('rx13', { refillLimit: 0, prescriptionDispenses: [{ id: 'd1', isCancelled: false }, { id: 'd2', isCancelled: false }, { id: 'd3', isCancelled: false }] }),
  rx('rx14', { status: 'completed', dispenseTrackingMode: 'with_dispenses', prescriptionDispenses: [] }),
  rx('rx15', { prescriptionDispenses: [{ id: 'd1', isCancelled: false, authorisedAt: '2026-01-01T09:00:00Z', handedToClientAt: null }] }),
  rx('rx16', { petId: 'ghost-pet' }),
  rx('rx17', { clientId: 'ghost-client' }),
  rx('rx18', { employeeId: 'ghost-emp' }),
  rx('rx19', { sourceProductId: 'ghost-product' }),
  rx('rx20', { appointmentId: 'ghost-appt' }),
  rx('rx21', { dispenseTrackingMode: 'written_prescription_only', sourceProductId: 'pr01', petId: 'p05', startDate: '2026-02-01', endDate: '2026-03-01', prescriptionDispenses: [] }),
];

const pLine = (id, over = {}) => ({ id, productId: 'pr01', name: 'Product pr01', price: 2000, unitPrice: 2000, quantity: 1, vatPercentage: 20, discount: 0, discountType: '£', billingBundleId: null, ...over });
const sLine = (id, over = {}) => ({ id, serviceId: 'sv01', name: 'Service sv01', price: 4000, unitPrice: 4000, quantity: 1, vatPercentage: 20, discount: 0, discountType: '£', billingBundleId: null, ...over });

const invoice = (id, over = {}) => ({
  id, invoiceNumber: `INV-${id}`, clientId: 'c0001', petId: 'p01', storeId: STORE_A,
  status: 'completed', paymentStatus: 'unpaid', amountDue: 2000, amountPaid: 0,
  activeFrom: '2026-06-01T10:00:00Z', discountAmount: 0, discountType: '£',
  createdByEmployeeId: 'e01',
  billingProducts: [pLine('l1')], billingServices: [], billingBundles: [], ...over,
});

export const INVOICES = [
  invoice('in01', { clientId: 'c0014', amountDue: 12500, billingProducts: [pLine('l1', { price: 12500 })] }),
  invoice('in02', { clientId: 'c0020', amountDue: 5000, billingProducts: [], billingServices: [sLine('l1', { price: 5000 })] }),
  invoice('in03', { clientId: 'c0019', amountDue: 9999, billingProducts: [pLine('l1', { price: 5000 })] }),
  invoice('in04', { clientId: 'c0002', amountDue: 1000, amountPaid: 1500, paymentStatus: 'paid', billingProducts: [pLine('l1', { price: 1000 })] }),
  invoice('in05', { clientId: 'c0003', paymentStatus: 'paid', amountPaid: 500, amountDue: 2000 }),
  invoice('in06', { clientId: 'c0004', paymentStatus: 'unpaid', amountPaid: 800, amountDue: 2000 }),
  invoice('in07', { clientId: 'c0005', paymentStatus: 'partially_paid', amountPaid: 2000, amountDue: 2000 }),
  invoice('in08', { clientId: 'c0006', status: 'completed', amountDue: 0, billingProducts: [] }),
  invoice('in09', { clientId: 'c0007', status: 'completed', amountDue: 3000, billingProducts: [], billingServices: [], billingBundles: [] }),
  invoice('in10', { clientId: 'c0008', status: 'draft', activeFrom: '2026-01-01T10:00:00Z' }),
  invoice('in11', { clientId: 'c0009', status: 'draft', amountPaid: 500, activeFrom: '2026-09-15T10:00:00Z' }),
  invoice('in12', { clientId: 'c0010', amountDue: -2000, billingProducts: [pLine('l1', { price: -2000 })] }),
  invoice('in13', { clientId: 'c0011', billingProducts: [pLine('l1', { quantity: 0 })] }),
  invoice('in14', { clientId: 'c0012', amountDue: 0, billingProducts: [pLine('l1', { price: 0, unitPrice: 0 })] }),
  invoice('in15', { clientId: 'c0013', billingProducts: [pLine('l1', { discount: 9999 })] }),
  invoice('in16', { clientId: 'c0016', billingProducts: [pLine('l1', { discount: 150, discountType: '%' })] }),
  invoice('in17', { clientId: 'c0017', billingProducts: [pLine('l1', { vatPercentage: 17.5 })] }),
  invoice('in18', { clientId: 'c0018', billingProducts: [pLine('l1', { productId: 'ghost-product' })] }),
  invoice('in19', { clientId: 'c0001', billingProducts: [], billingServices: [sLine('l1', { serviceId: 'ghost-service', price: 2000 })] }),
  invoice('in20', { invoiceNumber: 'INV-DUP', clientId: 'c0001' }),
  invoice('in21', { invoiceNumber: 'INV-DUP', clientId: 'c0001' }),
  invoice('in22', { clientId: 'ghost-client' }),
  invoice('in23', { petId: 'ghost-pet' }),
  invoice('in24', { createdByEmployeeId: 'ghost-emp' }),
  invoice('in25', { storeId: GHOST_STORE }),
  invoice('in26', {
    clientId: 'c0001', amountDue: 5000,
    billingBundles: [{ id: 'bb1', storeBundleId: 'bn01', parentBillingBundleId: null }],
    billingProducts: [pLine('l1', { price: 3000, billingBundleId: 'bb1' })],
    billingServices: [sLine('l2', { price: 4000, billingBundleId: 'bb1' })],
  }),
  invoice('in27', {
    clientId: 'c0001', amountDue: 2000,
    billingBundles: [{ id: 'bb2', storeBundleId: 'bn01', parentBillingBundleId: 'ghost-instance' }],
    billingProducts: [pLine('l1', { price: 2000, billingBundleId: 'bb2' })],
  }),
  invoice('in28', { clientId: 'c0001', amountDue: 2000 }),
];

const payment = (id, over = {}) => ({
  id, clientId: 'c0001', amount: 2000, method: 'card', status: 'completed',
  storeInvoiceId: 'in28', createdAt: '2026-06-01T10:05:00Z', ...over,
});

export const PAYMENTS = [
  payment('pay01'),
  payment('pay02', { clientId: 'c0015', amount: 4000, storeInvoiceId: null }),
  payment('pay03', { clientId: 'c0002', amount: 1500, storeInvoiceId: 'in04' }),
  payment('pay04', { amount: 0, status: 'completed' }),
  payment('pay05', { status: 'pending', createdAt: '2026-01-01T00:00:00Z' }),
  payment('pay06', { status: 'failed', amount: 1200 }),
  payment('pay07', { clientId: 'ghost-client', storeInvoiceId: 'in22' }),
  payment('pay08', { storeInvoiceId: 'ghost-invoice' }),
  payment('pay09', { clientId: 'c0006', storeInvoiceId: 'in28' }),
];

export const CREDIT_NOTES = [
  { id: 'cn01', clientId: 'c0015', storeInvoiceId: null, petId: null, status: 'issued', amount: '10.00', additionalCreditAmount: '0.00', isRefundable: false, reason: 'goodwill', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'l1' }] },
  { id: 'cn02', clientId: 'c0001', status: 'issued', amount: '0.00', isRefundable: false, reason: 'error', issuedAt: '2026-06-02T10:00:00Z', items: [] },
  { id: 'cn03', clientId: 'c0001', status: 'issued', amount: '5.00', isRefundable: false, reason: 'error', issuedAt: null, items: [{ billingProductId: 'l1' }] },
  { id: 'cn04', clientId: 'c0001', status: 'draft', amount: '5.00', isRefundable: false, reason: 'error', issuedAt: '2026-06-02T10:00:00Z', items: [] },
  { id: 'cn05', clientId: 'ghost-client', status: 'issued', amount: '5.00', isRefundable: true, reason: 'error', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'l1' }] },
  { id: 'cn06', clientId: 'c0001', storeInvoiceId: 'ghost-invoice', status: 'issued', amount: '5.00', isRefundable: true, reason: 'error', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'l1' }] },
  { id: 'cn07', clientId: 'c0001', petId: 'ghost-pet', status: 'issued', amount: '5.00', isRefundable: true, reason: 'error', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'l1' }] },
  { id: 'cn08', clientId: 'c0001', storeInvoiceId: 'in01', status: 'issued', amount: '5.00', isRefundable: true, reason: 'SOLD_IN_ERROR', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'ghost-line' }] },
  { id: 'cn09', clientId: 'c0001', status: 'issued', amount: '25.00', isRefundable: false, reason: 'UNKNOWN_DUE_TO_MIGRATION', issuedAt: '2026-06-02T10:00:00Z', items: [{ billingProductId: 'l1' }] },
];

export const REFUNDS = [
  { id: 'rf01', clientId: 'c0001', paymentId: 'pay01', amount: 500, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf02', clientId: 'c0001', paymentId: 'pay01', amount: 0, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf03', clientId: 'c0001', paymentId: 'pay01', amount: 500, status: 'COMPLETED', reason: 'UNKNOWN', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf04', clientId: 'c0001', paymentId: 'pay01', amount: 500, status: 'PENDING', reason: 'OVERPAYMENT', createdAt: '2026-01-01T10:00:00Z' },
  { id: 'rf05', clientId: 'c0001', paymentId: null, amount: 500, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf06', clientId: 'c0001', paymentId: 'ghost-payment', amount: 500, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf07', clientId: 'ghost-client', paymentId: 'pay01', amount: 500, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
  { id: 'rf08', clientId: 'c0001', paymentId: 'pay01', amount: 99999, status: 'COMPLETED', reason: 'OVERPAYMENT', createdAt: '2026-06-03T10:00:00Z' },
];

export const ESTIMATES = [
  { ...invoice('es01', { clientId: 'c0001', petId: 'p01', activeFrom: '2026-06-01T10:00:00Z' }) },
  { ...invoice('es02', { clientId: 'c0005', petId: 'p05', amountDue: 9999, activeFrom: '2026-01-01T10:00:00Z', billingProducts: [pLine('l1', { price: 2000 })] }) },
  { ...invoice('es03', { clientId: 'ghost-client' }) },
  { ...invoice('es04', { petId: 'ghost-pet' }) },
  { ...invoice('es05', { storeId: GHOST_STORE }) },
];

export const INSURANCE_POLICIES = [
  { id: 'ip01', petId: 'p01', policyNumber: 'POL-1', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip02', petId: 'ghost-pet', policyNumber: 'POL-2', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip03', petId: 'p03', policyNumber: null, insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip04', petId: 'p04', policyNumber: 'POL-4', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: null, isArchived: false },
  { id: 'ip05', petId: 'p05', policyNumber: 'DUP-POL', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip06', petId: 'p06', policyNumber: 'DUP-POL', insurerId: 'ins-2', insurerName: 'Agria', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip07', petId: 'p08', policyNumber: 'POL-7', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: false },
  { id: 'ip08', petId: 'p01', policyNumber: 'POL-8', insurerId: 'ins-1', insurerName: 'Petplan', policyHolderName: 'Test Client1', isArchived: true },
];

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

export function makePull({ overrides = {}, unavailable = {}, now = '2026-09-20' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lupa-check-'));
  mkdirSync(join(dir, '.checkpoint'), { recursive: true });

  const collections = {
    clients: CLIENTS, pets: PETS, appointments: APPOINTMENTS, products: PRODUCTS,
    services: SERVICES, bundles: BUNDLES, healthPlans: HEALTH_PLANS,
    healthPlanSubscriptions: SUBSCRIPTIONS, reminders: REMINDERS,
    medicalRecords: MEDICAL_RECORDS, clinicalNotes: CLINICAL_NOTES,
    prescriptions: PRESCRIPTIONS, invoices: INVOICES, payments: PAYMENTS,
    creditNotes: CREDIT_NOTES, refunds: REFUNDS, estimates: ESTIMATES,
    employees: EMPLOYEES, insurancePolicies: INSURANCE_POLICIES,
    ...overrides,
  };

  const counts = {};
  for (const [key, rows] of Object.entries(collections)) {
    writeFileSync(join(dir, `${key}.jsonl`), jsonl(rows));
    writeFileSync(join(dir, '.checkpoint', `${key}.json`), JSON.stringify({ cursor: null, lines: rows.length, done: true }));
    counts[key] = rows.length;
  }

  writeFileSync(join(dir, 'stores.json'), JSON.stringify([
    { id: STORE_A, name: 'Main Surgery' }, { id: STORE_B, name: 'Branch Clinic' },
  ]));
  writeFileSync(join(dir, 'paymentTerms.json'), JSON.stringify([{ id: TERMS, name: '30 days' }]));
  writeFileSync(join(dir, 'appointmentTypes.json'), JSON.stringify([{ id: VISIT_TYPE, name: 'Consult' }]));
  writeFileSync(join(dir, 'referenceLists.json'), JSON.stringify([{ id: REF_LIST, name: 'Main list' }]));
  writeFileSync(join(dir, 'stockLocations.json'), JSON.stringify([{ id: STORE_A, name: 'Main store' }]));
  writeFileSync(join(dir, 'employees.json'), JSON.stringify(collections.employees));
  writeFileSync(join(dir, 'enums.json'), JSON.stringify({
    productCategory: ['nutrition', 'general_medication', 'injectables', 'other'],
    serviceCategory: ['consult', 'other', 'fee'],
  }));

  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    rulesetVersion: '1.0.0',
    startedAt: `${now}T09:00:00.000Z`, finishedAt: `${now}T09:14:00.000Z`,
    environment: 'migrations',
    company: { id: 'co-1', name: 'Fixture Veterinary Group' },
    stores: [{ id: STORE_A, name: 'Main Surgery' }, { id: STORE_B, name: 'Branch Clinic' }],
    counts, requestCount: 142, unavailable,
  }));

  return dir;
}
