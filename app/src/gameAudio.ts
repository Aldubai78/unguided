/**
 * Shared game audio — Web Audio API synthesis (no assets).
 *
 * Used by both Snake and Pac-Man. Call `initAudio()` on every user
 * gesture (touch/keypress) until the context is "running".
 *
 * Snake:
 *   soundBleepBleep : two-note "bleep bleep" on apple eat (660 → 880 Hz)
 *   soundWaa        : descending sweep on death (400 → 80 Hz)
 *
 * Pac-Man:
 *   soundDot, soundPower, soundEatGhost, soundDeath,
 *   soundFruit, soundExtraLife
 */

let ctx: AudioContext | null = null;
let wakaToggle = false;

/** Create/resume the AudioContext. Call on every user interaction until running. */
export function initAudio(): void {
  const AC =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
  }
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

/** Internal: play a single oscillator note. */
function note(
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = "square",
  volume = 0.12,
): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + start + duration,
  );
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration);
}

// ── Snake ──────────────────────────────────────────────────────────────

/** Snake eat: two-note "bleep bleep" (660 → 880 Hz, 60 ms each). */
export function soundBleepBleep(): void {
  note(660, 0, 0.06, "square", 0.1);
  note(880, 0.06, 0.06, "square", 0.1);
}

/** Snake die: descending sweep (400 → 80 Hz over 0.6 s). */
export function soundWaa(): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.6);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.6);
}

// ── Pac-Man ────────────────────────────────────────────────────────────

/** Waka-waka: alternating high/low tones on each dot. */
export function soundDot(): void {
  wakaToggle = !wakaToggle;
  const freq = wakaToggle ? 440 : 330;
  note(freq, 0, 0.06, "square", 0.08);
}

/** Power pellet: rising sweep (200 → 800 Hz over 0.3 s). */
export function soundPower(): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}

/** Ghost eaten: quick arpeggio (523, 659, 784 Hz). */
export function soundEatGhost(): void {
  note(523, 0, 0.08, "square", 0.1);
  note(659, 0.08, 0.08, "square", 0.1);
  note(784, 0.16, 0.12, "square", 0.1);
}

/** Death: descending sweep (400 → 50 Hz over 0.8 s). */
export function soundDeath(): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.8);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.8);
}

/** Fruit: bright chime (880 + 1320 Hz). */
export function soundFruit(): void {
  note(880, 0, 0.15, "sine", 0.12);
  note(1320, 0.05, 0.2, "sine", 0.08);
}

/** Extra life: fanfare (523, 659, 784, 1047 Hz staggered). */
export function soundExtraLife(): void {
  note(523, 0, 0.15, "square", 0.12);
  note(659, 0.15, 0.15, "square", 0.12);
  note(784, 0.3, 0.15, "square", 0.12);
  note(1047, 0.45, 0.3, "square", 0.14);
}

/** Coin clink: bright ping (1200 → 800 Hz, 0.12s). */
export function soundCoinClink(): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.12);
}
