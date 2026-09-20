// Shared helpers. Money is in integer minor units everywhere except where the API
// hands back a string (credit note amount, additionalCreditAmount) — parse those once,
// at the edge, and keep every comparison in integers.

export const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : null);

// Phone comparison key. Anything under 7 digits is too short to be a real number and
// too likely to collide, so it is excluded from duplicate matching entirely.
export function phoneKey(v) {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export function money(minorUnits, currency = 'GBP') {
  if (minorUnits === null || minorUnits === undefined) return '—';
  const n = Number(minorUnits) / 100;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export const plural = (n, word, suffix = 's') => `${n} ${word}${n === 1 ? '' : suffix}`;

export const parseMoneyString = (v) => (isBlank(v) ? null : Math.round(Number(v) * 100));

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

export const daysAgo = (n, now = Date.now()) => new Date(now - n * 86_400_000);

export function parseDate(v) {
  if (isBlank(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
