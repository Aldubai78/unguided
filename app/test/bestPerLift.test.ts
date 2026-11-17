/**
 * bestPerLift unit tests (S4 Step 2 gate).
 * Run: npx tsx --test test/bestPerLift.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestPerLift } from "../src/bestPerLift";
import type { Pr } from "../src/apiTypes";

// Helper: build a minimal Pr
function pr(lift: string, weight: number | null, time: number | null, date: string): Pr {
  return { member_id: 7, lift, weight, time_value: time, achieved_at: date, entry_id: null };
}

test("empty input → empty output", () => {
  assert.deepEqual(bestPerLift([]), []);
});

test("single PR → itself", () => {
  const p = pr("Back Squat", 200, null, "2026-10-01");
  const r = bestPerLift([p]);
  assert.equal(r.length, 1);
  assert.equal(r[0].lift, "Back Squat");
  assert.equal(r[0].weight, 200);
});

test("weight-based: highest weight wins", () => {
  // Most-recent-first: 200kg (newest) then 180kg (older)
  const r = bestPerLift([
    pr("Back Squat", 200, null, "2026-10-05"),
    pr("Back Squat", 180, null, "2026-10-01"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 200);
  assert.equal(r[0].achieved_at, "2026-10-05");
});

test("weight-based: highest wins even if older (input order doesn't matter for value)", () => {
  // 180kg is newer but 200kg is older — 200 should still win
  const r = bestPerLift([
    pr("Back Squat", 180, null, "2026-10-05"),
    pr("Back Squat", 200, null, "2026-10-01"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 200);
});

test("time-based: lowest time wins", () => {
  // 5:30 (330s) is better than 6:00 (360s)
  const r = bestPerLift([
    pr("Fran", null, 330, "2026-10-05"),
    pr("Fran", null, 360, "2026-10-01"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].time_value, 330);
});

test("time-based: lowest wins even if older", () => {
  const r = bestPerLift([
    pr("Fran", null, 360, "2026-10-05"),
    pr("Fran", null, 330, "2026-10-01"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].time_value, 330);
});

test("first-seen wins ties (weight)", () => {
  // Both 200kg — first in input (most recent) should win
  const newer = pr("Back Squat", 200, null, "2026-10-05");
  const older = pr("Back Squat", 200, null, "2026-10-01");
  const r = bestPerLift([newer, older]);
  assert.equal(r.length, 1);
  assert.equal(r[0].achieved_at, "2026-10-05"); // the newer one (first-seen)
});

test("first-seen wins ties (time)", () => {
  const newer = pr("Fran", null, 330, "2026-10-05");
  const older = pr("Fran", null, 330, "2026-10-01");
  const r = bestPerLift([newer, older]);
  assert.equal(r.length, 1);
  assert.equal(r[0].achieved_at, "2026-10-05");
});

test("case-insensitive grouping", () => {
  const r = bestPerLift([
    pr("Back Squat", 200, null, "2026-10-05"),
    pr("back squat", 180, null, "2026-10-01"),
    pr("BACK SQUAT", 190, null, "2026-09-15"),
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 200);
});

test("mixed lifts → all represented", () => {
  const r = bestPerLift([
    pr("Back Squat", 200, null, "2026-10-05"),
    pr("Deadlift", 250, null, "2026-10-04"),
    pr("Fran", null, 330, "2026-10-03"),
  ]);
  assert.equal(r.length, 3);
  const lifts = r.map((p) => p.lift.toLowerCase()).sort();
  assert.deepEqual(lifts, ["back squat", "deadlift", "fran"]);
});

test("type consistency: first PR sets the type, later mismatch is ignored", () => {
  // First PR is weight-based → later time-based entry is ignored
  const r = bestPerLift([
    pr("Back Squat", null, 330, "2026-10-05"),  // time-based (first)
    pr("Back Squat", 200, null, "2026-10-01"),   // weight-based (ignored)
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].time_value, 330);
  assert.equal(r[0].weight, null);
});

test("type consistency: weight first, time ignored", () => {
  const r = bestPerLift([
    pr("Back Squat", 200, null, "2026-10-05"),   // weight-based (first)
    pr("Back Squat", null, 330, "2026-10-01"),   // time-based (ignored)
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].weight, 200);
  assert.equal(r[0].time_value, null);
});

test("output order matches first-seen order in input", () => {
  // Input: Back Squat, Deadlift, Fran (in this order)
  const r = bestPerLift([
    pr("Back Squat", 200, null, "2026-10-05"),
    pr("Deadlift", 250, null, "2026-10-04"),
    pr("Fran", null, 330, "2026-10-03"),
    pr("Back Squat", 180, null, "2026-10-01"), // duplicate, should not affect order
  ]);
  assert.deepEqual(
    r.map((p) => p.lift),
    ["Back Squat", "Deadlift", "Fran"],
  );
});
