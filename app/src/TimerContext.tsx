// TimerContext.tsx — the single source of truth for the three timers.
//
// Owns one TimerState (from the pure src/timerEngine) and a ~250ms re-render
// tick that runs ONLY while a timer is active (idle = zero intervals, zero
// cost). Bridges the pure engine + the audio windup (src/timerAudio).
//
// LOCKED behaviors this layer implements (see projects/unguided/TIMER-DESIGN.md):
//   * ONE shared timer at a time.
//   * EPOCH-derived: all visible numbers computed from Date.now() each tick —
//     no running counters, so it's drift-free and survives tab suspension.
//   * The windup (10->0 with 3-2-1 + long 0 beeps) fires:
//       - at Start (arms; the real timer begins at windup completion), and
//       - SEAMLESSLY in the last 10 seconds of every Emom window (the timer
//         NEVER stops; the BEEP(0) lands exactly on the window reset).
//   * Footer lifecycle: start() clears dismissed; X dismisses (timer keeps
//     running); re-entering the page (markReentered) re-shows it.
//   * No disk persistence.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type TimerConfig,
  type TimerState,
  type TimerMode,
  IDLE,
  start as engineStart,
  pause as enginePause,
  resume as engineResume,
  stopReset as engineStopReset,
  clear as engineClear,
  dismiss as engineDismiss,
  markReentered as engineMarkReentered,
  isFinished,
  finishToReady as engineFinishToReady,
  heroMs,
  totalMs,
  windowRemainingMs,
  emomRound,
  emomTotalRounds,
  elapsedMs,
} from "./timerEngine";
import { windup, type WindupHandle } from "./timerAudio";
import { beep, initAudio } from "./audio/sounds";

/** How often we re-render while a timer is active. (Locked: lightweight.) */
const TICK_MS = 250;

interface TimerApi {
  /** Current state kind. */
  state: TimerState;
  /** Live epoch ms (Date.now()) — update on each active tick. */
  now: number;
  /** The hero number, in ms, as of now. */
  heroMs: number;
  /** Countdown remaining (ms) — for countdown/stopwatch progress. */
  remainingMs: number;
  /** Total configured length (ms). */
  totalMs: number;
  /** Emom: current 1-based round, or null if not Emom. */
  round: number | null;
  /** Emom: total rounds, or 0. */
  totalRounds: number;
  /** Emom: ms remaining in the current window. */
  windowRemainingMs: number;
  /** Elapsed ms (stopwatch counts up). */
  elapsedMs: number;
  /** True while the start windup is arming (hero shows windupNum). */
  isArming: boolean;
  /** Footer should be visible: true while arming (start windup) OR active. */
  shouldShow: boolean;
  /** The 10->0 value shown while arming (seconds). */
  windupNum: number;
  /** Start a timer. mode + seconds; emom needs workSec + totalSec. */
  start: (mode: TimerMode, opts: { seconds?: number; workSec?: number; totalSec?: number }) => void;
  pause: () => void;
  resume: () => void;
  /** Arm the 10s windup directly from a ready config (READY -> RUNNING). */
  armStart: (cfg: TimerConfig) => void;
  /** Set a config on an idle timer (CLEAR -> READY, or re-configure in READY).
   *  The engine cfg is the SINGLE source of truth for the current config. */
  setReady: (cfg: TimerConfig) => void;
  /** Reset to READY: keep this config, wipe the run (PAUSED -> READY). */
  resetToReady: (cfg: TimerConfig) => void;
  stopReset: () => void;
  clear: () => void;
  dismiss: () => void;
  markReentered: () => void;
}

const Ctx = createContext<TimerApi | null>(null);

