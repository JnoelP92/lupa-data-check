// Work app URLs, per section 4.3 of the ruleset.
//
// Several record types have no per-record page. For those the report row has to carry
// enough human-readable identity — numericId, itemCode, invoice number — that someone
// can find the record once the settings page loads. That is enforced here by returning
// a `search` hint alongside the URL, which the renderer prints in the row.
//
// The host follows the environment the pull came from. A migrations record does not
// exist on the live site, so a link to work.lupapets.com from a migrations report opens
// on "not found" every time.
const HOSTS = {
  production: 'https://work.lupapets.com',
  migrations: 'https://work.migrations.lupapets.com',
};

// Reports written before the environment was recorded carry none; they were always
// linked to production, so that stays the fallback.
export const workBase = (environment) => HOSTS[environment] ?? HOSTS.production;

// `??` only catches null and undefined, and this API returns empty strings freely — a
// product with itemCode "" fell through to no search hint at all, which on a settings
// page means no way to find the row.
const firstUseful = (...values) => values.find((v) => v !== null && v !== undefined && String(v).trim() !== '');

export const LINKS = {
  client: (r, base) => ({ url: `${base}/clients/${r.id}` }),
  pet: (r, base) => ({ url: `${base}/pets/${r.id}` }),
  appointment: (r, base) => ({ url: `${base}/appointments/${r.id}` }),
  invoice: (r, base) => ({ url: `${base}/invoices/${r.id}` }),
  healthPlan: (r, base) => ({ url: `${base}/subscription-plans/plans/${r.id}` }),

  // Pet-scoped: no per-record page, link to the owning pet.
  prescription: (r, base) => ({ url: r.petId ? `${base}/pets/${r.petId}` : null, note: 'Medical Highlights tab' }),
  medicalRecord: (r, base) => ({ url: r.petId ? `${base}/pets/${r.petId}` : null, note: 'Medical Highlights tab' }),
  clinicalNote: (r, base) => ({ url: r.petId ? `${base}/pets/${r.petId}` : null, note: 'Notes tab' }),

  // Settings-scoped: no deep link at all. `search` is what the row must show.
  product: (r, base) => ({ url: `${base}/settings?tab=products`, search: firstUseful(r.itemCode, r.barcode, r.name) }),
  service: (r, base) => ({ url: `${base}/settings?tab=services`, search: firstUseful(r.name) }),
  bundle: (r, base) => ({ url: `${base}/settings?tab=bundles`, search: firstUseful(r.name) }),
  employee: (r, base) => ({ url: `${base}/settings?tab=employees`, search: firstUseful(r.email, r.firstName) }),
  reminder: (r, base) => ({ url: `${base}/reminders`, search: firstUseful(r.name) }),
};

export function link(type, record, environment) {
  const fn = LINKS[type];
  return fn ? fn(record, workBase(environment)) : { url: null };
}
