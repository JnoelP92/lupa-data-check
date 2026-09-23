// Work app URLs, per section 4.3 of the ruleset.
//
// Several record types have no per-record page. For those the report row has to carry
// enough human-readable identity — numericId, itemCode, invoice number — that someone
// can find the record once the settings page loads. That is enforced here by returning
// a `search` hint alongside the URL, which the renderer prints in the row.
const BASE = 'https://work.lupapets.com';

// `??` only catches null and undefined, and this API returns empty strings freely — a
// product with itemCode "" fell through to no search hint at all, which on a settings
// page means no way to find the row.
const firstUseful = (...values) => values.find((v) => v !== null && v !== undefined && String(v).trim() !== '');

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
  product: (r) => ({ url: `${BASE}/settings?tab=products`, search: firstUseful(r.itemCode, r.barcode, r.name) }),
  service: (r) => ({ url: `${BASE}/settings?tab=services`, search: firstUseful(r.name) }),
  bundle: (r) => ({ url: `${BASE}/settings?tab=bundles`, search: firstUseful(r.name) }),
  employee: (r) => ({ url: `${BASE}/settings?tab=employees`, search: firstUseful(r.email, r.firstName) }),
  reminder: (r) => ({ url: `${BASE}/reminders`, search: firstUseful(r.name) }),
};

export function link(type, record) {
  const fn = LINKS[type];
  return fn ? fn(record) : { url: null };
}
