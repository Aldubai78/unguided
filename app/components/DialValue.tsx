// DialValue.tsx — a vertical "rolling dial" numeric selector with INERTIA.
//
// Replaces the mm:ss text inputs in the timer config form (per Allen's call:
// "simple swipe feels like the way", "two vertical snap dials", "we definitely
// need inertia... don't want to make 40 swipes").
//
// Model (fling + friction decay + snap, like a slot reel / iOS time picker):
//   * value = clamp(round(-y / ROW_H), 0, max). y is the strip's top offset.
//   * A DRAG moves y 1:1 (no inertia while the finger is down).
//   * A FLICK keeps a velocity (px/ms); on release it coasts: each frame
//     v *= FRICTION and y += v*dt, until |v| < STOP_V — then it SNAPS to the
//     nearest row. Momentum makes one flick cover 10-30+ steps.
//   * WRAPAROUND: 0 <-> max loop (like a real slot dial), so you can always
//     reach any value in the shorter direction.
//
// The strip is a plain <View> moved by transform (no layout shift). Off-center
// rows fade; the center (live) row is lit in the hero-digit style. Small by
// design — it's a form field, not the display clock.
//
// Pure math lives in the exported helpers below (unit-tested); the component
// only wires gestures -> physics -> <View> transform.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, PanResponder, Easing } from "react-native";

import { ROW_H as DEFAULT_ROW_H, snapY, flingTarget, wrapIndex } from "./dialMath";

import { CHROME_MAX_SCALE } from "../src/textFit";
export { ROW_H, snapY, flingTarget } from "./dialMath";

interface DialValueProps {
  value: number; // min..max (controlled)
  max: number; // e.g. 59
  min?: number; // floor (default 0). Date dials use 1 so "00" is never a row.
  onChange: (v: number) => void;
  label?: string;
  rowH?: number; // px per row (default 48). Smaller for compact date dials.
  width?: number; // well width in px (default 76).
  variant?: "date" | "timer"; // Dials v2: date = soft-blue digits + band; timer = red LCD (default)
}

export interface DialValueRef {
  getValue: () => number;
}

