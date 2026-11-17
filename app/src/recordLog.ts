/**
 * Port of gymforge/workout_logs.py::_num_weight, _sets_ok, and the
 * `total` computation in record_log.
 *
 * Contract: fixtures/record_log.json  (the `total_score` field)
 *
 * Float semantics MUST match Python's `sum()`:
 *   - JS `+` and Python `+` are both IEEE-754 double addition, so
 *     `0.1 + 0.2 === 0.30000000000000004` on both sides. We rely on that and
 *     never "clean" the result.
 *   - Python `float(str)` succeeds on "77.5" and fails on "70 -> 77.5".
 *     JS `parseFloat` would GRAB the leading 70 — a known port trap. We use a
 *     strict full-string parse to match Python.
 */

export type Set = { lift?: string; weight?: unknown; reps?: unknown; [k: string]: unknown };

/**
 * Match Python `workout_logs._num_weight`:
 *   - number -> as-is
 *   - string -> float(s) if the WHOLE string is a finite number, else None
 *   - anything else -> None
 */
export function numWeight(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (typeof w === "string") {
    const t = w.trim();
    if (t === "") return null;
    // Full-string numeric parse (Python float() semantics, not parseFloat).
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Match Python `workout_logs._sets_ok`: sets must be a list of dicts each
 * carrying a `lift` (string). Empty list is allowed (returns true).
 */
export function setsOk(sets: unknown): boolean {
  if (!Array.isArray(sets)) return false;
  if (sets.length === 0) return true;
  return sets.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Set).lift === "string",
  );
}

/**
 * total_score for a record_log call.
 * Python: `sum(w for w in (num_weight(s.weight) for s in sets) if w is not None) if sets else 0`
 */
export function totalScore(sets: Set[]): number {
  if (!sets || sets.length === 0) return 0;
  let total = 0;
  for (const s of sets) {
    const w = numWeight(s.weight);
    if (w !== null) total += w;
  }
  return total;
}
