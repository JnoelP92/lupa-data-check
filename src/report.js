// Renders a finished run. report.json is the structured record — every count, every
// flagged row, every field used to flag it — and is what a re-run diffs against.
// report.md is the same content for a human.
//
// The client-facing PDF is deliberately not produced here: section 5 requires
// judgement (softened language, Info stripped, internal config rules removed) and that
// pass happens in the skill, after the deployment team has reviewed the internal one.
import { writeFileSync } from 'node:fs';
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
    unavailable: ctx.meta.unavailable ?? {},
    summary: sections.map((s) => ({
      category: s.label,
      scanned: s.scanned,
      flagged: s.flagged,
      ...Object.fromEntries(SEVERITIES.map((sev) => [sev, s.counts[sev]])),
      skipped: s.skipped.length,
    })),
    sections,
  };
}

const pad = (v, n) => String(v ?? '').padEnd(n);

function mdTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (cells) => `| ${cells.map((c, i) => pad(c, widths[i])).join(' | ')} |`;
  return [line(headers), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
}

export function renderMarkdown(report) {
  const out = [];
  out.push(`# Data check — ${report.company.name}`);
  out.push('');
  out.push(`**Environment:** ${report.environment}  ·  **Ruleset:** v${report.rulesetVersion}  ·  **Generated:** ${report.generatedAt.slice(0, 16).replace('T', ' ')}`);
  out.push(`**Stores:** ${report.stores.map((s) => s.name).join(', ')}`);
  out.push('');

  if (Object.keys(report.unavailable).length) {
    out.push('> **Incomplete pull.** These reference sets were not readable with this key, so the rules that depend on them were skipped rather than passed:');
    for (const [k, v] of Object.entries(report.unavailable)) out.push(`> - \`${k}\` — ${v.split('\n')[0]}`);
    out.push('');
  }

  out.push('## Summary');
  out.push('');
  out.push(mdTable(
    ['Category', 'Scanned', 'Flagged', 'Critical', 'Review', 'Info'],
    report.summary.map((s) => [s.category, s.scanned, s.flagged, s.critical, s.review, s.info]),
  ));
  out.push('');

  for (const section of report.sections) {
    out.push(`## ${section.label}`);
    out.push('');
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
        const group = section.findings.filter((f) => f.severity === sev);
        if (!group.length) continue;
        out.push(`#### ${sev[0].toUpperCase()}${sev.slice(1)}`);
        out.push('');
        for (const finding of group) {
          const count = finding.truncatedTo ? `${finding.truncatedTo} of ${finding.total}` : finding.total;
          out.push(`**${finding.title}** — ${count}`);
          if (finding.why) out.push(`*${finding.why}*`);
          out.push('');
          const fieldKeys = [...new Set(finding.rows.flatMap((r) => Object.keys(r.fields)))];
          const headers = ['Name', ...fieldKeys, ...(finding.grouped ? ['Shared with'] : []), 'Open in Lupa'];
          out.push(mdTable(headers, finding.rows.map((r) => {
            const l = link(finding.linkType ?? section.linkType, { id: r.id, ...r.fields });
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

export function writeReport(dir, report) {
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'report.md'), renderMarkdown(report));
  return { json: join(dir, 'report.json'), md: join(dir, 'report.md') };
}
