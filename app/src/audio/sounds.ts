// audio/sounds.ts — unified audio API.
//
// Metro resolves this to sounds.ts (web) or sounds.native.ts (Android/iOS)
// automatically via the .native. extension convention.
//
// Web implementation — re-exports the existing Web Audio API functions.

import {
  initAudio,
  soundBleepBleep,
  soundWaa,
  soundDot,
  soundPower,
  soundEatGhost,
  soundDeath,
  soundFruit,
  soundExtraLife,
  soundCoinClink,
} from "../gameAudio";

import { beep } from "../timerAudio";

// Windup "10 seconds" cue: the SAME double-ding WAV on every platform
// (high->low so it reads as "ten seconds to go" without a voice engine).
// Native plays it via expo-audio in sounds.native.ts; web fetches the asset
// URL Metro bundles and decodes it with Web Audio (best-effort).
function assetUrl(p: string): string {
  if (typeof require === "undefined") return "";
  const v = require(p) as string | number;
  return typeof v === "number" ? `__ASSET_${v}__` : v;
}

let tensCtx: AudioContext | null = null;
const bufs: Record<string, AudioBuffer | null> = {};
const loading: Record<string, boolean> = {};

function getTensCtx(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!tensCtx) tensCtx = new AudioContext();
  if (tensCtx.state === "suspended") void tensCtx.resume();
  return tensCtx;
}

/** Shared web playback: fetch Metro asset URL → decode → play (best-effort). */
function loadAndPlay(key: string, url: string): void {
  const ctx = getTensCtx();
  if (!ctx) return;
  const doPlay = (buf: AudioBuffer) => {
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(g).connect(ctx.destination);
      src.start();
    } catch {
      /* no-op: audio is best-effort */
    }
  };
  if (bufs[key]) {
    doPlay(bufs[key]!);
    return;
  }
  if (loading[key]) return;
  loading[key] = true;
  fetch(url)
    .then((r) => r.arrayBuffer())
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => {
      bufs[key] = buf;
      loading[key] = false;
      doPlay(buf);
    })
    .catch(() => {
      loading[key] = false;
      /* no-op: asset fetch/decode is best-effort */
    });
}

export function sayTenSeconds(): void {
  loadAndPlay("tens", assetUrl("../../../assets/sounds/tenseconds.wav"));
}

// Easter-egg stage cues (Mario rips — private EE only, not for public builds).
export function soundOneUp(): void {
  loadAndPlay("m1up", assetUrl("../../../assets/sounds/m1up.wav"));
}
export function soundStageClear(): void {
  loadAndPlay("stageclear", assetUrl("../../../assets/sounds/stageclear.wav"));
}

export {
  initAudio,
  soundBleepBleep,
  soundWaa,
  soundDot,
  soundPower,
  soundEatGhost,
  soundDeath,
  soundFruit,
  soundExtraLife,
  soundCoinClink,
  beep,
};
