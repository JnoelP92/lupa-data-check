// The client-facing report, per section 5.
//
// Written as a single self-contained HTML file with print styles, not a PDF: a PDF
// needs a rendering engine, and every route to one is either a dependency this tool
// does not have or a binary that will not be on the machine running it. The skill turns
// this into report-client.pdf by printing it, which is one step and produces better
// typography than anything hand-rolled here would.
//
// What is different from the internal report is enforced in src/redact.js, not here.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientSafeSections, clientSafeCharacteristics } from './redact.js';
import { looksLikeUuid } from './redact.js';
import { link } from './links.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CSS = `
:root {
  --ink: #16241f; --muted: #5b6b64; --line: #dfe5e2; --soft: #f4f7f5; --bg: #ffffff;
  --brand: #0f7a5a; --critical: #a32b1c; --review: #8a6100;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.page { max-width: none; margin: 0; padding: 40px 48px 72px; }
header.mast { display: flex; align-items: baseline; gap: 14px; border-bottom: 3px solid var(--brand);
  padding-bottom: 14px; margin-bottom: 26px; }
.wordmark { font-weight: 700; font-size: 22px; letter-spacing: -0.3px; color: var(--brand); }
.mast .co { font-size: 18px; font-weight: 600; }
.mast .meta { margin-left: auto; font-size: 12px; color: var(--muted); text-align: right; }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.4px; }
h2 { font-size: 20px; margin: 0; letter-spacing: -0.3px; }
h3 { font-size: 15px; margin: 0 0 8px; }
.lede { color: var(--muted); margin: 0 0 24px; max-width: 78ch; }

/* Summary and contents sit side by side, so navigating never needs a scroll back up. */
.nav-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 22px; align-items: start; margin: 0 0 30px; }
.panel { border: 1px solid var(--line); border-radius: 10px; padding: 16px 20px; background: var(--soft); }
.panel h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
.panel ol { margin: 0; padding-left: 20px; } .panel li { margin: 5px 0; }
a { color: var(--brand); }

