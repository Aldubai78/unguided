/**
 * Port of gymforge/prs_routes.py::record_pr validation logic.
 *
 * Contract: fixtures/record_pr.json
 *
 * A PR is manually entered user data (lift + weight or time). Rejection rule
 * (from the Python source — the inverse of a naive "must strictly beat"):
 *   - weight-based: reject if new < current_max  (EQUAL is a PR — Allen's rule)
 *   - time-based:   reject if new > current_min  (EQUAL is a PR)
 * Type consistency: a lift's type (weight vs time) is set by its first PR;
 * a later entry of the other type is rejected.
 *
 * Pure: takes the current best for the lift (or null) and the candidate;
 * returns the normalized stored record. Throws Error (mirrors Python
 * ValueError) on rejection so the harness can assert rejection.
 */

export type PrBest = {
  lift: string;
  weight: number | null;      // current max weight, or null
  time_value: number | null;  // current min time, or null
} | null;

export type PrInput = {
  lift: string;
  weight?: unknown;    // number or numeric string
  time_value?: unknown; // number or numeric string
  achieved_at?: string | null;
};

export type PrRecord = {
  lift: string;
  weight: number | null;
  time_value: number | null;
  achieved_at: string | null;
  is_time: boolean;
};

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validate a manual PR entry against the current best for its lift.
 *
 * @throws Error "not a PR — ..." when the candidate is worse than the best.
 */
export function recordPr(currentBest: PrBest, input: PrInput): PrRecord {
  const lift = (input.lift ?? "").trim();
  if (!lift) throw new Error("lift required");

  const isTime = input.time_value !== null && input.time_value !== undefined;
  const isWeight = input.weight !== null && input.weight !== undefined;
  if (!isTime && !isWeight) throw new Error("provide a weight or time");

  const weight = isWeight ? numOrNull(input.weight) : null;
  const time = isTime ? numOrNull(input.time_value) : null;
  if (isWeight && (weight === null || weight <= 0)) {
    throw new Error("weight must be a positive number");
  }
  if (isTime && (time === null || time <= 0)) {
    throw new Error("time must be a positive duration");
  }

  // Type consistency: first PR sets the lift's type.
  if (currentBest) {
    const priorIsTime = currentBest.time_value !== null;
    if (priorIsTime !== isTime) {
      const kind = isTime ? "time" : "weight";
      const other = isTime ? "weight" : "time";
      throw new Error(`${lift} is recorded as a ${other} lift — ${kind} not allowed for this lift`);
    }
  }

  // PR check: reject only if WORSE than the best. Equal = a PR (Allen's rule).
  if (isWeight && currentBest && currentBest.weight !== null) {
    if ((weight as number) < currentBest.weight) {
      throw new Error(`not a PR — ${lift} best is ${currentBest.weight} kg, this is ${weight} kg`);
    }
  }
  if (isTime && currentBest && currentBest.time_value !== null) {
    if ((time as number) > currentBest.time_value) {
      throw new Error(`not a PR — ${lift} best is ${currentBest.time_value}s, this is ${time}s`);
    }
  }

  return {
    lift,
    weight: isWeight ? weight : null,
    time_value: isTime ? time : null,
    achieved_at: input.achieved_at ?? null,
    is_time: isTime,
  };
}
