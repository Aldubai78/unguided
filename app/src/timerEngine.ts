// timerEngine.ts — the pure, epoch-derived brain of the three timers.
//
// LOCKED spec (projects/unguided/TIMER-DESIGN.md):
//   * THREE timers, all countdown-flavored, hard cap 99:59 (5999s):
//       - stopwatch: counts UP, auto-finishes at a required target.
//       - countdown: counts DOWN to 0 -> finished. One-shot.
//       - emom: every `workSec` a signal, for `totalSec`; the per-window
//         countdown (workSec->0) auto-resets each round. NO work/rest framing,
//         NO lap. Just a resetting clock + a round counter.
//   * EPOCH-DERIVED: state stores startEpoch + pausedElapsed (NOT a running
//     counter). Everything the UI shows is COMPUTED from Date.now(), so the
//     app is drift-free, costs zero when idle, and survives tab suspension
//     (wall-clock, not a JS counter).
//   * NO disk persistence: in-app only. Close app -> reopen = idle.
//   * Pure: every action takes `now` and returns a NEW state (no mutation, no
//     Date.now() inside) so it's fully unit-testable under a fake clock.
//
// The React TimerContext (STEP 3) wraps this: it owns the single state, runs a
// ~250ms re-render tick only while active, and calls the audio windup on
// start / emom-window-end / finish. The engine knows nothing about audio.

export type TimerMode = "stopwatch" | "countdown" | "emom";
export type TimerStateKind = "idle" | "running" | "paused" | "finished";

export interface TimerConfig {
  mode: TimerMode;
  /** stopwatch: the target (counts up to this). countdown: the duration. */
  targetSec: number;
  /** emom only: window length (the per-window countdown). */
  workSec?: number;
  /** emom only: total length (how long the whole thing runs). */
  totalSec?: number;
}

export interface TimerState {
  kind: TimerStateKind;
  cfg: TimerConfig | null;
  /** Epoch ms when the CURRENT running segment began (after any pause). */
  startEpoch: number | null;
  /** ms accumulated across all prior pauses (so pauses don't count). */
  pausedElapsedMs: number;
  /** Footer dismissed? (X hides it; timer keeps running). Cleared on start / re-enter. */
  dismissed: boolean;
}

export const IDLE: TimerState = {
  kind: "idle",
  cfg: null,
  startEpoch: null,
  pausedElapsedMs: 0,
  dismissed: false,
};

/** Hard cap: 99:59 = 5999 seconds. */
export const MAX_SEC = 5999;

/** Clamp + validate a mm:ss-derived seconds value to [1, MAX_SEC]. */
export function clampSec(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.floor(n), MAX_SEC);
}

// ---------------------------------------------------------------------------
// DERIVED clock math (pure; all take `now`).
// ---------------------------------------------------------------------------

/** Total ms the timer has been running (excluding idle/finished-final). */
export function elapsedMs(s: TimerState, now: number): number {
  if (s.kind === "idle" || s.startEpoch === null) return 0;
  const base = s.pausedElapsedMs;
  if (s.kind === "running") return base + (now - s.startEpoch);
  // paused / finished: frozen at the last running segment's end.
  return base;
}

/** Total ms the whole timer is configured to run (for progress + Emom). */
export function totalMs(s: TimerState): number {
  const c = s.cfg;
  if (!c) return 0;
  if (c.mode === "emom") return (c.totalSec ?? 0) * 1000;
  return c.targetSec * 1000;
}

/**
 * For an Emom, the ms remaining in the CURRENT window (workSec -> 0).
 * This is the hero clock for Emom. For non-Emom modes this is unused.
 */
export function windowRemainingMs(s: TimerState, now: number): number {
  const c = s.cfg;
  if (!c || c.mode !== "emom") return 0;
  const w = (c.workSec ?? 1) * 1000;
  const el = elapsedMs(s, now);
  const intoWindow = el % w;
  return w - intoWindow;
}

/** 1-based current Emom round, or null when not Emom / idle. */
export function emomRound(s: TimerState, now: number): number | null {
  const c = s.cfg;
  if (!c || c.mode !== "emom") return null;
  const w = (c.workSec ?? 1) * 1000;
  const t = (c.totalSec ?? 0) * 1000;
  if (t <= 0) return 1;
  const el = Math.min(elapsedMs(s, now), t);
  const rounds = emomTotalRounds(c);
  const r = Math.floor(el / w) + 1;
  return Math.max(1, Math.min(r, rounds));
}

/** Total number of Emom rounds (signals): e.g. work=2, total=10 -> 5. */
export function emomTotalRounds(c: TimerConfig): number {
  const w = c.workSec ?? 1;
  const t = c.totalSec ?? 0;
  if (t <= 0 || w <= 0) return 0;
  // Signals at 0, w, 2w, ... while < t. Count = floor((t-1)/w)+1 == ceil(t/w).
  return Math.max(0, Math.ceil(t / w));
}

/**
 * The HERO number for each mode, in ms, as of `now`:
 *   - stopwatch: elapsed (counts up).
 *   - countdown: remaining (counts down).
 *   - emom: window remaining (the per-window countdown that resets).
 * When finished, returns the final value (stopwatch=target, countdown=0,
 * emom=0). When idle, returns 0.
 */