export function useTimer(): TimerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTimer must be used inside <TimerProvider>");
  return v;
}

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TimerState>(IDLE);
  const [now, setNow] = useState<number>(() => Date.now());
  const [isArming, setIsArming] = useState(false);
  const [windupNum, setWindupNum] = useState(10);

  // Refs for the tick loop (avoid stale closures).
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastRoundRef = useRef<number | null>(null);
  // Whether we've already fired the 10s-remaining windup for the current Emom round.
  const firedRoundRef = useRef<number | null>(null);
  const cancelRef = useRef<WindupHandle | null>(null);

  const active = state.kind === "running" || state.kind === "paused";

  // Unlock the native audio mode once at mount (covers timer beeps + games).
  useEffect(() => { initAudio(); }, []);

  // --- the active-only tick loop -----------------------------------------
  useEffect(() => {
    if (!active) return; // idle/finished -> no interval at all
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const s = stateRef.current;

      // 1) FINISH: running -> READY (revert) + a single long completion BEEP.
      if (s.kind === "running" && isFinished(s, t)) {
        // The timer already hit its end, so NO 10-second windup here (that's
        // the START routine). Just fire the sustained 0-beep, then land on
        // READY (idle + cfg retained) so Start re-runs the same timer.
        beep({ long: true });
        setState(engineFinishToReady(s, t));
        return;
      }

      // 2) Seamless 10s-to-end windup (timer never stops) — the SAME routine for
      //    every mode, so DOWN/UP/EMOM all get "10 seconds" + 3·2·1 + long BEEP:
      //      emom      -> when a window has <=10s left (round-keyed; fires each
      //                   window, timer keeps running).
      //      countdown -> when total remaining <=10s left (once; BEEP(0) lands
      //                   on finish, then the finish branch reverts to READY).
      //      stopwatch -> when (target - elapsed) <=10s left (once; same).
      //    The windup's onDone is a no-op: the timer keeps counting; the natural
      //    boundary (emom window reset) or the finish branch above does the rest.
      if (s.kind === "running" && s.cfg) {
        const total = totalMs(s);
        let rem = 0;
        let firedKey: number | null = null;
        if (s.cfg.mode === "emom") {
          if (!s.cfg.workSec) return;
          rem = windowRemainingMs(s, t);
          const round = emomRound(s, t);
          firedKey = round;
          // Track round transitions for the round display.
          lastRoundRef.current = round;
        } else {
          rem = Math.max(0, total - elapsedMs(s, t)); // DOWN / UP: total remaining
          firedKey = -1; // single shot (not round-keyed)
        }
        if (rem <= 10_000 && rem > 0 && firedKey !== null && firedRoundRef.current !== firedKey) {
          firedRoundRef.current = firedKey;
          cancelRef.current = windup(() => {}, () => {});
        }
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  // --- actions ------------------------------------------------------------

  const start = useCallback(
    (mode: TimerMode, opts: { seconds?: number; workSec?: number; totalSec?: number }) => {
      // Build the config.
      let cfg: TimerConfig;
      if (mode === "emom") {
        const workSec = opts.workSec ?? 120;
        const totalSec = opts.totalSec ?? workSec;
        cfg = { mode, targetSec: totalSec, workSec, totalSec };
      } else {
        cfg = { mode, targetSec: opts.seconds ?? 60 };
      }

      // Cancel any in-flight windup.
      if (cancelRef.current) {
        cancelRef.current.cancel();
        cancelRef.current = null;
      }

      // Arm: run the 10->0 windup; the real timer starts at completion.
      setIsArming(true);
      setWindupNum(10);
      firedRoundRef.current = null;
      lastRoundRef.current = null;
      cancelRef.current = windup(
        (n: number) => setWindupNum(n),
        () => {
          const t = Date.now();
          const s = engineStart(cfg, t);
          setState(s);
          setNow(t);
          setIsArming(false);
          cancelRef.current = null;
        },
      );
    },
    [],
  );

  const pause = useCallback(() => {
    const t = Date.now();
    setState((s) => (s.kind === "running" ? enginePause(s, t) : s));
    setNow(t);
  }, []);

  const resume = useCallback(() => {
    const t = Date.now();
    setState((s) => (s.kind === "paused" ? engineResume(s, t) : s));
    setNow(t);
  }, []);

  /** Arm the 10s windup straight from a ready config (READY -> RUNNING at 0).
   *  Reuses the same windup + finish wiring as start(), but takes a cfg. */
  const armStart = useCallback((cfg: TimerConfig) => {
    if (cancelRef.current) {
      cancelRef.current.cancel();
      cancelRef.current = null;
    }
    setIsArming(true);
    setWindupNum(10);
    firedRoundRef.current = null;
    lastRoundRef.current = null;
    cancelRef.current = windup(
      (n: number) => setWindupNum(n),
      () => {
        const t = Date.now();
        setState(engineStart(cfg, t));
        setNow(t);
        setIsArming(false);
        cancelRef.current = null;
      },
    );
  }, []);

  /** Save a config to the engine without starting (CLEAR -> READY, or
   *  re-configure while READY). Idempotent: only applies to an idle timer,
   *  never touches a running/paused/arming timer. The engine cfg becomes the
   *  single source of truth the UI reads. */
  const setReady = useCallback((cfg: TimerConfig) => {
    setState((s) =>
      s.kind === "idle" ? { ...s, cfg, dismissed: false } : s,
    );
  }, []);

  /** Reset to READY: keep this config, wipe the run (PAUSED -> READY). The
   *  next Start is a fresh start from 0. */
  const resetToReady = useCallback((cfg: TimerConfig) => {
    if (cancelRef.current) {
      cancelRef.current.cancel();
      cancelRef.current = null;
    }
    setIsArming(false);
    setWindupNum(10);
    firedRoundRef.current = null;
    lastRoundRef.current = null;
    setState({ kind: "idle", cfg, startEpoch: null, pausedElapsedMs: 0, dismissed: false });
    setNow(Date.now());
  }, []);

  const stopReset = useCallback(() => {
    const t = Date.now();
    // Cancel any windup; stopReset keeps the config + footer state.
    if (cancelRef.current) {
      cancelRef.current.cancel();
      cancelRef.current = null;
    }
    setIsArming(false);
    setState((s) => engineStopReset(s, t));
    setNow(t);
  }, []);

  const clear = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current.cancel();
      cancelRef.current = null;
    }
    setIsArming(false);
    setWindupNum(10);
    firedRoundRef.current = null;
    lastRoundRef.current = null;
    setState(IDLE);
    setNow(Date.now());
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => engineDismiss(s));
  }, []);

  const markReentered = useCallback(() => {
    setState((s) => engineMarkReentered(s));
  }, []);

  // --- derived values (recomputed each render; cheap) ----------------------
  const cfg = state.cfg;
  const total = totalMs(state);
  const hero = isArming ? windupNum * 1000 : heroMs(state, now);
  const remaining = state.kind === "idle" ? 0 : Math.max(0, total - elapsedMs(state, now));
  const round = cfg?.mode === "emom" ? emomRound(state, now) : null;
  const rounds = cfg ? emomTotalRounds(cfg) : 0;
  const wRem = cfg?.mode === "emom" ? windowRemainingMs(state, now) : 0;
  const el = elapsedMs(state, now);
  const shouldShow = isArming || state.kind !== "idle";

  const api = useMemo<TimerApi>(
    () => ({
      state,
      now,
      heroMs: hero,
      remainingMs: remaining,
      totalMs: total,
      round,
      totalRounds: rounds,
      windowRemainingMs: wRem,
      elapsedMs: el,
      isArming,
      shouldShow,
      windupNum,
      start,
      pause,
      resume,
      armStart,
      setReady,
      resetToReady,
      stopReset,
      clear,
      dismiss,
      markReentered,
    }),
    [state, now, hero, remaining, total, round, rounds, wRem, el, isArming, windupNum, shouldShow, start, pause, resume, armStart, setReady, resetToReady, stopReset, clear, dismiss, markReentered],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
