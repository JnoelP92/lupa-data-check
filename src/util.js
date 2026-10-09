// Shared helpers. Money is in integer minor units everywhere except where the API
// hands back a string (credit note amount, additionalCreditAmount) — parse those once,
// at the edge, and keep every comparison in integers.

export const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null);

// Phone comparison key. "07700 900123", "+44 7700 900123", "0044 (0)7700 900123" and
// "447700900123" are one number written four ways; comparing raw digits missed every
// one of those pairs. So international forms are brought back to the national one
// before comparing. Only codes whose national form is "0 + the rest" are rewritten
// this way, plus North America, which has no leading 0 at all.
//
// Anything under 7 digits is too short to be a real number and too likely to collide,
// so it is excluded from duplicate matching entirely.
const TRUNK_ZERO = ['44', '353', '61', '64']; // UK, Ireland, Australia, New Zealand
export function phoneKey(v) {
  if (typeof v !== 'string') return null;
  const international = /^\s*(\+|00)/.test(v);
  let digits = v.replace(/\D/g, '');
  if (international && digits.startsWith('00')) digits = digits.slice(2);
  const code = TRUNK_ZERO.find((c) => digits.startsWith(c));
  // A UK national number is 11 digits starting 0, so 12 digits starting 44 can only be
  // the international form with the + dropped.
  if (code && (international || (code === '44' && digits.length === 12))) {
    digits = `0${digits.slice(code.length).replace(/^0/, '')}`;
  } else if (international && digits.startsWith('1') && digits.length === 11) {
    digits = digits.slice(1);
  }
  return digits.length >= 7 ? digits : null;
}

// Microchip comparison key. "985 141 000 123 456" and "985141000123456" are the same
// chip; spaces, dashes and dots are how people type it, not part of it. Upper-cased
// because older 10-character chips carry hex letters.
export function microchipKey(v) {
  if (isBlank(v)) return null;
  const key = String(v).replace(/[\s.\-]/g, '').toUpperCase();
  return key || null;
}

// The OpenAPI spec says amountDue is "in the store's currency (minor units)". The
// migrations environment returns 1379.46, and unitPrice values like 2.055625 — decimals
// that cannot be minor units, on a field typed `number` rather than `integer`. Trusting
// the documentation made every money figure in the report 100x too small.
//
// So the scale is detected from the data at the start of a run, and set here once.
// Module-level state, deliberately: the alternative is threading a scale argument
// through every one of the ~120 money() call sites in the rules.
let DIVISOR = 100;

export function setMoneyScale(divisor) { DIVISOR = divisor; }
export function moneyScale() { return DIVISOR; }

export function money(value, currency = 'GBP') {
  if (value === null || value === undefined) return '—';
  const n = Number(value) / DIVISOR;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export const plural = (n, word, suffix = 's') => `${n} ${word}${n === 1 ? '' : suffix}`;

// Credit note amounts arrive as strings like "12.47" — always major units, whatever
// the numeric fields are doing. Bring them onto the same scale as everything else.
export const parseMoneyString = (v) => (isBlank(v) ? null : Number(v) * DIVISOR);

export function groupBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

// A breakdown table sorted by count, with a stable label for null.
export function breakdown(rows, keyFn, { labels } = {}) {
  const counts = groupBy(rows, keyFn);
  return [...counts.entries()]
    .map(([key, count]) => ({ key: key ?? '(none)', label: labels?.get(key) ?? key ?? '(none)', count }))
    .sort((a, b) => b.count - a.count);
}

// Rows sharing a key, for duplicate rules. Nulls are never duplicates of each other.
export function collisions(rows, keyFn) {
  const buckets = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (k === null || k === undefined || k === '') continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(row);
  }
  return [...buckets.entries()].filter(([, group]) => group.length > 1);
}

// One person registered at several sites is not a duplicate. A multi-site practice
// gives a client a record at each site they use, so the same email, phone or chip turns
// up once per site by design. A collision group is that case when every member has the
// same name and no two are at the same site; anything else — two names, or two records
// at one site — is still a duplicate and stays in the duplicate rule.
export function sameAcrossSites(group, nameOf, siteOf) {
  const names = new Set(group.map(nameOf));
  const sites = group.map(siteOf);
  return names.size === 1 && !isBlank([...names][0])
    && sites.every((s) => !isBlank(s)) && new Set(sites).size === sites.length;
}

// Merge overlapping groups of ids, so one person matched by email and again by phone is
// listed once. Returns arrays of ids.
export function mergeGroups(groups) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const g of groups) {
    for (const id of g) if (!parent.has(id)) parent.set(id, id);
    for (const id of g.slice(1)) parent.set(find(id), find(g[0]));
  }
  const out = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!out.has(root)) out.set(root, []);
    out.get(root).push(id);
  }
  return [...out.values()];
}

export const daysAgo = (n, now = Date.now()) => new Date(now - n * 86_400_000);

export function parseDate(v) {
  if (isBlank(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
