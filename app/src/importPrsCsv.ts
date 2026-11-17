/**
 * Port of gymforge/prs_routes.py::import_prs_csv.
 *
 * Contract: fixtures/import_prs_csv.json (generated from the live 8002 Python
 * function, byte-for-byte).
 *
 * The PR CSV is 3 columns (date, lift/benchmark, weight/time). Value is
 * auto-detected: contains ':' -> time (M:SS / H:MM:SS, -> total seconds),
 * else weight (kg, float). Rules (exact match to Python):
 *   - Short rows are padded with "".
 *   - Header skip ONLY when the first cell is non-blank AND not parseable as a
 *     date (the header check runs the PR-specific 3-branch parser with the
 *     default year, NOT today — see _parseDatePr below).
 *   - Date: no year -> defaultYear (today's year); blank -> carry-forward from
 *     the previous row; first row with a blank date -> today.
 *   - lift of "" or "-" -> skipped + counted.
 *   - value of "" or "-" -> skipped + counted.
 *   - value: strip " kg", lowercase. ':' -> time (regex-validated, then
 *     parseTimeValue); else float weight (must be > 0).
 *   - Duplicates (lift lowercased + weight + time_value + date, case/whitespace
 *     -insensitive) are skipped + counted — but ONLY within the file. Python's
 *     import_prs_csv has NO existing-rows parameter and never looks at the DB;
 *     it dedups against an in-file `seen` set. This port is byte-identical to
 *     that. Skipping PRs that already exist ON THE DEVICE is a UI-layer concern
 *     (STEP 5: diff against localStore.listPrs()), NOT part of the Python
 *     contract.
 *   - Friendly-with-report: good rows import, bad rows listed with 1-based line
 *     numbers.
 *
 * PURE: takes the CSV text and returns
 * {imported, skipped, errors, rows}. `rows` are the PRs to insert (achieved_at
 * normalized to the same `%04d-%02d-%02dT00:00:00.000Z` shape Python writes).
 * No storage, no network.
 */

export type PrImportError = { line: number; reason: string };

export type PrImportRow = {
  /** Stored exactly as Python writes: "%04d-%02d-%02dT00:00:00.000Z". */
  achieved_at: string;
  lift: string;
  weight: number | null;
  time_value: number | null;
};

export type PrImportResult = {
  imported: number;
  skipped: number;
  errors: PrImportError[];
  rows: PrImportRow[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Faithful port of Python's datetime.date(y, m, d) validity (calendar only). */
function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y: number, m: number): number {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 4: case 6: case 9: case 11: return 30;
    case 2: return isLeap(y) ? 29 : 28;
    default: return 0;
  }
}
function okDate(y: number, mo: number, d: number): [number, number, number] | null {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return [y, mo, d];
}

/**
 * Port of the PR parser's INNER _parse_date (3 branches only — NOT the richer
 * history parser). Lowercases, strips ordinals, then tries:
 *   1. Y-M-D (with day-first swap when mo>12 and d<=12)
 *   2. D/M/YY (2-digit year -> +2000; no swap)
 *   3. D Month  "14 June" / "14, June"  -> default_year
 * Returns [y,m,d] or null.
 */
function parseDatePr(raw: string, defaultYear: number): [number, number, number] | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/(\d{1,2})(st|nd|rd|th)\b/, "$1");

  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    let y = +m[1]!, mo = +m[2]!, d = +m[3]!;
    if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
    return okDate(y, mo, d);
  }
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const d = +m[1]!, mo = +m[2]!;
    let y = +m[3]!;
    if (y < 100) y += 2000;
    return okDate(y, mo, d);
  }
  m = s.match(/^(\d{1,2})(?:\s+|\s*,\s*)([a-z]+)\b/);
  if (m) {
    const mon = MONTHS[m[2]!];
    if (mon !== undefined) return okDate(defaultYear, mon, +m[1]!);
  }
  return null;
}

/**
 * Port of prs_routes.py::parse_time_value — 'M:SS' / 'MM:SS' / 'H:MM:SS'
 * -> total seconds. NOTE: the Python function accepts a single "5" (-> 300s),
 * but the import caller only ever reaches it after the `^\d{1,3}(:\d{1,2}){1,2}$`
 * regex gate (which requires at least one ':'), so the len==1 branch is
 * unreachable from import_prs_csv. Ported faithfully regardless.
 */
function parseTimeValue(input: string): number {
  const s = (input ?? "").trim();
  const parts = s.split(":");
  const digits = (p: string) => /^\d+$/.test(p.trim());
  if (parts.length < 1 || parts.length > 3 || !parts.every(digits)) {
    throw new Error("time must be M:SS (e.g. 5:34)");
  }
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.length === 1) return nums[0]! * 60;
  if (nums.length === 2) {
    if (nums[1]! >= 60) throw new Error("seconds must be 0-59");
    return nums[0]! * 60 + nums[1]!;
  }
  if (nums[1]! >= 60 || nums[2]! >= 60) throw new Error("time format must be H:MM:SS");
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

