// dialDate.ts — shared calendar helpers for the date dials.
//
// PRs and EnterWorkout each had their own copy of daysInMonth/clampDate
// (the real DRY win behind Dials v2). One source of truth now.
//
// Behavior is a faithful port of the screens' prior logic: it clamps month to
// 1-12 and year to 2000-2099 (the dial ranges) AND clamps day to the month's
// real length, flooring day at 1. So a dial landing on 31/02 or 45/06 or
// 20999 all collapse to a valid date. Returns {d, m, y} to match the call
// sites — do NOT change the key shape.

/** Real length of a month. month is 1-12 (Jan=1). new Date(y, m, 0) is the
 *  last day of month `m` (the 0th day rolls back into the previous month). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Clamp a possibly-invalid (d, m, y) to a valid date within the dial ranges.
 *  month -> 1-12, year -> 2000-2099, day -> 1..daysInMonth. Returns {d,m,y}. */
export function clampDate(year: number, month: number, day: number): { d: number; m: number; y: number } {
  const mm = Math.min(12, Math.max(1, month));
  const yy = Math.min(2099, Math.max(2000, year));
  const dd = Math.min(daysInMonth(yy, mm), Math.max(1, day));
  return { d: dd, m: mm, y: yy };
}
