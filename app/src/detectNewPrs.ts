/**
 * Port of gymforge/workout_logs.py::detect_new_prs.
 *
 * Contract: fixtures/detect_new_prs.json
 *
 * Given the member's existing PR bests and the sets in a new log, return the
 * list of lifts for which the new set sets a new personal record.
 *
 * Rules (matching Python):
 *   - weight is normalized via numWeight (full-string numeric; free-text -> null)
 *   - a set with no usable weight is ignored
 *   - new > current best  (strict; a tie is NOT a PR)
 *   - no current best for that lift -> first set is a PR
 *   - lifts are compared case-insensitively
 *   - result is the list of lift names (first occurrence per lift, in order)
 */

import { numWeight, type Set } from "./recordLog.js";

export type PrBest = { lift: string; weight: number };

/**
 * @param bests  existing PR bests for the member (lift -> weight)
 * @param sets   the sets in the new workout log
 * @returns lifts that set a new PR, in first-occurrence order
 */
export function detectNewPrs(bests: PrBest[], sets: Set[]): string[] {
  if (!sets || sets.length === 0) return [];

  const bestByLift = new Map<string, number>();
  for (const b of bests) {
    const key = b.lift.toLowerCase();
    const prev = bestByLift.get(key);
    if (prev === undefined || b.weight > prev) bestByLift.set(key, b.weight);
  }

  const found = new Set<string>();
  const result: string[] = [];
  for (const s of sets) {
    const lift = (s.lift ?? "").trim();
    if (!lift) continue;
    const w = numWeight(s.weight);
    if (w === null) continue;
    const key = lift.toLowerCase();
    if (found.has(key)) continue;
    const best = bestByLift.get(key);
    if (best === undefined || w > best) {
      found.add(key);
      result.push(lift);
    }
  }
  return result;
}
