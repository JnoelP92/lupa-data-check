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
import { link } from './links.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const CSS = `
:root {
  --ink: #16241f; --muted: #5b6b64; --line: #dfe5e2; --bg: #ffffff;
  --brand: #0f7a5a; --critical: #a32b1c; --review: #8a6100;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.page { max-width: 820px; margin: 0 auto; padding: 48px 32px 72px; }
header.mast { display: flex; align-items: baseline; gap: 14px; border-bottom: 3px solid var(--brand);
  padding-bottom: 14px; margin-bottom: 28px; }
.wordmark { font-weight: 700; font-size: 22px; letter-spacing: -0.3px; color: var(--brand); }
.mast .co { font-size: 18px; font-weight: 600; }
.mast .meta { margin-left: auto; font-size: 12px; color: var(--muted); text-align: right; }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.4px; }
h2 { font-size: 20px; margin: 0 0 4px; letter-spacing: -0.3px; }
h3 { font-size: 15px; margin: 22px 0 8px; }
.lede { color: var(--muted); margin: 0 0 28px; max-width: 60ch; }
.toc { border: 1px solid var(--line); border-radius: 10px; padding: 18px 22px; margin: 0 0 32px; }
.toc ol { margin: 8px 0 0; padding-left: 20px; } .toc li { margin: 4px 0; }
a { color: var(--brand); }
.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 0 0 28px; }
.totals div { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.totals dt { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 4px; }
.totals dd { margin: 0; font-size: 18px; font-weight: 650; }
section.cat { border-top: 1px solid var(--line); padding-top: 26px; margin-top: 34px; page-break-before: always; }
section.cat:first-of-type { page-break-before: avoid; }
.back { font-size: 12px; color: var(--muted); text-decoration: none; }
.finding { margin: 20px 0 26px; }
.badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; padding: 2px 7px; border-radius: 4px; vertical-align: 2px; margin-right: 8px; }
.badge.critical { background: #fbe9e6; color: var(--critical); }
.badge.review { background: #fdf3df; color: var(--review); }
.count { color: var(--muted); font-weight: 400; font-size: 13px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 0; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
  border-bottom: 1px solid var(--ink); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.note { font-size: 12px; color: var(--muted); margin-top: 8px; }
footer { margin-top: 48px; border-top: 1px solid var(--line); padding-top: 14px;
  font-size: 11px; color: var(--muted); }
@media print {
  .page { max-width: none; padding: 0 12mm; }
  a { color: var(--ink); text-decoration: none; }
  .toc { break-inside: avoid; } .finding { break-inside: avoid; }
}
@page { size: A4; margin: 16mm 0; }
`;

function findingHtml(finding, sectionLinkType) {
  const keys = [...new Set(finding.rows.flatMap((r) => Object.keys(r.fields)))];
  const head = ['', ...keys, 'Open in Lupa'];
  const body = finding.rows.map((r) => {
    const l = r.link ?? link(finding.linkType ?? sectionLinkType, { id: r.id, ...r.fields });
    const open = l?.url
      ? `<a href="${esc(l.url)}">Open &#8599;</a>${l.search ? ` <span class="count">search “${esc(l.search)}”</span>` : ''}`
      : '—';
    return `<tr><td>${esc(r.display)}</td>${keys.map((k) => `<td>${esc(r.fields[k] ?? '')}</td>`).join('')}<td>${open}</td></tr>`;
  }).join('\n');

  return `<div class="finding">
  <h3><span class="badge ${finding.severity}">${finding.severity}</span>${esc(finding.title)}
    <span class="count">— ${finding.truncatedTo ? `showing ${finding.truncatedTo} of ${finding.total}` : finding.total}</span></h3>
  <table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
  ${finding.truncatedTo ? `<p class="note">Showing the first ${finding.truncatedTo} of ${finding.total}. The full list is in the internal report — ask us for it if you want to work through all of them.</p>` : ''}
</div>`;
}

export function renderClientReport(report, { verdicts, intro } = {}) {
  const sections = clientSafeSections(report.sections, { verdicts }).filter((s) => s.findings.length);
  const characteristics = clientSafeCharacteristics(report.sections, { verdicts });

  // Reconciliation headline numbers, kept per section 5 — these are what the practice
  // most wants back.
  const cross = report.sections.find((s) => s.key === 'crossRecord');
  const totals = (cross?.tally ?? []).filter((t) => !t.breakdown && /total|balance|difference/i.test(t.label));

  const toc = sections.map((s) => `<li><a href="#${slug(s.label)}">${esc(s.label)}</a> <span class="count">— ${s.findings.reduce((t, f) => t + f.total, 0)} to review</span></li>`).join('\n');

  const body = sections.map((s) => `<section class="cat" id="${slug(s.label)}">
  <h2>${esc(s.label)}</h2>
  <a class="back" href="#top">↑ Back to summary</a>
  ${s.findings.map((f) => findingHtml(f, s.linkType)).join('\n')}
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

${totals.length ? `<h3>Where the money stands</h3>
<dl class="totals">${totals.map((t) => `<div><dt>${esc(t.label)}</dt><dd>${esc(t.value)}</dd></div>`).join('')}</dl>` : ''}

${characteristics.length ? `<section class="cat" id="across-the-board" style="page-break-before:avoid">
  <h2>Across the whole record set</h2>
  <p class="lede">Each of these is true of nearly every record of its kind, so they are
  almost certainly one decision each rather than a list to work through. They are the
  most important part of this report.</p>
  <table><thead><tr><th>Area</th><th>What we found</th><th class="num">Records</th><th class="num">Share</th></tr></thead><tbody>
  ${characteristics.map((c) => `<tr><td>${esc(c.category)}</td><td>${esc(c.title)}</td><td class="num">${c.count.toLocaleString()}</td><td class="num">${c.share}%</td></tr>`).join('')}
  </tbody></table>
</section>` : ''}

<nav class="toc"><strong>Then, record by record</strong><ol>${toc}</ol></nav>

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
