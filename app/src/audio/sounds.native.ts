// audio/sounds.native.ts — unified audio API (Android/iOS).
//
// Plays pre-rendered WAV assets via expo-audio. No Web Audio API on native.
//
// Audio sessions:
//   - playsInSilentMode: true   → iOS mute switch does NOT silence us
//   - interruptionMode: "mixWithOthers" → Spotify etc. keep playing

import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

let ready = false;
const players: Record<string, any> = {};

// Lazily set audio mode on first init (not at module load).
async function ensureAudioMode(): Promise<void> {
  if (ready) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    });
    ready = true;
  } catch {
    // best-effort
  }
}

async function getOrMake(key: string, src: string): Promise<any> {
  if (players[key]) return players[key];
  await ensureAudioMode();
  try {
    const p = createAudioPlayer(src);
    players[key] = p;
    attachStatusListener(key, p);
    return p;
  } catch (e) {
    console.warn(`[audio] failed to load ${key}`, e);
    return null;
  }
}

async function play(key: string, src: string): Promise<void> {
  const p = await getOrMake(key, src);
  if (!p) { console.warn(`[audio] play(${key}): no player`); return; }
  try {
    await p.seekTo(0);
    p.play();
    console.log(`[audio] play(${key}): started`);
  } catch (e) {
    console.warn(`[audio] play(${key}) failed`, e);
  }
}

// One-shot status listener for debugging (remove after diagnosis).
let statusLogged = false;
function attachStatusListener(key: string, p: any): void {
  if (statusLogged) return;
  statusLogged = true;
  p.addListener("playbackStatusUpdate", (s: any) => {
    console.log(`[audio] status(${key})`, JSON.stringify(s));
  });
}

// ── Asset sources (require() so Metro packs them into the APK) ─────────────
const bleep = require("../../assets/sounds/bleep.wav");
const waa = require("../../assets/sounds/waa.wav");
const tick = require("../../assets/sounds/tick.wav");
const longtick = require("../../assets/sounds/longtick.wav");
const pdot_hi = require("../../assets/sounds/pdot_hi.wav");
const pdot_lo = require("../../assets/sounds/pdot_lo.wav");
const ppower = require("../../assets/sounds/ppower.wav");
const peatghost = require("../../assets/sounds/peatghost.wav");
const pdeath = require("../../assets/sounds/pdeath.wav");
const pfruit = require("../../assets/sounds/pfruit.wav");
const pextralife = require("../../assets/sounds/pextralife.wav");
const tens = require("../../assets/sounds/tenseconds.wav");
const m1up = require("../../assets/sounds/m1up.wav");
const stageclear = require("../../assets/sounds/stageclear.wav");

const ASSETS: Record<string, unknown> = {
  bleep, waa, tick, longtick, tens, m1up, stageclear,
  pdot_hi, pdot_lo, ppower, peatghost, pdeath, pfruit, pextralife,
};
const S = (name: string) => ASSETS[name] ?? bleep;

// ── Public API (matches the web interface exactly) ─────────────────────────

/** No-op on native (audio mode is set lazily on first play). */
export function initAudio(): void {
  // Trigger audio mode setup so the first play isn't delayed.
  void ensureAudioMode();
}

// Snake
export function soundBleepBleep(): void {
  void play("bleep", S("bleep"));
}
export function soundWaa(): void {
  void play("waa", S("waa"));
}

// Timer
export function beep(opts: { long?: boolean } = {}): void {
  const long = opts.long === true;
  void play(long ? "longtick" : "tick", S(long ? "longtick" : "tick"));
}

// Pac-Man
let wakaN = 0;
export function soundDot(): void {
  wakaN++;
  const hi = wakaN % 2 === 1;
  void play(hi ? "pdot_hi" : "pdot_lo", S(hi ? "pdot_hi" : "pdot_lo"));
}
export function soundPower(): void {
  void play("ppower", S("ppower"));
}
export function soundEatGhost(): void {
  void play("peatghost", S("peatghost"));
}
export function soundDeath(): void {
  void play("pdeath", S("pdeath"));
}
export function soundFruit(): void {
  void play("pfruit", S("pfruit"));
}
export function soundExtraLife(): void {
  void play("pextralife", S("pextralife"));
}
export function soundCoinClink(): void {
  // Reuse the short tick as a coin clink (close enough: 1320 Hz)
  void play("tick", S("tick"));
}

// Timer windup: pre-recorded "10 seconds" (same expo-audio path as the beeps,
// so it mixes with Spotify and matches the web voice intent on every phone).
export function sayTenSeconds(): void {
  void play("tenseconds", S("tens"));
}

// Easter-egg stage cues (Mario rips — private EE only, not for public builds).
export function soundOneUp(): void {
  void play("m1up", S("m1up"));
}
export function soundStageClear(): void {
  void play("stageclear", S("stageclear"));
}
