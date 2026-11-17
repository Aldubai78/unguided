/**
 * Port of gymforge/opengym_routes.py::import_history_csv.
 *
 * Contract: fixtures/import_history_csv.json
 *
 * The history CSV is a free-text workout log: each row is a date plus up to
 * three verbatim string columns (c1, c2, c3). NO parsing of weights/lifts.
 * Rules (exact match to Python):
 *   - 4 columns: date, c1, c2, c3. Short rows are padded with "".
 *   - Header skip ONLY when the first cell is non-blank AND unparseable as a date.
 *   - Blank date -> inherit previous row's date (carry-forward).
 *   - First row with blank/unparseable date -> error "no date (first row)".
 *   - Unparseable non-blank date -> error "unparseable date".
 *   - Date-only rows (all c1..c3 blank) -> skipped (not imported, not error).
 *   - Duplicates (member+date+c1+c2+c3, case/whitespace-insensitive) -> skipped.
 *   - Friendly-with-report: good rows import, bad rows listed with 1-based line numbers.
 *
 * Pure: takes the CSV text and returns {imported, skipped, errors, rows}.
 * `rows` are the stored records (date_iso + the three verbatim strings).
 */

import { parseHistoryDate, type Ymd } from "./parseHistoryDate.js";

export type ImportRow = {
  date_iso: string;
  c1: string;
  c2: string;
  c3: string;
};

export type ImportError = { line: number; reason: string };

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: ImportError[];
  rows: ImportRow[];
};

function iso(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

/** Minimal CSV line splitter honoring double-quoted fields (Python csv.reader). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Import a history CSV.
 * @param text  the raw CSV
 * @param defaultYear  year for year-less dates (default: current year)
 */
export function importHistoryCsv(text: string, defaultYear?: number, existingDetails?: Set<string>): ImportResult {
  const lines = (text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows = lines.map(splitCsvLine);
  const dy = defaultYear ?? new Date().getFullYear();

  // Header skip ONLY when first cell is non-blank AND unparseable as a date.
  let dataStart = 0;
  if (rows.length > 0) {
    const first = (rows[0]![0] ?? "").trim();
    if (first !== "" && parseHistoryDate(first, dy) === null) {
      dataStart = 1;
    }
  }

  let imported = 0;
  let skipped = 0;
  const errors: ImportError[] = [];
  let prevYmd: Ymd | null = null;
  const seen = new Set<string>();
  // Mirrors Python's `exists` DB check (line 210): SELECT 1 FROM workout_logs
  // WHERE member_id=? AND details=?  -- the date is NOT in the WHERE clause.
  // So a later row with the same c1+c2+c3 but a different date skips if an
  // earlier same-details row was already inserted into the batch. Keyed on
  // member+details only (no date).
  const seenDetails = new Set<string>();
  const stored: ImportRow[] = [];

  // 1-based line numbers matching Python's enumerate(rows[data_start:], start=data_start+1).
  for (let i = 0; i < rows.length - dataStart; i++) {
    const lineNo = dataStart + i + 1;
    const row = rows[dataStart + i]!;
    if (row.length === 0 || row.every((c) => (c ?? "").trim() === "")) continue;

    const cells = [...row.map((c) => (c ?? "").trim()), "", "", ""].slice(0, 4);
    const [dateRaw, c1, c2, c3] = [cells[0]!, cells[1]!, cells[2]!, cells[3]!];

    let ymd = parseHistoryDate(dateRaw, dy);
    if (ymd === null && dateRaw === "" && prevYmd !== null) {
      ymd = prevYmd; // carry-forward: blank inherits the row above
    }
    if (ymd === null) {
      errors.push({ line: lineNo, reason: dateRaw ? "unparseable date" : "no date (first row)" });
      continue;
    }
    prevYmd = ymd;

    if (c1 === "" && c2 === "" && c3 === "") continue; // date-only row

    // Dedup key: member|date|c1|c2|c3, case/whitespace-insensitive.
    const key = `0|${iso(ymd[0], ymd[1], ymd[2])}|${c1.trim().toLowerCase()}|${c2.trim().toLowerCase()}|${c3.trim().toLowerCase()}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    // DB exists check (Python line 210): SELECT 1 FROM workout_logs WHERE
    // member_id=? AND details=?  -- the `details` JSON is matched VERBATIM
    // (case-sensitive, exact string), and the date is NOT in the WHERE clause.
    // So the key must use the raw (trim-only, NO case-fold) strings to be
    // byte-exact with Python's json_dumps([{"c1":c1,"c2":c2,"c3":c3}]).
    // seenDetails holds only details of rows actually INSERTED (matches the
    // temp-DB state Python queries), so .add() happens after the checks.
    const detailsKey = `0|${c1}|${c2}|${c3}`;
    if (seenDetails.has(detailsKey) || (existingDetails && existingDetails.has(key))) {
      skipped++;
      continue;
    }
    seen.add(key);
    seenDetails.add(detailsKey);

    stored.push({ date_iso: iso(ymd[0], ymd[1], ymd[2]), c1, c2, c3 });
    imported++;
  }

  return { imported, skipped, errors, rows: stored };
}
