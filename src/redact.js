// What a client is allowed to see, per section 5.
//
// The internal report and the client report are the same findings with different rules
// about what may appear. Those rules live here, in one place, so "does this leak
// internal config" is answerable by reading one file.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Identifiers a practice actually uses. Everything else ending in Id is ours, not
// theirs, and is stripped.
const KEEP_IDS = new Set(['numericId', 'itemCode', 'barcode', 'invoiceNumber', 'microchip']);

export const looksLikeUuid = (v) => typeof v === 'string' && UUID.test(v.trim());

export function clientSafeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (KEEP_IDS.has(k)) { out[k] = v; continue; }
    if (looksLikeUuid(v)) continue;                       // raw UUID, never shown
    if (/Id$/.test(k) || /^dangling/i.test(k)) continue;  // internal reference plumbing
    if (k === 'snippet') continue;                        // free text from clinical notes
    out[k] = v;
  }
  return out;
}

// A finding is client-facing unless it is Info, explicitly internal-only, or every one
// of its rows would be emptied by redaction.
export function clientSafeFinding(finding) {
  if (finding.severity === 'info') return null;
  if (finding.internalOnly) return null;
  const rows = finding.rows.map((r) => ({
    display: r.display,
    reason: r.reason,
    fields: clientSafeFields(r.fields),
    link: r.link ?? null,
    id: r.id,
  }));
  return { ...finding, title: finding.clientFacing ?? finding.title, rows };
}

export function clientSafeSections(sections, { verdicts } = {}) {
  return sections
    .filter((s) => s.clientFacing !== false)
    .map((s) => ({
      ...s,
      findings: s.findings
        .filter((f) => (verdicts ? verdicts[f.id]?.include !== false : true))
        .map(clientSafeFinding)
        .filter(Boolean),
    }))
    .filter((s) => s.findings.length || s.tally.length);
}