const DialValue = React.forwardRef<DialValueRef, DialValueProps>(
  ({ value, max, min = 0, onChange, label, rowH = DEFAULT_ROW_H, width = 76, variant = "timer" }, ref) => {
  const [y, setY] = useState<number>(-value * rowH);
  const yRef = useRef(y);
  yRef.current = y;
  const animRef = useRef<any>(null);

  // Expose the current value to the parent via ref (for Confirm to read).
  React.useImperativeHandle(ref, () => ({
    getValue: () => Math.max(min, Math.min(max, Math.round(-yRef.current / rowH))),
  }), [max, min, rowH]);

  // Fully uncontrolled after mount: the dial starts at `value` (the saved
  // config) and user gestures are the only thing that moves it. No prop sync
  // after mount — sibling dials share the same cfgDraft string, so syncing from
  // the prop would snap a dial back when its sibling commits.
  const draggingRef = useRef(false);
  const animatingRef = useRef(false); // true while a fling animation is running
  const dragStartY = useRef(0); // y at grant — the drag offset is relative to this
  const dragStartVal = useRef(value); // value at grant — revert target on terminate

  const commit = useCallback(
    (nextY: number) => {
      // Wrap y into the [min..max] band so the strip never runs off into empty
      // space (min=1 for dates means 00 is not a valid row). Value is derived
      // from the wrapped, snapped position and clamped to [min, max].
      const count = max - min + 1;
      const lo = -max * rowH;
      const hi = -min * rowH;
      let wrapped = nextY;
      while (wrapped > hi) wrapped -= count * rowH;
      while (wrapped < lo) wrapped += count * rowH;
      const snapped = snapY(wrapped, rowH);
      const val = Math.max(min, Math.min(max, Math.round(-snapped / rowH)));
      setY(snapped);
      yRef.current = snapped;
      onChange(val);
    },
    [max, min, onChange, rowH],
  );

  const onFling = useCallback(
    (vx: number, vy: number) => {
      // Pre-solve the final value (clamped to [min, max], monotonic with speed).
      const from = Math.max(min, Math.min(max, Math.round(-yRef.current / rowH)));
      let target = flingTarget(from, -vy, max - min, rowH) + min;
      target = Math.max(min, Math.min(max, target));
      // Animate the strip to that value's offset (in-band, no wrap path).
      const finalY = -target * rowH;
      const a = new Animated.Value(yRef.current);
      animRef.current = a;
      animatingRef.current = true; // block the useEffect from re-syncing mid-flight
      Animated.timing(a, {
        toValue: finalY,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        animatingRef.current = false;
        commit(finalY);
      });
    },
    [max, min, commit, rowH],
  );

  const responder = useRef(
    PanResponder.create({
      // Claim the responder aggressively so parent ScrollViews can't steal
      // the drag (Android ScrollView + iOS pan-gesture interference). This
      // makes the dial own ALL vertical drags on its surface.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Never let the responder be taken away mid-gesture — a TERMINATE would
      // revert the dial to its pre-drag value and lose the user's progress.
      onPanResponderTerminationRequest: () => false,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        dragStartY.current = yRef.current; // freeze the resting position
        dragStartVal.current = Math.max(min, Math.min(max, Math.round(-yRef.current / rowH)));
        animRef.current = null;
      },
      onPanResponderMove: (_e, g) => {
        if (draggingRef.current) {
          // Apply the drag offset to the FROZEN start position, not the prop.
          // This lets the strip track the finger smoothly without snapping back
          // to a stale `value` on every parent re-render.
          const next = dragStartY.current + g.dy;
          setY(next);
          yRef.current = next;
          // Commit live so the parent's `value` stays in sync.
          const val = Math.max(min, Math.min(max, Math.round(-next / rowH)));
          onChange(val);
        }
      },
      onPanResponderRelease: (_e, g) => {
        draggingRef.current = false;
        const vy = g.vy; // px/ms, +down
        if (Math.abs(vy) > 0.5) {
          onFling(g.vx, vy);
        } else {
          commit(yRef.current); // no fling -> just snap to nearest row
        }
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        // A TERMINATE means the OS/browser stole the gesture (e.g. a page-scroll
        // won the race). Do NOT snap the stale mid-flight position — that's how
        // a 31/04 flick corrupted to 01/04. Revert to the pre-gesture value.
        animatingRef.current = false;
        const revertY = -dragStartVal.current * rowH;
        setY(revertY);
        yRef.current = revertY;
        onChange(dragStartVal.current);
      },
    }),
  ).current;

  // The strip is a single column of absolutely-positioned rows. Row `idx`
  // (an integer index, not a value) sits at y + idx*rowH from the well top.
  // The CENTER line (row H/2) shows the value at index round(-y/rowH). We
  // render a window of index values around the center so the visible band is
  // always populated, each wrapped to a value in [0, max].
  const centerIdx = Math.round(-y / rowH);
  const visible: { key: string; idx: number; val: number; off: number }[] = [];
  for (let o = -2; o <= 2; o++) {
    const idx = centerIdx + o;
    // Wrap into the [min..max] band so values below `min` (e.g. 00 for dates)
    // are never rendered. min=0 reduces to the original wrapIndex.
    const count = max - min + 1;
    const val = min + (((idx - min) % count) + count) % count;
    visible.push({ key: `${idx}`, idx, val, off: Math.abs(o) });
  }

  const isDate = variant === "date";
  // Dials v2: nudged 26->24 at rowH>=40 so the digit doesn't clip the 44px row.
  const digitSize = rowH >= 40 ? 24 : rowH >= 30 ? 19 : 15;
  return (
    <View
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={[styles.wrap, { touchAction: "none" }] as any}
      {...responder.panHandlers}
    >
      {label ? <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.label}>{label}</Text> : null}
      <View style={[styles.well, { height: rowH * 3, width }]}>
        {visible.map(({ key, idx, val, off }) => (
          <View
            key={key}
            style={[
              styles.row,
              { height: rowH, transform: [{ translateY: y + idx * rowH }] },
            ]}
          >
            <Text
              allowFontScaling={false}
              style={[
                styles.digit,
                { fontSize: digitSize },
                off === 0
                  ? isDate ? styles.digitLitDate : styles.digitLit
                  : isDate ? styles.digitDimDate : styles.digitDim,
                off >= 2 && styles.digitFaded,
              ]}
            >
              {String(val).padStart(2, "0")}
            </Text>
          </View>
        ))}
        {/* Dials v2: highlight treatment is variant-scoped.
            date  -> soft-blue band only (designed system look; no center line)
            timer -> red LCD hairline only (arcade edge preserved; pixel-unchanged) */}
        {isDate ? (
          <View style={[styles.centerBand, { top: rowH, height: rowH }]} pointerEvents="none" />
        ) : (
          <View style={[styles.centerLine, { top: rowH + rowH / 2 }]} pointerEvents="none" />
        )}
      </View>
    </View>
  );
  },
);

DialValue.displayName = "DialValue";

export default DialValue;

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  label: { color: "#8a8a8a", fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
  well: {
    height: DEFAULT_ROW_H * 3,
    width: 76,
    backgroundColor: "#0c0c0c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#242424",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  row: { position: "absolute", height: DEFAULT_ROW_H, width: "100%", alignItems: "center", justifyContent: "center" },
  digit: { fontSize: 26, fontWeight: "800", fontFamily: "monospace", letterSpacing: 1 },
  digitLit: { color: "#ff3b3b", textShadowColor: "rgba(255,59,59,0.55)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
  digitDim: { color: "#5a2a2a" },
  digitFaded: { opacity: 0.35 },
  // Dials v2 soft-blue date palette (accentSoft #60A5FA) — variant="date" only.
  digitLitDate: { color: "#60A5FA", textShadowColor: "rgba(96,165,250,0.45)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } },
  digitDimDate: { color: "#71717A" },
  centerBand: {
    position: "absolute",
    left: 0,
    right: 0,
    // soft blue (accentSoft #60A5FA @ ~10%) — the "this is the selected row" band
    backgroundColor: "rgba(96,165,250,0.10)",
    borderTopWidth: 1,
    borderTopColor: "rgba(96,165,250,0.22)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(96,165,250,0.22)",
  },
  centerLine: {
    position: "absolute",
    left: 8,
    right: 8,
    height: 1,
    // shifted to soft blue to match the band (was a faint red hairline)
    backgroundColor: "rgba(96,165,250,0.30)",
  },
});
