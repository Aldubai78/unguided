/**
 * timerEngine tests — the pure clock math. All time is injected (`now`), so
 * these run instantly and deterministically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE,
  start,
  pause,
  resume,
  stopReset,
  clear,
  dismiss,
  markReentered,
  isFinished,
  finishToReady,
  elapsedMs,
  totalMs,
  heroMs,
  windowRemainingMs,
  emomRound,
  emomTotalRounds,
  emomRoundChanged,
  clampSec,
  fmtClock,
  MAX_SEC,
  type TimerConfig,
  type TimerState,
} from "../src/timerEngine.js";

const T0 = 1_000_000_000_000; // arbitrary epoch
const S = (ms: number) => ms * 1000;

// --- clamp / cap ----------------------------------------------------------
test("clampSec enforces [1, 5999]", () => {
  assert.equal(clampSec(0), 1);
  assert.equal(clampSec(-5), 1);
  assert.equal(clampSec(9999), MAX_SEC);
  assert.equal(clampSec(MAX_SEC), MAX_SEC);
  assert.equal(clampSec(90), 90);
  assert.equal(clampSec(NaN), 1);
});

// --- stopwatch ------------------------------------------------------------
test("stopwatch counts UP and finishes at target", () => {
  const cfg: TimerConfig = { mode: "stopwatch", targetSec: 120 }; // 2:00
  let s = start(cfg, T0);
  assert.equal(s.kind, "running");
  assert.equal(elapsedMs(s, T0), 0);
  assert.equal(heroMs(s, T0), 0);
  assert.equal(heroMs(s, T0 + S(30)), S(30)); // counts up
  assert.equal(isFinished(s, T0 + S(119)), false);
  assert.equal(isFinished(s, T0 + S(120)), true); // target hit
  s = finishToReady(s, T0 + S(120));
  // Finish reverts to READY: idle + cfg retained, run discarded. Ready to
  // re-run the same timer from Start. (idle -> heroMs is the CLEAR baseline
  // 00:00; the READY title shows the configured base, not heroMs.)
  assert.equal(s.kind, "idle");
  assert.ok(s.cfg, "cfg retained after finish");
  assert.equal(s.cfg!.targetSec, 120); // same timer, ready to re-run
  assert.equal(isFinished(s, T0 + S(200)), false); // no longer "finished"
});

// --- countdown ------------------------------------------------------------
test("countdown counts DOWN to 0 then finishes", () => {
  const cfg: TimerConfig = { mode: "countdown", targetSec: 60 };
  let s = start(cfg, T0);
  assert.equal(totalMs(s), S(60));
  assert.equal(heroMs(s, T0), S(60));
  assert.equal(heroMs(s, T0 + S(20)), S(40));
  assert.equal(isFinished(s, T0 + S(59)), false);
  assert.equal(isFinished(s, T0 + S(60)), true);
  s = finishToReady(s, T0 + S(60));
  // Finish reverts to READY: idle + cfg retained, run discarded. Ready to
  // re-run the same timer from Start.
  assert.equal(s.kind, "idle");
  assert.ok(s.cfg, "cfg retained after finish");
  assert.equal(s.cfg!.targetSec, 60); // same timer, ready to re-run
  assert.equal(isFinished(s, T0 + S(999)), false); // no longer "finished"
});

// --- emom -----------------------------------------------------------------
test("emom: 5 rounds for work=2 total=10; hero = per-window countdown that resets", () => {
  const cfg: TimerConfig = { mode: "emom", targetSec: 600, workSec: 120, totalSec: 600 };
  const s = start(cfg, T0);
  assert.equal(emomTotalRounds(s.cfg as TimerConfig), 5);
  assert.equal(totalMs(s), S(600));

  // Round 1: window counts 2:00 -> 0:00 over the first 120s.
  assert.equal(emomRound(s, T0), 1);
  assert.equal(heroMs(s, T0), S(120)); // 2:00 at start of round 1
  assert.equal(windowRemainingMs(s, T0), S(120));
  assert.equal(heroMs(s, T0 + S(60)), S(60)); // 1:00 left in window 1
  assert.equal(heroMs(s, T0 + S(119)), S(1)); // 0:01 left
  assert.equal(isFinished(s, T0 + S(119)), false);

  // Just past the boundary -> round 2, window resets to 2:00 (auto-reset).
  const s2 = s;
  assert.equal(emomRound(s2, T0 + S(120)), 2);
  assert.equal(heroMs(s2, T0 + S(120)), S(120)); // RESET to 2:00
  assert.equal(emomRoundChanged(s2, T0 + S(120), 1), true); // new window began
  assert.equal(emomRoundChanged(s2, T0 + S(120), 2), false); // not changed again

  // Round 5 begins at 8:00 (480s).
  assert.equal(emomRound(s2, T0 + S(480)), 5);
  assert.equal(emomRound(s2, T0 + S(479)), 4);

  // Finishes at total 10:00 (600s).
  assert.equal(isFinished(s2, T0 + S(599)), false);
  assert.equal(isFinished(s2, T0 + S(600)), true);
  const fin = finishToReady(s2, T0 + S(600));
  // Finish reverts to READY: idle + cfg retained, run discarded. Ready to
  // re-run the same EMOM from Start.
  assert.equal(fin.kind, "idle");
  assert.ok(fin.cfg, "cfg retained after finish");
  assert.equal(fin.cfg!.workSec, 120); // same timer, ready to re-run
  assert.equal(isFinished(fin, T0 + S(700)), false); // no longer "finished"
});

test("emom round is clamped to 1..total and handles edge configs", () => {
  const cfg: TimerConfig = { mode: "emom", targetSec: 300, workSec: 60, totalSec: 300 };
  const s = start(cfg, T0);
  assert.equal(emomTotalRounds(s.cfg as TimerConfig), 5);
  // Exactly on a boundary belongs to the NEW round (floor(el/w)+1).
  assert.equal(emomRound(s, T0 + S(60)), 2);
  // Right before total, still within last round.
  assert.equal(emomRound(s, T0 + S(299)), 5);
});

// --- pause / resume -------------------------------------------------------
test("pause freezes elapsed; resume continues; paused time does not count", () => {
  const cfg: TimerConfig = { mode: "countdown", targetSec: 300 };
  let s = start(cfg, T0);
  s = pause(s, T0 + S(50)); // ran 50s, now paused
  assert.equal(s.kind, "paused");
  assert.equal(elapsedMs(s, T0 + S(500)), S(50)); // frozen at 50
  assert.equal(isFinished(s, T0 + S(5000)), false); // paused can't finish
  s = resume(s, T0 + S(500)); // resume at +500 (450s of wall time passed, paused)
  assert.equal(s.kind, "running");
  assert.equal(elapsedMs(s, T0 + S(550)), S(100)); // 50 before + 50 after
  assert.equal(heroMs(s, T0 + S(550)), S(200)); // 300 - 100
});

// --- stopReset / clear / dismissed lifecycle -------------------------------
test("stopReset rewinds to idle but KEEPS config + footer state", () => {
  const cfg: TimerConfig = { mode: "countdown", targetSec: 90 };
  let s = start(cfg, T0);
  s = dismiss(s); // hide footer (timer still running)
  assert.equal(s.dismissed, true);
  s = stopReset(s, T0 + S(30));
  assert.equal(s.kind, "idle");
  assert.ok(s.cfg, "config kept");
  assert.equal(s.cfg?.targetSec, 90);
  assert.equal(s.dismissed, true, "footer dismissal preserved by stopReset");
  assert.equal(elapsedMs(s, T0 + S(999)), 0);
});

test("clear fully resets to IDLE (config gone, footer gone)", () => {
  const cfg: TimerConfig = { mode: "emom", targetSec: 600, workSec: 120, totalSec: 600 };
  let s = start(cfg, T0);
  s = dismiss(s);
  s = clear(s, T0 + S(30));
  assert.deepEqual(s, IDLE);
  assert.equal(s.cfg, null);
  assert.equal(s.dismissed, false);
});

test("dismiss hides footer, markReentered re-shows it (page re-entry)", () => {
  const cfg: TimerConfig = { mode: "stopwatch", targetSec: 120 };
  let s = start(cfg, T0);
  assert.equal(s.dismissed, false);
  s = dismiss(s);
  assert.equal(s.dismissed, true);
  // Still running (timer not affected by dismiss).
  assert.equal(s.kind, "running");
  s = markReentered(s);
  assert.equal(s.dismissed, false, "re-entry re-shows the footer");
});

test("start clears dismissed (a fresh timer always re-shows the footer)", () => {
  const cfg: TimerConfig = { mode: "countdown", targetSec: 60 };
  let s: TimerState = { ...IDLE, dismissed: true };
  s = start(cfg, T0);
  assert.equal(s.dismissed, false);
  assert.equal(s.kind, "running");
});

// --- formatting -----------------------------------------------------------
test("fmtClock is MM:SS (zero-padded) capped at 99:59", () => {
  assert.equal(fmtClock(0), "00:00");
  assert.equal(fmtClock(S(1)), "00:01");
  assert.equal(fmtClock(S(60)), "01:00");
  assert.equal(fmtClock(S(125)), "02:05");
  assert.equal(fmtClock(S(MAX_SEC)), "99:59");
  // Rounding: 999ms -> 1s.
  assert.equal(fmtClock(999), "00:01");
});
