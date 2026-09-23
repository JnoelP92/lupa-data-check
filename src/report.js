// Renders a finished run. report.json is the structured record — every count, every
// flagged row, every field used to flag it — and is what a re-run diffs against.
// report.md is the same content for a human.
//
// The client-facing PDF is deliberately not produced here: section 5 requires
// judgement (softened language, Info stripped, internal config rules removed) and that
// pass happens in the skill, after the deployment team has reviewed the internal one.
import { writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { SEVERITIES } from './rules/index.js';
import { link } from './links.js';

export function buildReport(ctx, sections) {
  return {
    rulesetVersion: ctx.meta.rulesetVersion,
    generatedAt: new Date().toISOString(),
    environment: ctx.meta.environment,
    company: ctx.meta.company,
    stores: ctx.meta.stores,
    pull: { startedAt: ctx.meta.startedAt, finishedAt: ctx.meta.finishedAt, requests: ctx.meta.requestCount },
    money: ctx.money ?? null,
    unavailable: ctx.meta.unavailable ?? {},
    notChecked: sections.filter((s) => s.empty).map((s) => s.label),
    characteristics: sections.flatMap((s) => s.findings.filter((f) => f.systemic).map((f) => ({
      category: s.label, rule: f.id, title: f.title, severity: f.severity,
      count: f.total, share: f.share, of: s.scanned,
    }))).sort((a, b) => b.share - a.share),
    summary: sections.map((s) => ({
      category: s.label,
      scanned: s.scanned,
      flagged: s.flagged,
      ...Object.fromEntries(SEVERITIES.map((sev) => [sev, s.counts[sev]])),
      systemic: s.systemicCount ?? 0,
      skipped: s.skipped.length,
      empty: Boolean(s.empty),
    })),
    sections,
  };
}

const pad = (v, n) => String(v ?? '').padEnd(n);

// Built with loops rather than argument spreads. `Math.max(...rows.map(...))` and
// `[...rows.map(line)]` both pass one argument per row, which blows the call stack
// somewhere in the tens of thousands — and a real practice produces findings that big.
function mdTable(headers, rows) {
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < widths.length; i++) {
      const len = String(row[i] ?? '').length;
      if (len > widths[i]) widths[i] = len;
    }
  }
  const line = (cells) => `| ${cells.map((c, i) => pad(c, widths[i])).join(' | ')} |`;
  const out = [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

export function renderMarkdown(report) {
  const out = [];
  out.push(`# Data check — ${report.company.name}`);
  out.push('');
  out.push(`**Environment:** ${report.environment}  ·  **Ruleset:** v${report.rulesetVersion}  ·  **Generated:** ${report.generatedAt.slice(0, 16).replace('T', ' ')}`);
  out.push(`**Stores:** ${report.stores.map((s) => s.name).join(', ')}`);
  if (report.money) {
    out.push(`**Money:** read as ${report.money.units} units — ${report.money.reason}`);
  }
  out.push('');

  if (Object.keys(report.unavailable).length) {
    out.push('> **Incomplete pull.** These reference sets were not readable with this key, so the rules that depend on them were skipped rather than passed:');
    for (const [k, v] of Object.entries(report.unavailable)) out.push(`> - \`${k}\` — ${v.split('\n')[0]}`);
    out.push('');
  }

  if (report.notChecked?.length) {
    out.push(`> **${report.notChecked.length} categories returned no records at all** and were therefore not checked:`);
    out.push(`> ${report.notChecked.join(', ')}.`);
    out.push('> ');
    out.push('> This is not a clean result for those categories. Either the data has not been');
    out.push('> migrated yet, or this key cannot see it. Resolve which before signing anything off.');
    out.push('');
  }

  out.push('## Summary');
  out.push('');
  out.push(mdTable(
    ['Category', 'Scanned', 'Critical', 'Review', 'Info', 'Whole-dataset'],
    report.summary.map((s) => [
      s.category, s.empty ? '0 — NOT CHECKED' : s.scanned.toLocaleString(),
      s.empty ? '—' : s.critical.toLocaleString(), s.empty ? '—' : s.review.toLocaleString(),
      s.empty ? '—' : s.info.toLocaleString(), s.empty ? '—' : (s.systemic || ''),
    ]),
  ));
  out.push('');
  out.push('Critical, Review and Info count records you can work through. The last column');
  out.push('counts findings that apply to most or all of the category — those are listed');
  out.push('below as characteristics, because they describe the migration rather than');
  out.push('pick out exceptions within it.');
  out.push('');

  if (report.characteristics?.length) {
    out.push('## Characteristics of this dataset');
    out.push('');
    out.push('Each of these is true of most or all of its category. They are usually one');
    out.push('decision each, not a list to work through — but they are the most consequential');
    out.push('things in this report, because they say what the migration did not carry.');
    out.push('');
    out.push(mdTable(
      ['Category', 'Finding', 'Records', 'Share'],
      report.characteristics.map((c) => [c.category, c.title, c.count.toLocaleString(), `${c.share}%`]),
    ));
    out.push('');
  }

  for (const section of report.sections) {
    out.push(`## ${section.label}`);
    out.push('');
    if (section.empty) {
      out.push('**No records returned. Nothing was checked.** Treat this as an open question,');
      out.push('not as a pass.');
      out.push('');
      continue;
    }
    out.push('### Tally');
    out.push('');
    for (const item of section.tally) {
      if (item.breakdown) {
        if (out[out.length - 1] !== '') out.push('');
        out.push(`**${item.label}**`);
        out.push('');
        const hasExtra = item.breakdown.some((b) => b.extra !== undefined);
        out.push(mdTable(
          hasExtra ? ['Value', 'Count', 'Value £'] : ['Value', 'Count'],
          item.breakdown.map((b) => (hasExtra ? [b.label, b.count, b.extra ?? ''] : [b.label, b.count])),
        ));
        out.push('');
      } else {
        out.push(`- ${item.label}: **${item.value}**`);
      }
    }
    out.push('');

    if (!section.findings.length) {
      out.push('### Investigate');
      out.push('');
      out.push('Nothing flagged.');
      out.push('');
    } else {
      out.push('### Investigate');
      out.push('');
      for (const sev of SEVERITIES) {
        const group = section.findings.filter((f) => f.severity === sev && !f.systemic);
        if (!group.length) continue;
        out.push(`#### ${sev[0].toUpperCase()}${sev.slice(1)}`);
        out.push('');
        for (const finding of group) {
          if (finding.systemic) continue; // already covered under Characteristics
          const count = finding.truncatedTo ? `${finding.truncatedTo} of ${finding.total.toLocaleString()}` : finding.total.toLocaleString();
          const groups = finding.groupCount ? ` across ${finding.groupCount.toLocaleString()} group${finding.groupCount === 1 ? '' : 's'}` : '';
          out.push(`**${finding.title}** — ${count}${groups}`);
          if (finding.why) out.push(`*${finding.why}*`);
          out.push('');
          const fieldKeys = [...new Set(finding.rows.flatMap((r) => Object.keys(r.fields)))];
          const headers = ['Name', ...fieldKeys, ...(finding.grouped ? ['Shared with'] : []), 'Open in Lupa'];
          out.push(mdTable(headers, finding.rows.map((r) => {
            const l = r.link ?? link(finding.linkType ?? section.linkType, { id: r.id, ...r.fields });
            const open = l.url ? `[Open ↗](${l.url})${l.search ? ` — search \`${l.search}\`` : ''}` : '—';
            return [r.display, ...fieldKeys.map((k) => r.fields[k]), ...(finding.grouped ? [r.reason ?? ''] : []), open];
          })));
          if (finding.truncatedTo) out.push(`\n_Showing the first ${finding.truncatedTo} of ${finding.total}. Full list in report.json._`);
          out.push('');
        }
      }
    }

    if (section.skipped.length) {
      out.push('### Skipped');
      out.push('');
      for (const s of section.skipped) out.push(`- **${s.title}** — ${s.reason}`);
      out.push('');
    }
  }

  return out.join('\n');
}

// report.json carries a capped sample per finding so it stays openable; findings.jsonl
// carries every flagged record, one per line, so nothing is lost and the file streams.
// A rule matching 80,000 invoices would otherwise produce a JSON nobody can load.
export function writeReport(dir, report) {
  const rows = createWriteStream(join(dir, 'findings.jsonl'));
  let written = 0;
  for (const section of report.sections) {
    for (const finding of section.findings) {
      for (const row of finding.allRows ?? finding.rows) {
        rows.write(JSON.stringify({
          category: section.key, rule: finding.id, severity: finding.severity,
          title: finding.title, ...row,
        }) + '\n');
        written++;
      }
      delete finding.allRows; // never serialised into report.json
    }
  }
  rows.end();

  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(report));
  return { json: join(dir, 'report.json'), md: join(dir, 'report.md'), rows: join(dir, 'findings.jsonl'), rowCount: written };
}
