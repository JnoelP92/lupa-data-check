// The three text deliverables that go with the client report: the Dock copy, the draft
// email, and the Linear ticket export.
//
// None of these send anything. The email is a draft for a human to read, edit and send;
// the Linear export is a file the skill turns into issues only after the user has
// picked which findings deserve one.
import { writeFileSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { writeXlsx } from './xlsx.js';
import { clientSafeFields } from './redact.js';
import { clientSafeSections, clientSafeCharacteristics } from './redact.js';

// Plain text for the data findings box on the Dock migration page. No tables, no links,
// no UUIDs — that box renders none of them.
export function renderDockCopy(report, opts = {}) {
  const { verdicts } = opts;
  const sections = clientSafeSections(report.sections, { verdicts }).filter((s) => s.findings.length);
  const out = [];
  out.push(`Data check — ${report.company.name}`);
  out.push(`${report.environment} environment, ${report.generatedAt.slice(0, 10)}, ruleset v${report.rulesetVersion}`);
  out.push('');

  // Counts exclude whole-dataset findings, which are listed separately below. Folding
  // them in turns "644,707 to review" into a number nobody can act on.
  const totalCritical = sections.reduce((t, s) => t + s.findings.filter((f) => f.severity === 'critical').reduce((a, f) => a + f.total, 0), 0);
  const totalReview = sections.reduce((t, s) => t + s.findings.filter((f) => f.severity === 'review').reduce((a, f) => a + f.total, 0), 0);
  out.push(`${totalCritical.toLocaleString()} items to fix before go-live, ${totalReview.toLocaleString()} to review.`);
  out.push('');

  const characteristics = clientSafeCharacteristics(report.sections, opts);
  if (characteristics.length) {
    out.push('ACROSS THE WHOLE RECORD SET');
    out.push('These are true of nearly every record of their kind - one decision each,');
    out.push('not a list to work through.');
    for (const c of characteristics) {
      out.push(`  - ${c.title.replace(/\.$/, '')}: ${c.count.toLocaleString()} (${c.share}%)`);
    }
    out.push('');
  }
  if ((report.notChecked ?? []).length) {
    out.push(`NOT CHECKED - no records returned: ${report.notChecked.join(', ')}.`);
    out.push('Not a clean result for these. Confirm whether the data is migrated yet.');
    out.push('');
  }

  for (const section of sections) {
    out.push(`${section.label.toUpperCase()}`);
    for (const f of section.findings) {
      // Softened titles end in a full stop; `Title.: 3` reads badly in a plain list.
      out.push(`  - ${f.title.replace(/\.$/, '')}: ${f.total}`);
    }
    out.push('');
  }
  out.push('Full report with record links sent separately.');
  return out.join('\n');
}

// A draft the internal user opens, reads and sends themselves. Never sent from here.
export function renderEmail(report, { contactName, senderName, verdicts } = {}) {
  const sections = clientSafeSections(report.sections, { verdicts }).filter((s) => s.findings.length);
  // Lead with what the migration did not carry; those matter more than any individual
  // record, and they are what the practice can actually answer questions about.
  const characteristics = clientSafeCharacteristics(report.sections, { verdicts });
  const headline = characteristics.length
    ? characteristics.slice(0, 3).map((c) => ({ title: c.title, total: c.count }))
    : sections.flatMap((s) => s.findings.filter((f) => f.severity === 'critical')).slice(0, 3);

  const subject = `${report.company.name} — data review, first pass`;
  const body = [
    `Hi ${contactName ?? '{name}'},`,
    '',
    'Here are the findings from our first pass check. Attached is a report of what we found.',
    'Please use this to shape your review on some of the focus areas and we will use this in',
    'our shared review.',
    '',
    ...(headline.length
      ? ['The few things worth looking at first:', '', ...headline.map((f) => `  · ${f.title} (${f.total})`), '']
      : []),
    'Most of these need a decision from you rather than a fix from us — you will know which',
    'are how the practice actually works and which are genuinely wrong. Anything you are not',
    'sure about, leave it and we will go through it together.',
    '',
    senderName ? `Thanks,\n${senderName}` : 'Thanks,',
  ].join('\n');

  return { subject, body };
}

// One ticket per finding the user selected. Written to disk for the skill to create in
// Linear after the manual review — never filed automatically.
export function renderLinearTickets(report, { verdicts, team } = {}) {
  const selected = [];
  for (const section of report.sections) {
    for (const f of section.findings) {
      if (!verdicts?.[f.id]?.ticket) continue;
      const v = verdicts[f.id];
      selected.push({
        title: `${report.company.name}: ${f.title} (${f.total})`,
        team: team ?? null,
        description: [
          `**Practice:** ${report.company.name}`,
          `**Environment:** ${report.environment}`,
          `**Rule:** \`${f.id}\` (${f.severity})`,
          `**Affected records:** ${f.total}`,
          '',
          f.why ? `${f.why}\n` : '',
          v.note ? `**Reviewer note:** ${v.note}\n` : '',
          '**Examples**',
          '',
          ...f.rows.slice(0, 5).map((r) => `- ${r.display} — ${Object.entries(r.fields).map(([k, val]) => `${k}: ${val}`).join(', ')}`),
          '',
          `_Generated by lupa-data-check, ruleset v${report.rulesetVersion}, ${report.generatedAt.slice(0, 10)}._`,
        ].filter((l) => l !== '').join('\n'),
        labels: ['data-migration', f.severity],
        ruleId: f.id,
      });
    }
  }
  return selected;
}

// Categories where the practice needs the whole list rather than a sample: a catalogue
// is something you sit down and work through, one row at a time.
const EXPORT_EVERYTHING = new Set(['products', 'services', 'bundles']);
const SHEET_CAP = 100;

// The workbook is built from findings.jsonl rather than report.json, because report.json
// only carries a capped sample per rule. The full set is on disk already; this reads it
// once, keeping only the rules that made it into the client report.
export async function buildWorkbook(dir, report, { verdicts } = {}) {
  const path = join(dir, 'findings.jsonl');
  const sections = clientSafeSections(report.sections, { verdicts }).filter((s) => s.findings.length);

  const wanted = new Map(); // ruleId -> { finding, section, cap, rows }
  for (const section of sections) {
    for (const finding of section.findings) {
      wanted.set(finding.id, {
        title: finding.title, category: section.label, total: finding.total,
        cap: EXPORT_EVERYTHING.has(section.key) ? Infinity : SHEET_CAP,
        rows: [],
      });
    }
  }
  if (!wanted.size || !existsSync(path)) return null;

  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const entry = wanted.get(row.rule);
    if (!entry || entry.rows.length >= entry.cap) continue;
    entry.rows.push(row);
  }

  const sheets = [];
  const index = new Map();
  for (const [ruleId, entry] of wanted) {
    if (!entry.rows.length) continue;
    const keys = [...new Set(entry.rows.flatMap((r) => Object.keys(clientSafeFields(r.fields))))];
    const name = `${entry.category}: ${entry.title}`.replace(/\.$/, '');
    sheets.push({
      name,
      headers: ['Name', ...keys],
      rows: entry.rows.map((r) => {
        const f = clientSafeFields(r.fields);
        return [r.display, ...keys.map((k) => f[k] ?? '')];
      }),
    });
    index.set(ruleId, { name: name.slice(0, 31), rows: entry.rows.length, total: entry.total });
  }
  if (!sheets.length) return null;

  const written = writeXlsx(join(dir, 'findings.xlsx'), sheets);
  return { ...written, sheetFor: (ruleId) => index.get(ruleId) };
}

export function writeDeliverables(dir, report, opts = {}) {
  const written = {};

  written.dock = join(dir, 'dock-copy.txt');
  writeFileSync(written.dock, renderDockCopy(report, opts));

  const email = renderEmail(report, opts);
  written.email = join(dir, 'client-email.txt');
  writeFileSync(written.email, `Subject: ${email.subject}\n\n${email.body}\n`);

  const tickets = renderLinearTickets(report, opts);
  if (tickets.length) {
    written.linear = join(dir, 'linear-tickets.json');
    writeFileSync(written.linear, JSON.stringify(tickets, null, 2));
  }

  return written;
}
