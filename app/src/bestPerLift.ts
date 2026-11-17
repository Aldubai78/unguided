/**
 * bestPerLift — the best PR per lift for a member.
 *
 * Direct port of 8001's `ogPrsBestByLift` (gymforge.html:1299).
 *
 * Given ALL PRs for a member (any order), returns the single best row per lift.
 * A "best" is:
 *   - weight-based: the HIGHEST weight
 *   - time-based:   the LOWEST time_value (seconds)
 *
 * Type consistency: a lift's type (weight vs time) is set by its FIRST PR
 * (in input order, which is most-recent-first). A later entry of the other
 * type is ignored (matches recordPr's type-consistency rule).
 *
 * Ties: first-seen wins. Since the input is most-recent-first, the newest PR
 * at the same value is the "best" (matches 8001: "the first we see at this
 * value is the one we keep").
 *
 * Pure: no store, no side effects. Testable.
 */
import type { Pr } from "./apiTypes";

export function bestPerLift(prs: Pr[]): Pr[] {
  if (!prs || prs.length === 0) return [];

  // liftKey -> { best: Pr, isTime: boolean }
  const byLift = new Map<string, { best: Pr; isTime: boolean }>();

  for (const pr of prs) {
    const key = pr.lift.trim().toLowerCase();
    if (!key) continue;

    const existing = byLift.get(key);

    // First PR for this lift: sets the type.
    if (!existing) {
      const isTime = pr.time_value != null;
      byLift.set(key, { best: pr, isTime });
      continue;
    }

    // Type consistency: skip if this PR's type doesn't match the lift's type.
    const prIsTime = pr.time_value != null;
    if (prIsTime !== existing.isTime) continue;

    // Compare within the same type.
    if (existing.isTime) {
      // time-based: lowest time wins; tie → keep first-seen (existing).
      const cur = pr.time_value ?? 0;
      const best = existing.best.time_value ?? Infinity;
      if (cur < best) {
        existing.best = pr;
      }
    } else {
      // weight-based: highest weight wins; tie → keep first-seen (existing).
      const cur = pr.weight ?? 0;
      const best = existing.best.weight ?? -Infinity;
      if (cur > best) {
        existing.best = pr;
      }
    }
  }

  return Array.from(byLift.values()).map((e) => e.best);
}