export function heroMs(s: TimerState, now: number): number {
  if (s.kind === "idle" || !s.cfg) return 0;
  const c = s.cfg;
  if (c.mode === "stopwatch") {
    return s.kind === "finished" ? c.targetSec * 1000 : elapsedMs(s, now);
  }
  if (c.mode === "countdown") {
    if (s.kind === "finished") return 0;
    return Math.max(0, totalMs(s) - elapsedMs(s, now));
  }
  // emom
  if (s.kind === "finished") return 0;
  return Math.max(0, windowRemainingMs(s, now));
}

/**
 * True when `now` has crossed a NEW Emom window boundary since the previous
 * sample (used by the React layer to fire the windup at each signal). The
 * caller passes the round it last saw; we return the round NOW. A change
 * means a new window began (and thus the previous one just ended at 0).
 */
export function emomRoundChanged(s: TimerState, now: number, lastRound: number | null): boolean {
  const r = emomRound(s, now);
  if (r === null || lastRound === null) return false;
  return r > lastRound;
}

// ---------------------------------------------------------------------------
// ACTIONS (pure; all take `now`, return a NEW state).
// ---------------------------------------------------------------------------

/**
 * Start a timer from its config. Arms at `now`. (The React layer runs the
 * audio windup first and calls start() at windup completion, so `now` here is
 * the moment the real timer begins counting.)
 */
export function start(cfg: TimerConfig, now: number): TimerState {
  return {
    kind: "running",
    cfg: normalizeCfg(cfg),
    startEpoch: now,
    pausedElapsedMs: 0,
    dismissed: false, // starting always re-shows the footer (locked)
  };
}

function normalizeCfg(cfg: TimerConfig): TimerConfig {
  const targetSec = clampSec(cfg.targetSec);
  if (cfg.mode === "emom") {
    const workSec = clampSec(cfg.workSec ?? 1);
    const totalSec = clampSec(cfg.totalSec ?? workSec);
    return { mode: "emom", targetSec: totalSec, workSec, totalSec };
  }
  return { mode: cfg.mode, targetSec };
}

/** Pause (freeze). No-op unless running. */
export function pause(s: TimerState, now: number): TimerState {
  if (s.kind !== "running" || s.startEpoch === null) return s;
  return {
    ...s,
    kind: "paused",
    pausedElapsedMs: s.pausedElapsedMs + (now - s.startEpoch),
    startEpoch: now,
  };
}

/** Resume a paused timer. */
export function resume(s: TimerState, now: number): TimerState {
  if (s.kind !== "paused") return s;
  return { ...s, kind: "running", startEpoch: now };
}

/**
 * Stop/Reset (the two-click button's SECOND click): rewind to the configured
 * start state (armed, elapsed=0, ready to restart). Keeps the config. No-op
 * unless the timer is not idle. The footer is untouched by this (locked).
 */
export function stopReset(s: TimerState, _now: number): TimerState {
  if (s.kind === "idle" || !s.cfg) return s;
  return {
    kind: "idle",
    cfg: s.cfg, // keep the config so "Start" re-runs the same timer
    startEpoch: null,
    pausedElapsedMs: 0,
    dismissed: s.dismissed, // footer lifecycle untouched
  };
}

/**
 * Clear (the kill switch): full reset to IDLE — config cleared, footer gone,
 * stay on the page. (Locked: real kill -> idle.)
 */
export function clear(_s: TimerState, _now: number): TimerState {
  return { ...IDLE };
}

/** Dismiss the footer (X). Timer keeps running. */
export function dismiss(s: TimerState): TimerState {
  return { ...s, dismissed: true };
}

/**
 * Re-entered the Timer page while a timer is active -> re-show the footer
 * (clear dismissed). Called by the React layer on page focus when active.
 * Starting a new timer also clears dismissed (in start()).
 */
export function markReentered(s: TimerState): TimerState {
  return { ...s, dismissed: false };
}

// ---------------------------------------------------------------------------
// FINISH detection (pure). The React layer calls this each tick and, when a
// timer just reached its end, transitions to finished + fires the finish beeps.
// ---------------------------------------------------------------------------

/** True if this state, as of `now`, has reached its configured end. */
export function isFinished(s: TimerState, now: number): boolean {
  if (s.kind !== "running") return false;
  const c = s.cfg;
  if (!c) return false;
  const el = elapsedMs(s, now);
  const t = totalMs(s);
  // emom finishes when total elapsed reaches totalSec.
  // stopwatch finishes when elapsed reaches targetSec (counts up to target).
  // countdown finishes when elapsed reaches targetSec (duration).
  return el >= t && t > 0;
}

/**
 * Finish -> revert to the READY shape (idle + cfg retained).
 *
 * The UI models exactly four states (CLEAR / READY / RUNNING / PAUSED), where
 * READY = kind "idle" WITH a cfg set. When a running timer reaches its end we
 * do NOT introduce a 5th "finished" state — we replay the completion beeps and
 * land on READY so the user can immediately press Start to re-run the same
 * timer. Config is retained; the run is discarded.
 */
export function finishToReady(s: TimerState, _now: number): TimerState {
  if (s.kind !== "running" || !s.cfg) return s;
  return {
    ...IDLE,
    cfg: s.cfg, // keep the config so "Start" re-runs the same timer
    dismissed: s.dismissed, // footer lifecycle untouched by finish
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers (pure; for the UI + tests).
// ---------------------------------------------------------------------------

/** mm:ss (caps at 99:59). No hours — the cap is 99:59 by design. */
export function fmtClock(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
