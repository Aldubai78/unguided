/**
 * calcMath.ts — Pure Brzycki 1RM math (S6 Percentage Calculator).
 *
 * Port of the client-side JS in 8001 gymforge.html (lines 1195–1270).
 * No persistence, no server, no side effects. Stateless math only.
 *
 * Formula: 1RM = weight / (1.0278 − 0.0278 × reps)  (Brzycki, 1995)
 */

/** Round to 1 decimal place (matches 8001's ogCalcRound1). */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Brzycki 1RM estimate.
 * Returns null when the input is invalid (weight ≤ 0, reps < 1,
 * or denominator ≤ 0 which happens at very high rep counts).
 */
export function brzycki1rm(weight: number, reps: number): number | null {
  if (!(weight > 0) || !(reps >= 1)) return null;
  const denom = 1.0278 - 0.0278 * reps;
  if (denom <= 0) return null;
  return weight / denom;
}

/** Compute weight for a given % of 1RM. Returns null if 1RM is null. */
export function pctWeight(one: number | null, pct: number): number | null {
  if (one == null || !(pct > 0)) return null;
  return round1((one * pct) / 100);
}

/**
 * Fixed percentage grid: 3 columns × 4 rows, col-major (no duplicates).
 *   col1: 100  85  70  55
 *   col2:  95  80  65  50
 *   col3:  90  75  60  45
 *
 * CSS grid fills row-first, so we emit cells in row-major order,
 * pulling each value from its column array so columns read top→bottom.
 */
export const GRID_COLS: number[][] = [
  [100, 85, 70, 55],
  [95, 80, 65, 50],
  [90, 75, 60, 45],
];

/** Number of rows in the fixed grid (length of the first column). */
export const GRID_ROWS: number = GRID_COLS[0].length;