.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 0 0 26px; }
.totals div { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.totals dt { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 4px; }
.totals dd { margin: 0; font-size: 18px; font-weight: 650; }

/* Each record type gets a clear banded heading, so the eye never loses which
   category a table belongs to when several sit side by side. */
section.cat { margin-top: 38px; page-break-before: always; }
section.cat:first-of-type { page-break-before: avoid; }
.cat-head { display: flex; align-items: center; gap: 14px; background: var(--brand); color: #fff;
  padding: 10px 18px; border-radius: 8px 8px 0 0; }
.cat-head h2 { color: #fff; }
.cat-head .n { margin-left: auto; font-size: 12px; opacity: .9; }
.cat-body { border: 1px solid var(--line); border-top: none; border-radius: 0 0 8px 8px; padding: 20px 18px 8px; }
.back { font-size: 12px; color: var(--muted); text-decoration: none; }

/* Two findings abreast when both are narrow; a wide one takes the full row. */
.findings { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 22px 26px; }
.finding { break-inside: avoid; min-width: 0; }
.finding.wide { grid-column: 1 / -1; }
.badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 4px; vertical-align: 2px; margin-right: 8px; }
.badge.critical { background: #fbe9e6; color: var(--critical); }
.badge.review { background: #fdf3df; color: var(--review); }
.count { color: var(--muted); font-weight: 400; font-size: 13px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 0; font-size: 13px; }
th, td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
  border-bottom: 1px solid var(--ink); font-weight: 600; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.note { font-size: 12px; color: var(--muted); margin-top: 7px; }
.note code { background: var(--soft); padding: 1px 5px; border-radius: 4px; }
footer { margin-top: 48px; border-top: 1px solid var(--line); padding-top: 14px;
  font-size: 11px; color: var(--muted); }
@media print {
  .page { padding: 0 10mm; }
  a { color: var(--ink); text-decoration: none; }
  .panel, .finding, section.cat { break-inside: avoid; }
  .cat-head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
@page { size: A4 landscape; margin: 12mm 0; }
`;

// How many rows a client-facing table shows before handing off to the spreadsheet.
const HTML_ROWS = 10;

function findingHtml(finding, sectionLinkType, workbook) {
  const rows = finding.rows.slice(0, HTML_ROWS);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.fields)))];
  const head = ['', ...keys, 'Open in Lupa'];
  const body = rows.map((r) => {
    const l = r.link ?? link(finding.linkType ?? sectionLinkType, { id: r.id, ...r.fields });
    const open = l?.url
      ? `<a href="${esc(l.url)}">Open &#8599;</a>${l.search ? ` <span class="count">search “${esc(l.search)}”</span>` : ''}`
      : '—';
    return `<tr><td>${esc(r.display)}</td>${keys.map((k) => `<td>${esc(r.fields[k] ?? '')}</td>`).join('')}<td>${open}</td></tr>`;
  }).join('\n');

  const remainder = finding.total - rows.length;
  const sheet = workbook?.sheetFor?.(finding.id);
  const note = remainder > 0
    ? `<p class="note">Showing ${rows.length} of ${finding.total.toLocaleString()}.`
      + (sheet ? ` The ${sheet.rows === finding.total ? 'full list' : `next ${sheet.rows.toLocaleString()}`} ${sheet.rows === finding.total ? 'is' : 'are'} in the attached spreadsheet, sheet <code>${esc(sheet.name)}</code>.` : '')
      + '</p>'
    : '';

  // A table with many columns needs the full width; a narrow one can share a row.
  const wide = head.length > 6 ? ' wide' : '';
  return `<div class="finding${wide}">
  <h3><span class="badge ${finding.severity}">${finding.severity}</span>${esc(finding.title)}
    <span class="count">— ${finding.total.toLocaleString()}${finding.groupCount ? ` across ${finding.groupCount.toLocaleString()} groups` : ''}</span></h3>
  <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
  ${note}
</div>`;
}

export function renderClientReport(report, { verdicts, intro, workbook } = {}) {
  const sections = clientSafeSections(report.sections, { verdicts }).filter((s) => s.findings.length);
  const characteristics = clientSafeCharacteristics(report.sections, { verdicts });

  // Reconciliation headline numbers, kept per section 5 — these are what the practice
  // most wants back. Per-store breakdowns render as their own table below.
  const cross = report.sections.find((s) => s.key === 'crossRecord');
  const totals = (cross?.tally ?? []).filter((t) => !t.breakdown && /total|balance|difference|paid/i.test(t.label));
  const perStore = (cross?.tally ?? []).find((t) => t.breakdown && /by store/i.test(t.label));

  const summaryRows = sections.map((s) => {
    const crit = s.findings.filter((f) => f.severity === 'critical').reduce((t, f) => t + f.total, 0);
    const rev = s.findings.filter((f) => f.severity === 'review').reduce((t, f) => t + f.total, 0);
    return `<tr><td><a href="#${slug(s.label)}">${esc(s.label)}</a></td>`
      + `<td class="num">${s.scanned.toLocaleString()}</td>`
      + `<td class="num">${crit ? crit.toLocaleString() : '—'}</td>`
      + `<td class="num">${rev ? rev.toLocaleString() : '—'}</td></tr>`;
  }).join('');

  const toc = sections.map((s) =>
    `<li><a href="#${slug(s.label)}">${esc(s.label)}</a> <span class="count">— ${s.findings.reduce((t, f) => t + f.total, 0).toLocaleString()}</span></li>`).join('');

  const body = sections.map((s) => `<section class="cat" id="${slug(s.label)}">
  <div class="cat-head"><h2>${esc(s.label)}</h2>
    <span class="n">${s.scanned.toLocaleString()} records checked · ${s.findings.length} thing${s.findings.length === 1 ? '' : 's'} to look at</span></div>
  <div class="cat-body">
    <div class="findings">${s.findings.map((f) => findingHtml(f, s.linkType, workbook)).join('\n')}</div>
    <p class="note"><a class="back" href="#top">↑ Back to summary</a></p>
  </div>
</section>`).join('\n');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data review — ${esc(report.company.name)}</title>
<style>${CSS}</style></head>
<body><div class="page" id="top">
<header class="mast">
  <span class="wordmark">Lupa</span>
  <span class="co">${esc(report.company.name)}</span>
  <span class="meta">Data review<br>${esc(report.generatedAt.slice(0, 10))}</span>
</header>

<h1>Data review — first pass</h1>
<p class="lede">${esc(intro ?? 'These are the things we spotted while checking your data. Most need a decision from you rather than a fix from us — you will know which of these are how your practice actually works and which are genuinely wrong.')}</p>
${(report.notChecked ?? []).length ? `<p class="lede"><strong>What this review did not cover:</strong> ${esc(report.notChecked.join(', '))}. No records came through for these, so we have not checked them — please do not read their absence here as a clean result.</p>` : ''}

<div class="nav-row">
  <div class="panel">
    <h3>Summary</h3>
    <table><thead><tr><th>Area</th><th class="num">Checked</th><th class="num">To fix</th><th class="num">To review</th></tr></thead>
    <tbody>${summaryRows}</tbody></table>
  </div>
  <div class="panel">
    <h3>Record by record</h3>
    <ol>${toc}</ol>
  </div>
</div>

${totals.length ? `<h3>Where the money stands</h3>
<dl class="totals">${totals.map((t) => `<div><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('')}</dl>` : ''}

${perStore && perStore.breakdown.length > 1 ? `<h3>By store</h3>
<table style="margin-bottom:26px"><thead><tr><th>Store</th><th class="num">Invoices</th><th>Totals</th></tr></thead><tbody>
${perStore.breakdown.map((b) => `<tr><td>${esc(looksLikeUuid(b.label) ? 'Unnamed location' : b.label)}</td><td class="num">${Number(b.count).toLocaleString()}</td><td>${esc(b.extra)}</td></tr>`).join('')}
</tbody></table>` : ''}

${characteristics.length ? `<section class="cat" id="across-the-board" style="page-break-before:avoid">
  <div class="cat-head"><h2>Across the whole record set</h2><span class="n">${characteristics.length} findings</span></div>
  <div class="cat-body">
  <p class="lede">Each of these is true of nearly every record of its kind, so they are
  almost certainly one decision each rather than a list to work through. They are the
  most important part of this report.</p>
  <table><thead><tr><th>Area</th><th>What we found</th><th class="num">Records</th><th class="num">Share</th></tr></thead><tbody>
  ${characteristics.map((c) => `<tr><td>${esc(c.category)}</td><td>${esc(c.title)}</td><td class="num">${c.count.toLocaleString()}</td><td class="num">${c.share}%</td></tr>`).join('')}
  </tbody></table>
  </div>
</section>` : ''}

${body}

<footer>Prepared by Lupa · ${esc(report.company.name)} · ${esc(report.generatedAt.slice(0, 10))} · ruleset v${esc(report.rulesetVersion)}<br>
Every row links back into Lupa so you can open the record directly.</footer>
</div></body></html>`;
}

export function writeClientReport(dir, report, opts) {
  const html = renderClientReport(report, opts);
  const path = join(dir, 'report-client.html');
  writeFileSync(path, html);
  return path;
}