/** Pad to a 4-char zero-padded integer: 6 -> "0006". */
function p4(n: number): string {
  return String(n).padStart(4, "0");
}
function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Port of import_prs_csv. `existing` are the rows already on device (used to
 * seed the dedup set so an import never double-inserts a PR the user already
 * has). Returns the parsed result; call the storage layer to insert `rows`.
 */
export function importPrsCsv(
  text: string,
  defaultYear?: number,
  today?: [number, number, number],
): PrImportResult {
  const dy = defaultYear ?? new Date().getFullYear();
  // `today` is injectable so the conformance test can pin it to the same
  // FIXED_TODAY the generator monkeypatched into Python's date.today().
  // Without it, the blank-first-row fallback emits the real today and drifts
  // from the fixture every day (the generator's documented design is to pin
  // BOTH sides to the same date).
  const now = new Date();
  const t = today ?? [now.getFullYear(), now.getMonth() + 1, now.getDate()];

  // Strip a leading BOM (Excel adds one; it corrupts the first header name)
  // and split on CRLF/CR/LF (Excel exports CRLF).
  const stripped = String(text ?? "").replace(/^\uFEFF/, "");
  const lines = stripped.split(/\r\n|\r|\n/);
  // Python: [line for line in text.splitlines() if line.strip() != ""]
  const nonBlank = lines.filter((l) => l.trim() !== "");

  // Python csv.reader on each line.
  const rows: string[][] = nonBlank.map((line) => splitCsvLine(line));

  let dataStart = 0;
  if (rows.length > 0 && (rows[0]![0] ?? "").trim() !== "" && parseDatePr(rows[0]![0] ?? "", dy) === null) {
    dataStart = 1; // header row
  }

  const imported: number[] = []; // (line, weight, time) not needed; just count
  let importedCount = 0;
  let skipped = 0;
  const errors: PrImportError[] = [];
  const outRows: PrImportRow[] = [];

  // In-file dedup set only (matches Python's `seen`). Device-level dedup is a
  // UI-layer concern (see file header).
  const seen = new Set<string>();

  let prevDate: [number, number, number] | null = null;

  for (let idx = dataStart; idx < rows.length; idx++) {
    const row = rows[idx]!;
    const lineNo = idx + 1; // 1-based line, matches Python enumerate(start=data_start+1)
    if (!row.length || row.every((c) => (c ?? "").trim() === "")) continue;

    const cells: string[] = [];
    for (let k = 0; k < 3; k++) cells.push(k < row.length ? (row[k] ?? "").trim() : "");
    const dateRaw = cells[0]!;
    const lift = cells[1]!;
    const val = cells[2]!;

    let d = parseDatePr(dateRaw, dy);
    if (d === null && dateRaw === "") d = prevDate; // carry-forward
    if (d === null) d = [...t]; // no date anywhere -> today (pinned or real)
    prevDate = d;

    if (lift === "" || lift === "-") { skipped++; continue; }
    if (val === "" || val === "-") { skipped++; continue; }

    const v = val.toLowerCase().replace(" kg", "").trim();
    let weight: number | null;
    let timeValue: number | null;
    if (v.includes(":")) {
      if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(v)) {
        errors.push({ line: lineNo, reason: "bad time (need M:SS)" });
        continue;
      }
      weight = null;
      // parseTimeValue throws on bad time (seconds>=60 / bad hour) — and we do
      // NOT catch it, exactly like Python's import_prs_csv (the regex gate is
      // not a complete guard; e.g. 5:75 raises). Faithful to the live 8002
      // behaviour, including its latent "raise instead of report" bug.
      timeValue = parseTimeValue(v);
    } else {
      const parsed = Number(v);
      if (!isFinite(parsed) || (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) && !/^\d*\.?\d+$/.test(v))) {
        // Python float(v) raises ValueError for non-numeric strings.
        errors.push({ line: lineNo, reason: "unparseable value" });
        continue;
      }
      weight = parsed;
      if (weight <= 0) {
        errors.push({ line: lineNo, reason: "weight must be positive" });
        continue;
      }
      timeValue = null;
    }

    const key = dedupKey(lift, weight, timeValue, iso(d));
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    const achieved = `${p4(d[0])}-${p2(d[1])}-${p2(d[2])}T00:00:00.000Z`;
    outRows.push({ achieved_at: achieved, lift, weight, time_value: timeValue });
    importedCount++;
  }

  return { imported: importedCount, skipped, errors, rows: outRows };
}

/** Python csv.reader for a single line: handles double-quoted fields + commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Dedup key mirrors Python's (lift.strip().lower(), weight, time_value,
 * date.isoformat()). weight/time are compared by exact value (null vs 0 vs
 * NaN distinct), so we canonicalize: null -> "null", numbers -> String(n).
 */
function dedupKey(
  lift: string,
  weight: number | null,
  time: number | null,
  dateIso: string,
): string {
  const w = weight === null ? "null" : String(weight);
  const t = time === null ? "null" : String(time);
  return `${lift.trim().toLowerCase()}|${w}|${t}|${dateIso}`;
}

/** ISO (YYYY-MM-DD) from a [y,m,d] triple. */
function iso(d: [number, number, number]): string {
  return `${p4(d[0])}-${p2(d[1])}-${p2(d[2])}`;
}


