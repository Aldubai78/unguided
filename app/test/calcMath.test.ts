/**
 * calcMath.test.ts — Conformance tests for the Brzycki 1RM port.
 *
 * Values verified against 8001 gymforge.html's client-side JS:
 *   one = w / (1.0278 - 0.0278 * r)
 *   val = Math.round(one * pct / 100 * 10) / 10
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { brzycki1rm, round1, pctWeight, GRID_COLS, GRID_ROWS } from "../src/calcMath";

// ── round1 ──────────────────────────────────────────────────────────────

test("round1: basic rounding", () => {
  assert.equal(round1(1.234), 1.2);
  assert.equal(round1(1.25), 1.3);
  assert.equal(round1(10.0), 10);
  assert.equal(round1(0.1), 0.1);
});

// ── brzycki1rm ──────────────────────────────────────────────────────────

test("brzycki1rm: 100kg x 5 reps", () => {
  // 100 / (1.0278 - 0.0278*5) = 100 / 0.8888 = 112.5113...
  const one = brzycki1rm(100, 5);
  assert.ok(one != null);
  assert.ok(Math.abs(one! - 112.511) < 0.01);
});

test("brzycki1rm: 100kg x 1 rep = exactly 100", () => {
  // 100 / (1.0278 - 0.0278) = 100 / 1.0 = 100
  const one = brzycki1rm(100, 1);
  assert.ok(one != null);
  assert.ok(Math.abs(one! - 100) < 0.001);
});

test("brzycki1rm: 200kg x 3 reps", () => {
  // 200 / (1.0278 - 0.0278*3) = 200 / 0.9444 = 211.774...
  const one = brzycki1rm(200, 3);
  assert.ok(one != null);
  assert.ok(Math.abs(one! - 211.774) < 0.01);
});

test("brzycki1rm: weight=0 → null", () => {
  assert.equal(brzycki1rm(0, 5), null);
});

test("brzycki1rm: reps=0 → null", () => {
  assert.equal(brzycki1rm(100, 0), null);
});

test("brzycki1rm: negative weight → null", () => {
  assert.equal(brzycki1rm(-10, 5), null);
});

test("brzycki1rm: very high reps (denom ≤ 0) → null", () => {
  // denom = 1.0278 - 0.0278*38 = 1.0278 - 1.0564 = -0.0286 → null
  assert.equal(brzycki1rm(100, 38), null);
});

test("brzycki1rm: 37 reps (denom still positive)", () => {
  // denom = 1.0278 - 0.0278*37 = 1.0278 - 1.0286 = -0.0008 → null
  // denom = 1.0278 - 0.0278*36 = 1.0278 - 1.0008 = 0.027 → valid
  assert.equal(brzycki1rm(100, 37), null);
  const one36 = brzycki1rm(100, 36);
  assert.ok(one36 != null);
  assert.ok(one36! > 1000); // 100/0.027 ≈ 3703
});

// ── pctWeight ───────────────────────────────────────────────────────────

test("pctWeight: 90% of 112.486 → 101.2", () => {
  const one = brzycki1rm(100, 5)!;
  const w = pctWeight(one, 90);
  assert.ok(w != null);
  assert.equal(w, round1(one * 0.9));
});

test("pctWeight: 100% = the 1RM itself", () => {
  const one = brzycki1rm(100, 5)!;
  const w = pctWeight(one, 100);
  assert.ok(w != null);
  assert.equal(w, round1(one));
});

test("pctWeight: pct=0 → null", () => {
  const one = brzycki1rm(100, 5)!;
  assert.equal(pctWeight(one, 0), null);
});

test("pctWeight: null 1RM → null", () => {
  assert.equal(pctWeight(null, 90), null);
});

// ── Grid structure ──────────────────────────────────────────────────────

test("grid: 3 columns × 4 rows", () => {
  assert.equal(GRID_COLS.length, 3);
  assert.equal(GRID_ROWS, 4);
  for (const col of GRID_COLS) {
    assert.equal(col.length, GRID_ROWS);
  }
});

test("grid: no duplicate percentages across all 12 cells", () => {
  const all = GRID_COLS.flat();
  assert.equal(all.length, 12);
  assert.equal(new Set(all).size, 12);
});

test("grid: col-major values match 8001", () => {
  assert.deepEqual(GRID_COLS[0], [100, 85, 70, 55]);
  assert.deepEqual(GRID_COLS[1], [95, 80, 65, 50]);
  assert.deepEqual(GRID_COLS[2], [90, 75, 60, 45]);
});
