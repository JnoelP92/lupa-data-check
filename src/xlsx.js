// A minimal multi-sheet .xlsx writer.
//
// An xlsx is a zip of XML parts. Everything here uses inline strings rather than a
// shared-string table, which costs some file size and saves a whole index — fine for
// findings exports, which are read once and thrown away.
//
// Written by hand because this repo has no runtime dependencies and is not about to
// gain one for a spreadsheet. src/zip.js builds the container, so this works on Windows
// too — shelling out to `zip` had quietly made the whole export macOS-and-Linux only.
import { writeZip } from './zip.js';

const esc = (v) => String(v ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A1, B1 … Z1, AA1 …
function cellRef(col, row) {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s + row;
}

// Excel: 31 chars max, and none of : \ / ? * [ ]
function safeSheetName(name, taken) {
  let base = String(name).replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet';
  let candidate = base, n = 2;
  while (taken.has(candidate)) {
    const suffix = `~${n++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate);
  return candidate;
}

// links: [{ row, col, url }] with row/col zero-based over the data rows.
function sheetXml({ headers, rows, links = [] }) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
    '<sheetData>',
  ];
  const row = (cells, r, style) => {
    const parts = cells.map((c, i) => {
      const num = typeof c === 'number' && Number.isFinite(c);
      return num
        ? `<c r="${cellRef(i, r)}"${style}><v>${c}</v></c>`
        : `<c r="${cellRef(i, r)}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
    });
    return `<row r="${r}">${parts.join('')}</row>`;
  };
  out.push(row(headers, 1, ' s="1"'));
  rows.forEach((r, i) => out.push(row(r, i + 2, '')));
  out.push('</sheetData>');
  if (links.length) {
    out.push('<hyperlinks>');
    links.forEach((l, i) => out.push(`<hyperlink ref="${cellRef(l.col, l.row + 2)}" r:id="rId${i + 1}"/>`));
    out.push('</hyperlinks>');
  }
  out.push('</worksheet>');
  return out.join('');
}

// sheets: [{ name, headers: string[], rows: (string|number)[][] }]
export function writeXlsx(path, sheets) {
  if (!sheets.length) return null;

  const taken = new Set();
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, taken) }));
  const files = [];

  files.push({ name: '[Content_Types].xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>' });

  files.push({ name: '_rels/.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>' });

  files.push({ name: 'xl/workbook.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>' });

  files.push({ name: 'xl/_rels/workbook.xml.rels', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>' });

  // One style beyond the default: bold, for the frozen header row.
  files.push({ name: 'xl/styles.xml', data:
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders count="1"><border/></borders>'
    + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
    + '<cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" applyFont="1"/></cellXfs>'
    + '</styleSheet>' });

  named.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) });
    const links = s.links ?? [];
    if (!links.length) return;
    files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data:
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + links.map((l, j) => `<Relationship Id="rId${j + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(l.url)}" TargetMode="External"/>`).join('')
      + '</Relationships>' });
  });

  writeZip(path, files);
  return { path, sheets: named.length, rows: named.reduce((t, s) => t + s.rows.length, 0) };
}
