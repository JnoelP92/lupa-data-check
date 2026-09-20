// What gets pulled, and in what order.
//
// Reference sets first: they populate the "known valid ID" sets that every referential
// rule checks membership against. Doing it this way is what keeps orphan sweeps to one
// pass instead of a per-record GET that would be hundreds of thousands of requests
// against a 100/min rate limit.
//
// Then the big lists, cheapest-to-reason-about first so an interrupted pull still
// leaves something checkable.

export const REFERENCE = [
  { key: 'stores', path: '/v1/companies/stores', idField: 'id' },
  { key: 'paymentTerms', path: '/v1/payment-terms', idField: 'id' },
  { key: 'appointmentStatuses', path: '/v1/appointment-statuses', idField: 'id' },
  { key: 'appointmentTypes', path: '/v1/appointment-types', idField: 'id' },
  { key: 'stockLocations', path: '/v1/stock-locations', idField: 'id' },
  { key: 'employees', path: '/v1/employees', idField: 'id' },
  { key: 'referenceLists', path: '/v1/reference-lists', idField: 'id' },
];

export const COLLECTIONS = [
  { key: 'clients', path: '/v1/clients', label: 'Clients' },
  { key: 'pets', path: '/v1/pets', label: 'Pets' },
  { key: 'products', path: '/v1/products', label: 'Products' },
  { key: 'services', path: '/v1/services', label: 'Services' },
  { key: 'bundles', path: '/v1/bundles', label: 'Bundles' },
  { key: 'healthPlans', path: '/v1/health-plans', label: 'Health plans' },
  { key: 'healthPlanSubscriptions', path: '/v1/health-plans/subscriptions', label: 'Health plan subscriptions' },
  { key: 'reminders', path: '/v1/reminders', label: 'Reminders' },
  { key: 'medicalRecords', path: '/v1/medical-records', label: 'Medical records' },
  { key: 'clinicalNotes', path: '/v1/clinical-notes', label: 'Clinical notes' },
  { key: 'prescriptions', path: '/v1/prescriptions', label: 'Prescriptions' },
  { key: 'appointments', path: '/v1/appointments', label: 'Appointments' },
  { key: 'invoices', path: '/v1/financials/invoices', label: 'Invoices' },
  { key: 'payments', path: '/v1/financials/payments', label: 'Payments' },
  { key: 'creditNotes', path: '/v1/financials/credit-notes', label: 'Credit notes' },
  { key: 'refunds', path: '/v1/financials/refunds', label: 'Refunds' },
  { key: 'estimates', path: '/v1/financials/estimates', label: 'Estimates' },
];

export const ENVIRONMENTS = {
  migrations: 'https://api.migrations.lupapets.com/api/external',
  production: 'https://api.lupapets.com/api/external',
};
