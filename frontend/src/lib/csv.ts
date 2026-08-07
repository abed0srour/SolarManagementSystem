/**
 * Minimal CSV reader for admin imports.
 *
 * Handles the parts real spreadsheet exports actually produce: quoted fields,
 * embedded commas and newlines inside quotes, doubled quotes as an escape,
 * semicolon delimiters (common in Excel under European locales), CRLF endings,
 * and a UTF-8 BOM. Not a full RFC 4180 implementation — enough to read a file
 * exported from Excel, Google Sheets or LibreOffice without a dependency.
 */

/** Split one delimited line, honouring quoted sections. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Split the whole file into logical rows, keeping newlines inside quotes. */
function splitRows(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        row += '""';
        i++;
        continue;
      }
      quoted = !quoted;
      row += c;
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (row.trim()) rows.push(row);
      row = '';
    } else {
      row += c;
    }
  }
  if (row.trim()) rows.push(row);
  return rows;
}

/**
 * Parse CSV text into objects keyed by header name.
 *
 * Header cells are normalised to lowercase with punctuation stripped, so
 * `Sale Price`, `sale_price` and `SALEPRICE` all arrive as `saleprice`.
 * Returns an empty array when the file has no data rows.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, ''); // strip BOM
  const rows = splitRows(clean);
  if (rows.length < 2) return [];

  // Excel exports semicolons in some locales — pick whichever the header uses more.
  const header = rows[0];
  const delimiter = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ';' : ',';

  const keys = splitLine(header, delimiter).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  return rows.slice(1).map((line) => {
    const cells = splitLine(line, delimiter);
    const obj: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k) obj[k] = cells[i] ?? '';
    });
    return obj;
  });
}

/** Read a number cell, returning undefined for blanks so defaults still apply. */
export function csvNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Read a boolean cell: yes/true/1/y accepted, anything else false. */
export function csvBool(v: string | undefined): boolean {
  return /^(1|true|yes|y)$/i.test((v ?? '').trim());
}
