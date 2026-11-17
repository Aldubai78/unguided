import { Platform } from "react-native";
// timerAudio.ts — zero-asset audio + the ONE reusable windup routine.
//
// LOCKED spec (see projects/unguided/TIMER-DESIGN.md):
//   * Beeps (3·2·1 ticks + the sustained 0-beep, every Emom window end, every
//     completion) are synthesized in-browser via the Web Audio API — NO file.
//   * The "10 seconds" call uses the Web Speech API — NO file.
//   * windup(onNumber, onDone) is the single routine used in 3 places:
//       1. At Start (any timer)  -> onDone starts the real timer.
//       2. Every Emom window end -> onDone resets the window.
//       3. Countdown/stopwatch finish -> onDone marks finished.
//
// DESIGN: audio DRIVES the display. windup calls onNumber(n) so the UI's hero
// clock shows 10..3..2..1 in lockstep with the audio. The module is pure
// sequencing + browser-API calls; under Node (tests) the browser APIs are
// absent and every call is a safe no-op, so the TEST asserts the SEQUENCE of
// onNumber/onDone calls, not the actual sound.
//
// All timing is real (setTimeout) but the module exposes a `tick` injection
// point (via setWindupMs / a fake-clock override) so tests can run it without
// waiting ~10s in wall-clock time.

export interface WindupHandle {
  /** Stop this windup early (e.g. the user hit Clear mid-countdown). */
  cancel: () => void;
}

/** A single tick of the Web Audio graph. Kept module-private. */
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (typeof AudioContext === "undefined") return null;
    if (!audioCtx) audioCtx = new AudioContext();
    // Browsers suspend the context until a user gesture; resume is a no-op if running.
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Play one beep. `long` = the sustained 0-beep (~600ms) vs a short tick (~120ms).
 * No-op when Web Audio is unavailable (Node / unsupported browser).
 * On native (Android/iOS), delegates to the expo-audio WAV player.
 */
export function beep(opts: { long?: boolean } = {}): void {
  // Native: delegate to expo-audio WAV playback.
  if (Platform.OS !== "web") {
    console.log("[timerAudio] beep native delegate", opts);
    try { require("./audio/sounds").beep(opts); } catch (e) { console.warn("[timerAudio] native beep failed", e); }
    return;
  }
  const ctx = getCtx();
  if (!ctx) return;
  const long = opts.long === true;
  const dur = long ? 0.6 : 0.12;
  const freq = long ? 880 : 1320;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    // Quick attack, clean release so ticks don't click.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.008);
    gain.gain.setValueAtTime(0.25, now + dur - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  } catch {
    /* no-op: audio is best-effort, never throws into the timer logic */
  }
}

// "10 seconds" call — platform implementation lives in audio/sounds (web: Web
// Speech, native: pre-recorded WAV via expo-audio), same pattern as beep().
import { sayTenSeconds } from "./audio/sounds";
export { sayTenSeconds };
/**
 * Default wall-clock scheduler. Tests override this to run windup instantly.
 * Uses global setTimeout/clearTimeout (available in React Native + browsers + Node).
 */
type Schedule = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
let schedule: Schedule = (fn, ms) => setTimeout(fn, ms);
let unschedule: (id: ReturnType<typeof setTimeout>) => void = (id) => clearTimeout(id);

/**
 * Test seam: inject a fake scheduler so windup can be driven deterministically
 * without waiting ~10s. Pass null to restore real timers.
 */
export function setScheduler(s: Schedule | null, clear: ((id: ReturnType<typeof setTimeout>) => void) | null = null): void {
  if (s === null) schedule = (fn, ms) => setTimeout(fn, ms);
  else schedule = s;
  if (clear === null) unschedule = (id) => clearTimeout(id);
  else unschedule = clear;
}

/** Per-number cadence (ms). 10..4 are silent (just the clock), 3/2/1 beep, 0 BEEP. */
const TICK_MS = 1000;

/**
 * Run the windup. Calls onNumber(10) immediately, then onNumber(9) ... down to
 * onNumber(0); beeps fire at 3, 2, 1 (short) and 0 (long); onDone() fires just
 * after onNumber(0). Returns a handle to cancel early.
 *
 * The UI hooks onNumber to drive the hero clock (10 -> 3 -> 2 -> 1 -> 0) and
 * onDone to actually start/reset/finish the timer. During the windup the real
 * timer does NOT count — it arms, then goes at onDone.
 */
export function windup(onNumber: (n: number) => void, onDone: () => void): WindupHandle {
  sayTenSeconds();
  onNumber(10);
  let cancelled = false;
  let id: ReturnType<typeof setTimeout> = 0 as any;
  const step = (n: number) => {
    if (cancelled) return;
    onNumber(n);
    if (n === 3 || n === 2 || n === 1) beep({ long: false });
    if (n === 0) {
      beep({ long: true });
      onDone();
      return;
    }
    id = schedule(() => step(n - 1), TICK_MS);
  };
  id = schedule(() => step(9), TICK_MS);
  return {
    cancel: () => {
      cancelled = true;
      unschedule(id);
    },
  };
}
