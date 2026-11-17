// dialMath.ts — PURE value/physics math for the DialValue rolling selector.
//
// Kept RN-free so it's unit-testable in Node (tsx can't load react-native).
// The DialValue component is just gestures -> these functions -> a <View>.
//
// Model (fling + friction decay + snap, like a slot reel / iOS time picker):
//   * value = clamp(round(-y / ROW_H), 0, max); y is the strip's top offset.
//   * A flick carries velocity (px/ms); on release it coasts, v *= FRICTION
//     each frame, until |v| < STOP_V — then it snaps to the nearest row.
//   * Wraparound: 0 <-> max loop, so any value is reachable the short way.

export const ROW_H = 44; // px per digit row (Dials v2: 48->44 so the selected row is obvious)

// Dials v2 physics: snappier snap, less "coast forever".
const FRICTION = 0.72; // per-frame velocity retention (16ms frames)
const STOP_V = 0.55; // px/ms — below this, the coast stops and we snap
const MAX_STEPS = 8; // cap fling travel to a deliberate 3-8 rows (no 40-swipes, no coast-forever)

/** Snap a y offset to the nearest row boundary. */
export function snapY(y: number, rowH: number = ROW_H): number {
  const s = Math.round(y / rowH) * rowH;
  return s === 0 ? 0 : s; // normalize -0 -> 0 (Object.is distinguishes them)
}

/** Total signed distance (px) a fling coasts before stopping.
 *  v0 in px/ms; v0>0 = coasting upward (value increasing). */
export function decayDistance(
  v0: number,
  friction: number = FRICTION,
  stopV: number = STOP_V,
  dt = 16,
): number {
  if (v0 === 0) return 0;
  const sign = v0 > 0 ? 1 : -1;
  let v = Math.abs(v0);
  let dist = 0;
  let guard = 0;
  while (v > stopV && guard++ < 1200) {
    dist += v * dt; // px this frame (v is px/ms, dt is ms)
    v *= friction;
  }
  return sign * dist;
}

/** Final value (CLAMPED to [0, max]) after a fling from `from` with velocity
 *  `v` px/ms. No wraparound on fling — flick speed maps monotonically to
 *  distance (fast = far, slow = near). Wraparound is only used for SLOW swipes
 *  that drag past the edge (the component handles that). THIS is the function
 *  the test locks down. */
export function flingTarget(from: number, v: number, max: number, rowH: number = ROW_H): number {
  if (max <= 0) return 0;
  const dist = decayDistance(v); // signed px
  const delta = Math.round(dist / rowH); // up (v>0) => +values
  // Dials v2: cap travel to MAX_STEPS, then clamp to [0, max]. No wrap.
  const capped = from + Math.max(-MAX_STEPS, Math.min(MAX_STEPS, delta));
  return Math.max(0, Math.min(max, capped)); // clamp, no wrap
}

/** Wrap an arbitrary index to a value in [0, max] (slot-dial style). */
export function wrapIndex(idx: number, max: number): number {
  if (max <= 0) return 0;
  return ((idx % (max + 1)) + (max + 1)) % (max + 1);
}
