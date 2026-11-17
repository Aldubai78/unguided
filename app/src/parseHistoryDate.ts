/**
 * Port of gymforge/opengym_routes.py::parse_history_date.
 *
 * Contract: fixtures/parse_history_date.json
 *
 * Returns a [year, month, day] triple (1-indexed month) or null when the
 * input is not a valid calendar date. NO `new Date(...)` on bare strings —
 * JS Date's ISO-vs-DMY ambiguity and UTC midnight shift would diverge from
 * Python. All parsing is done on raw string components.
 */

export type Ymd = [number, number, number];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

const DAYS_IN_MONTH = (y: number, m: number): number => {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 4: case 6: case 9: case 11: return 30;
    case 2: return isLeap(y) ? 29 : 28;
    default: return 0;
  }
};

function validDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > DAYS_IN_MONTH(y, m)) return false;
  return true;
}

/** Strip ordinal suffixes: "14th" -> "14", "1st" -> "1". */
function stripOrdinal(s: string): string {
  return s.replace(/(\d+)(st|nd|rd|th)\b/i, "$1");
}

/**
 * Parse a free-form date string into [y, m, d] or null.
 *
 * Faithful port of Python `parse_history_date(raw, default_year)`.
 * Order of attempts (exact match to Python):
 *  1. Y-M-D  "2026-06-14" / "2026/6/14"  (day-first swap when mo>12 and d<=12)
 *  2. D/M/YY "14/06/24" -> 2024, 6, 14   (2-digit year -> +2000; NO swap)
 *  3. D Month "14 June" / "14th Jun" / "14, June"  -> default_year
 *  4. Month D "June 14" / "June, 14"                -> default_year
 *  5. Bare Y-M "2026-06" / "2026-6" -> day 1
 *  6. else null
 *
 * Ordinals (st/nd/rd/th) are stripped up-front. Input is lowercased. Returns
 * null for anything that is not a real calendar date (e.g. "31/02/24").
 */
export function parseHistoryDate(raw: string, defaultYear?: number): Ymd | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const clean = stripOrdinal(s);
  const dy = defaultYear ?? new Date().getFullYear();

  // 1) Y-M-D (with day-first swap when the month slot is >12 and day <=12)
  let m = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    let y = +m[1]!, mo = +m[2]!, d = +m[3]!;
    if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; }
    return validDate(y, mo, d) ? [y, mo, d] : null;
  }

  // 2) D/M/YY or D/M/YYYY (day-first, no swap; 2-digit year -> +2000)
  m = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const d = +m[1]!, mo = +m[2]!;
    let y = +m[3]!;
    if (y < 100) y += 2000;
    return validDate(y, mo, d) ? [y, mo, d] : null;
  }

  // 3) D Month: "14 June", "14th Jun", "14, June"
  m = clean.match(/^(\d{1,2})(?:\s+|\s*,\s*)([a-z]+)\b/);
  if (m) {
    const mon = MONTHS[m[2]!];
    if (mon !== undefined) {
      return validDate(dy, mon, +m[1]!) ? [dy, mon, +m[1]!] : null;
    }
  }

  // 4) Month D: "June 14", "June, 14"
  m = clean.match(/^([a-z]+)\s*,?\s+(\d{1,2})\b/);
  if (m) {
    const mon = MONTHS[m[1]!];
    if (mon !== undefined) {
      return validDate(dy, mon, +m[2]!) ? [dy, mon, +m[2]!] : null;
    }
  }

  // 5) Bare Y-M: "2026-06" -> day 1
  m = clean.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) {
    return validDate(+m[1]!, +m[2]!, 1) ? [+m[1]!, +m[2]!, 1] : null;
  }

  return null;
}
