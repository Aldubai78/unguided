// TimerFooter.tsx — the read-only banner shown on OTHER screens while a timer
// is running. Mirrors AppHeader's dimensions (bg #111, border #222, two-row
// height) so it reads as "the other banner".
//
// LOCKED behaviors (TIMER-DESIGN.md):
//   * Read-only. Shows the running timer's label + live hero MM:SS.
//   * X = DISMISS (hides the footer; the timer keeps running). NOT a stop.
//   * Tapping the body navigates to the Timer screen (and re-shows itself).
//   * Re-shows only on a FRESH entry while active, or on a NEW start. It is
//     NOT re-shown by mere re-entry after a dismiss (the user chose to hide it).
//
// Rendered once, globally, in App.tsx (inside AuthProvider). It only appears
// when a timer is active AND not dismissed, AND we're not already on the
// Timer screen (the Timer screen shows its own full clock).

import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTimer } from "../src/TimerContext";
import { fmtClock, type TimerMode } from "../src/timerEngine";

import { CHROME_MAX_SCALE } from "../src/textFit";
const MODE_LABEL: Record<TimerMode, string> = {
  stopwatch: "UP",
  countdown: "DOWN",
  emom: "EMOM",
};

export function TimerFooter() {
  const t = useTimer();
  const nav = useNavigation();

  // 4-state derivation (mirrors TimerScreen): arming/running -> RUNNING;
  //  paused -> PAUSED; idle-with-cfg -> READY; idle-no-cfg -> CLEAR.
  const state: "clear" | "ready" | "running" | "paused" =
    t.isArming || t.state.kind === "running"
      ? "running"
      : t.state.kind === "paused"
        ? "paused"
        : t.state.kind === "idle" && t.state.cfg
          ? "ready"
          : "clear";

  // Hidden in CLEAR (nothing to show) and on the Timer screen itself.
  const currentRoute = (nav as unknown as { getCurrentState?: () => { routes: { name: string }[] } }).getCurrentState?.();
  const onTimerScreen = currentRoute?.routes?.[currentRoute.routes.length - 1]?.name === "Timer";

  if (state === "clear" || t.state.dismissed || onTimerScreen) {
    return null;
  }

  // READY -> "READY"; RUNNING(windup) -> windup 10->0; RUNNING/PAUSED -> live clock.
  const arming = t.isArming;
  const cfgMode = (t.state.cfg as { mode?: TimerMode } | null | undefined)?.mode;
  const label =
    state === "ready" ? "⏱" : arming || !cfgMode ? "⏱" : `⏱ ${MODE_LABEL[cfgMode]}`;
  const heroStr =
    state === "ready"
      ? "READY"
      : arming
        ? String(t.windupNum).padStart(2, "0")
        : fmtClock(t.heroMs);
  const sub =
    state !== "ready" && !arming && cfgMode === "emom"
      ? `Round ${t.round ?? "—"} / ${t.totalRounds}`
      : "";

  const goTimer = () => {
    // Re-show the footer (clears dismissed) and navigate to the Timer screen.
    t.markReentered();
    (nav as unknown as { navigate: (n: string) => void }).navigate("Timer");
  };

  return (
    <View style={styles.root}>
      <TouchableOpacity style={styles.body} onPress={goTimer} activeOpacity={0.8}>
        <Text numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.label}>{label}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.clock}>{heroStr}</Text>
        {sub ? <Text numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.sub}>{sub}</Text> : null}
      </TouchableOpacity>
      {/* X = dismiss (timer keeps running). */}
      <TouchableOpacity style={styles.x} onPress={t.dismiss} hitSlop={8} testID="timer-footer-dismiss">
        <Text allowFontScaling={false} style={styles.xText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Normal-flow sibling below the navigator (App.tsx). The navigator's inner
  // View is flex:1 so it shrinks to make room — nothing overlaps, no inset maths.
  root: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  label: { color: "#8ec9f5", fontSize: 14, fontWeight: "700" },
  clock: { color: "#fff", fontSize: 22, fontFamily: "monospace", fontWeight: "800" },
  sub: { color: "#778", fontSize: 12, flex: 1 },
  x: { width: 32, height: 34, alignItems: "center", justifyContent: "center" },
  xText: { color: "#778", fontSize: 18, fontWeight: "700" },
});
