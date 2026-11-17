// dom-globals.d.ts — minimal ambient declarations for the BROWSER APIs that
// src/timerAudio.ts uses (Web Audio + Web Speech). The root tsconfig targets
// Node (lib: ES2022, types: node) and has no DOM lib, so these globals are
// otherwise unknown. We declare only the narrow slice we touch — no full DOM
// pull-in, and no `any`. Runtime feature-detection still guards every use
// (the audio no-ops under Node / unsupported browsers), so these are purely
// for the type checker.
//
// (The React app/ tsconfig has the DOM lib and will use its own definitions;
// this file is harmless there.)

interface WindowLike {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
  speechSynthesis?: {
    speak(u: SpeechSynthesisUtterance): void;
    cancel(): void;
  };
}

interface AudioContext {
  readonly currentTime: number;
  readonly state: "suspended" | "running" | "closed";
  readonly destination: AudioNode;
  resume(): Promise<void> | void;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

interface AudioNode {
  connect(destination: AudioNode): AudioNode;
}

interface GainNode extends AudioNode {
  gain: {
    setValueAtTime(v: number, t: number): void;
    exponentialRampToValueAtTime(v: number, t: number): void;
  };
}

interface OscillatorNode extends AudioNode {
  type: string;
  frequency: { value: number };
  start(t?: number): void;
  stop(t?: number): void;
}

interface SpeechSynthesisUtterance {
  constructor(text: string);
  rate: number;
  pitch: number;
}

declare const window: WindowLike;
declare class SpeechSynthesisUtterance {
  constructor(text: string);
  rate: number;
  pitch: number;
}

declare const AudioContext: new () => AudioContext;
