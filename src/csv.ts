/**
 * Reads the engine's CSV exports (RFC 4180: quoted cells, "" escapes, newlines inside quotes).
 * A cut-off last line (export read up to a byte cap) is dropped, never half-parsed.
 */
export function parseCsv(text: string, truncated = false): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  // A last line without its newline is complete only when the file was read to the end.
  if (!truncated && (cell !== '' || row.length)) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]!])));
}
