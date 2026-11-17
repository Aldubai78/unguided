/**
 * Pac-Man sound — Web Audio API synthesis (no assets).
 *
 * Sounds:
 *   waka-waka  : alternating tones on each dot
 *   power      : rising sweep on power pellet
 *   eatGhost   : arpeggio on frightened ghost eat
 *   death      : descending sweep on pac death
 *   fruit      : bright chime on fruit eat
 *   extraLife  : fanfare on extra life award
 *
 * Usage:
 *   import { initAudio, soundDot, soundPower, ... } from "./pacmanAudio";
 *   // Call initAudio() on first user gesture (keyboard/touch)
 */

let ctx: AudioContext | null = null;
let wakaToggle = false;

/** Create/resume the AudioContext. Call on every user interaction until running. */
export function initAudio(): void {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return; // no Web Audio support
  if (!ctx) {
    ctx = new AC();
  }
  if (!ctx) return;
  // Browser autoplay policy: context starts "suspended". Must call resume()
  // inside a user-gesture handler. Call it every time until it's "running".
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

/** Small helper: play a single oscillator note. */
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
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration);
}

/** Waka-waka: alternating high/low tones on each dot. */
export function soundDot(): void {
  if (!ctx) return;
  wakaToggle = !wakaToggle;
  const freq = wakaToggle ? 440 : 330;
  note(freq, 0, 0.06, "square", 0.08);
}

/** Power pellet: rising sweep (200 → 800 Hz over 0.3s). */
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
  if (!ctx) return;
  note(523, 0, 0.08, "square", 0.1);
  note(659, 0.08, 0.08, "square", 0.1);
  note(784, 0.16, 0.12, "square", 0.1);
}

/** Death: descending sweep (400 → 50 Hz over 0.8s). */
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

/** Fruit: bright chime (880 Hz + 1320 Hz, 0.2s). */
export function soundFruit(): void {
  if (!ctx) return;
  note(880, 0, 0.15, "sine", 0.12);
  note(1320, 0.05, 0.2, "sine", 0.08);
}

/** Extra life: fanfare (523, 659, 784, 1047 Hz, staggered). */
export function soundExtraLife(): void {
  if (!ctx) return;
  note(523, 0, 0.15, "square", 0.12);
  note(659, 0.15, 0.15, "square", 0.12);
  note(784, 0.3, 0.15, "square", 0.12);
  note(1047, 0.45, 0.3, "square", 0.14);
}
