// dialValue.test.ts — locks down DialValue's pure physics/value math.
// Run: cd app && npx tsx --test ../test/dialValue.test.ts

import { test } from "node:test";
import * as assert from "node:assert/strict";

import { ROW_H, decayDistance, flingTarget, snapY, wrapIndex } from "../components/dialMath";

test("snapY snaps to nearest row boundary", () => {
  assert.equal(snapY(0, ROW_H), 0);
  assert.equal(snapY(ROW_H / 2, ROW_H), ROW_H); // +24 -> +48 (half rounds up)
  assert.equal(snapY(-ROW_H / 2, ROW_H), 0); // -24 -> 0 (nearest, 0)
  assert.equal(snapY(-ROW_H * 2 - 5, ROW_H), -ROW_H * 2); // -101 -> -96
  assert.equal(snapY(ROW_H * 2 + 5, ROW_H), ROW_H * 2); // +101 -> +96
});

test("decayDistance: zero velocity -> zero distance", () => {
  assert.equal(decayDistance(0), 0);
});

test("decayDistance: faster flick coasts further (both directions)", () => {
  const slow = Math.abs(decayDistance(2)); // 2 px/ms up
  const fast = Math.abs(decayDistance(12)); // 12 px/ms up
  assert.ok(fast > slow * 3, `fast(${fast}) should be >> slow(${slow})`);
  // symmetric for downward
  assert.ok(Math.abs(decayDistance(-12)) === fast);
});

test("flingTarget: no velocity stays put", () => {
  assert.equal(flingTarget(5, 0, 59), 5);
});

test("flingTarget: a hard fling moves a deliberate 3-8 (no 40-swipes, no coast-forever)", () => {
  const from = 10;
  const to = flingTarget(from, 16, 59); // 16 px/ms UPWARD flick
  // Dials v2: MAX_STEPS=8 caps travel, so a hard flick lands in a deliberate
  // 3-8 window — far enough to feel fast, short enough to not coast forever.
  assert.ok(to - from >= 3, `a 16px/ms flick from ${from} should jump >=3 values, got ${to}`);
  assert.ok(to - from <= 8, `a 16px/ms flick from ${from} should jump <=8 values, got ${to}`);
});

test("flingTarget: a gentle flick moves a few values (not zero, not huge)", () => {
  const to = flingTarget(20, 2, 59); // gentle upward flick
  assert.ok(to > 20 && to <= 26, `a gentle flick should move a few values, got ${to}`);
});

test("flingTarget: a tiny flick (~1px/ms) moves only ~1-2 steps", () => {
  const to = flingTarget(20, 1, 59);
  assert.ok(to >= 20 && to <= 22, `a ~1px/ms nudge should barely move, got ${to}`);
});

test("flingTarget: faster flick travels farther (monotonic)", () => {
  const slow = flingTarget(10, 4, 59);
  const fast = flingTarget(10, 16, 59);
  assert.ok(fast > slow, `a faster flick must travel farther, slow=${slow} fast=${fast}`);
});

test("flingTarget: clamps at the top (never exceeds max)", () => {
  const to = flingTarget(58, 32, 59); // hard upward flick near the top
  assert.equal(to, 59, `should clamp at max, got ${to}`);
});

test("flingTarget: clamps at the bottom (never below 0)", () => {
  const to = flingTarget(1, -32, 59); // hard downward flick near 0
  assert.equal(to, 0, `should clamp at 0, got ${to}`);
});

test("flingTarget: downward flick decreases the value", () => {
  const to = flingTarget(30, -4, 59);
  assert.ok(to < 30, `a downward flick should decrease, got ${to}`);
});

test("flingTarget: max=0 returns 0", () => {
  assert.equal(flingTarget(0, -14, 0), 0);
});

test("wrapIndex wraps both directions", () => {
  assert.equal(wrapIndex(0, 59), 0);
  assert.equal(wrapIndex(59, 59), 59);
  assert.equal(wrapIndex(60, 59), 0);
  assert.equal(wrapIndex(-1, 59), 59);
  assert.equal(wrapIndex(120, 59), 0); // 120 % 60
});
