// Work app URLs, per section 4.3 of the ruleset.
//
// Several record types have no per-record page. For those the report row has to carry
// enough human-readable identity — numericId, itemCode, invoice number — that someone
// can find the record once the settings page loads. That is enforced here by returning
// a `search` hint alongside the URL, which the renderer prints in the row.
const BASE = 'https://work.lupapets.com';

export const LINKS = {
  client: (r) => ({ url: `${BASE}/clients/${r.id}` }),
  pet: (r) => ({ url: `${BASE}/pets/${r.id}` }),
  appointment: (r) => ({ url: `${BASE}/appointments/${r.id}` }),
  invoice: (r) => ({ url: `${BASE}/invoices/${r.id}` }),
  healthPlan: (r) => ({ url: `${BASE}/subscription-plans/plans/${r.id}` }),

  // Pet-scoped: no per-record page, link to the owning pet.
  prescription: (r) => ({ url: r.petId ? `${BASE}/pets/${r.petId}` : null, note: 'Medical Highlights tab' }),
  medicalRecord: (r) => ({ url: r.petId ? `${BASE}/pets/${r.petId}` : null, note: 'Medical Highlights tab' }),
  clinicalNote: (r) => ({ url: r.petId ? `${BASE}/pets/${r.petId}` : null, note: 'Notes tab' }),

  // Settings-scoped: no deep link at all. `search` is what the row must show.
  product: (r) => ({ url: `${BASE}/settings?tab=products`, search: r.itemCode ?? r.barcode ?? r.name }),
  service: (r) => ({ url: `${BASE}/settings?tab=services`, search: r.name }),
  bundle: (r) => ({ url: `${BASE}/settings?tab=bundles`, search: r.name }),
  employee: (r) => ({ url: `${BASE}/settings?tab=employees`, search: r.email ?? r.firstName }),
  reminder: (r) => ({ url: `${BASE}/reminders`, search: r.name }),
};

export function link(type, record) {
  const fn = LINKS[type];
  return fn ? fn(record) : { url: null };
}
