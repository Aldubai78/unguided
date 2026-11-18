// TimerScreen.tsx — the Timer UI. LiftDex-style red-LED hero clock, 3
// capitalized mode pills (UP / DOWN / EMOM), a state title above the clock,
// and the config form + 3 buttons. Reads/writes the single shared timer via
// useTimer() (STEP 3).
//
// LOCKED behaviors (projects/unguided/TIMER-DESIGN.md):
//   * Big hero clock, MM:SS, per-digit LED wells (4 digits + colon).
//   * The 10-second start windup renders AS A DIGIT in the clock (00:00 -> 10),
//     NOT as separate text.
//   * THREE mode pills (UP / DOWN / EMOM); selected lit, rest dim; locked while
//     running. Tapping a pill opens the CONFIG FORM (Confirm just SAVES).
//   * A STATE TITLE sits above the clock: "<MODE> MM:SS" (the selected config
//     when idle, the live mode while running).
//   * The ONLY button that starts the timer is the main START button.
//   * STOP/RESET is a plain two-click button. CLEAR = kill switch (FreakConfirm).
//   * Re-entering the page while active re-shows the footer (markReentered).
//
// The global footer (STEP 5) is rendered in App.tsx, NOT here.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  BackHandler,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTimer } from "../src/TimerContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FreakConfirm, { FreakConfirmHandle } from "../components/FreakConfirm";
import DialValue, { type DialValueRef } from "../components/DialValue";
import { fmtClock, MAX_SEC, type TimerConfig, type TimerMode } from "../src/timerEngine";
import { shadow } from "../src/theme";

import { oneLine } from "../src/textFit";
// Mode metadata: id -> display label (capitalized). UP = stopwatch (counts up),
// DOWN = countdown (counts down), EMOM = per-window.
const MODE_LABEL: Record<TimerMode, string> = {
  stopwatch: "UP",
  countdown: "DOWN",
  emom: "EMOM",
};
const MODES: TimerMode[] = ["stopwatch", "countdown", "emom"];

const DEFAULTS: Record<TimerMode, { seconds: number; workSec: number; totalSec: number }> = {
  stopwatch: { seconds: 1200, workSec: 60, totalSec: 60 }, // default UP 20:00
  countdown: { seconds: 60, workSec: 60, totalSec: 60 },
  emom: { seconds: 600, workSec: 120, totalSec: 600 },
};

/** seconds -> "MM:SS" for input display. */
function toMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/** Break a clock value into its 4 display digits for the LED wells.
 *  windup -> the single windup number (e.g. "10", "7"); else "MM:SS" -> [M,M,S,S]. */
function displayDigits(ms: number, windup: number | null): (string | ":")[] {
  if (windup != null) {
    // The windup number sits in the two SECOND wells (e.g. 10 -> [0,0,:,1,0]).
    const s = String(windup).padStart(2, "0");
    return ["0", "0", ":", s[0], s[1]];
  }
  const t = fmtClock(ms); // "MM:SS"
  return [t[0], t[1], ":", t[3], t[4]];
}

// Full-size width of the LED clock: 4 wells × 70 + colon 18 + 4 gaps × 10
// + 16 padding and 2 border on each side. Wider than a standard iPhone's
// content area (e.g. 354pt on a 402pt-wide phone), so it scales down to fit.
const CLOCK_NATURAL_W = 4 * 70 + 18 + 4 * 10 + 2 * 16 + 2 * 2;
const SCROLL_SIDE_PAD = 24;

/** Clock dimensions scaled by k (1 = the original fixed design). */
function clockMetrics(k: number) {
  return {
    frame: { paddingVertical: 12 * k, paddingHorizontal: 16 * k, gap: 10 * k },
    colon: { width: 18 * k, height: 104 * k, gap: 14 * k },
    dot: { width: 8 * k, height: 8 * k, borderRadius: 4 * k },
    well: { width: 70 * k, height: 104 * k },
    digit: { fontSize: 82 * k, lineHeight: 104 * k },
  };
}

export default function TimerScreen() {
  const navigation = useNavigation<any>();
  const t = useTimer();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const clock = useMemo(
    () => clockMetrics(Math.min(1, (screenW - 2 * SCROLL_SIDE_PAD) / CLOCK_NATURAL_W)),
    [screenW],
  );
  const [selected, setSelected] = useState<TimerMode>("stopwatch"); // default UP 20:00
  const [showConfig, setShowConfig] = useState(false);
  // Refs to the dial components — confirmConfig reads their live values.
  const dialSecMin = useRef<DialValueRef>(null);
  const dialSecSec = useRef<DialValueRef>(null);
  const dialWorkMin = useRef<DialValueRef>(null);
  const dialWorkSec = useRef<DialValueRef>(null);
  const dialRounds = useRef<DialValueRef>(null);
  // Config form inputs (strings) + the saved config.
  const [cfgDraft, setCfgDraft] = useState(() => ({
    seconds: toMMSS(DEFAULTS.stopwatch.seconds), // 20:00
    workSec: toMMSS(DEFAULTS.emom.workSec),
    totalSec: toMMSS(DEFAULTS.emom.totalSec),
  }));
  // NOTE: there is NO screen-local config state. The engine (t.state.cfg) is
  // the SINGLE source of truth for the current config. The `selected` pill and
  // `cfgDraft` form below only exist while the config sheet is open; Confirm
  // writes them into the engine via t.setReady(), and from then on the UI
  // reads t.state.cfg. That kills the whole "two copies disagreeing" bug class.
  // FreakConfirm handle (set by the <FreakConfirm/> child). open() resolves
  // {ok} on armed-confirm, {ok:false} on cancel.
  const [freak, setFreak] = useState<FreakConfirmHandle | null>(null);

  // Android back button: close the config sheet instead of leaving the screen.
  useEffect(() => {
    if (!showConfig) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowConfig(false);
      return true;
    });
    return () => sub.remove();
  }, [showConfig]);

  // iOS: disable native-stack swipe-back while the sheet is open.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !showConfig });
  }, [showConfig, navigation]);

  // Re-entering the page while active -> re-show the footer.
  useFocusEffect(
    useCallback(() => {
      if (t.state.kind !== "idle") t.markReentered();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t.state.kind]),
  );

  // Keep the selected pill in sync with the ENGINE config whenever we're NOT
  // editing in the sheet. (While the sheet is open, `selected` is a pending
  // edit and must not be clobbered.) This is what makes the pill row the true
  // mirror of the single source of truth.
  useEffect(() => {
    if (!showConfig && t.state.cfg) setSelected(t.state.cfg.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig, t.state.cfg?.mode]);

  const active = t.state.kind !== "idle";
  // ---- 4-STATE MACHINE (locked) ---------------------------------------------
  //   CLEAR   : no config, no run.            -> pills (UP/DOWN/EMOM) only. Footer hidden.
  //   READY   : config set ("Ready to start"). -> pills + Start + Clear.         Footer "READY".
  //   RUNNING : windup OR counting.           -> Stop/Reset only.               Footer timer.
  //   PAUSED  : frozen mid-run.               -> Start(resume) + Stop/Reset(to READY) + Clear. Footer timer.
  // Derivation: arming or running => RUNNING; paused => PAUSED; idle-with-cfg
  //             => READY; idle-no-cfg => CLEAR.
  const state: "clear" | "ready" | "running" | "paused" =
    t.isArming || t.state.kind === "running"
      ? "running"
      : t.state.kind === "paused"
        ? "paused"
        : t.state.kind === "idle" && t.state.cfg
          ? "ready"
          : "clear";
  const running = state === "running";
  const paused = state === "paused";
  const idle = state === "clear" || state === "ready"; // pills available
  // Enabled matrix:
  //   CLEAR   -> pills (U/D/E)
  //   READY   -> pills + Start + Clear
  //   RUNNING -> Stop/Reset only
  //   PAUSED  -> Start + Stop/Reset + Clear
  const canStart = state === "ready" || state === "paused";
  const canStopReset = state === "running" || state === "paused";
  const canClear = state === "ready" || state === "paused";
  const canPills = state === "clear" || state === "ready";

  // --- Single source of truth ----------------------------------------------
  // The engine's cfg is THE config. When the config sheet isn't open, the
  // selected pill simply mirrors it, so the pill row and the clock always
  // agree. (While the sheet is open, `selected`/`cfgDraft` are a pending edit
  // that only lands in the engine on Confirm.)
  const engineCfg = t.state.cfg;
  const liveMode: TimerMode = engineCfg?.mode ?? selected;

  // --- Hero clock value + state title --------------------------------------
  // Windup renders as a digit in the clock (00:00 -> 10).
  const heroWindup = t.isArming ? t.windupNum : null;
  const heroMs = t.isArming ? 0 : t.heroMs;
  const digits = displayDigits(heroMs, heroWindup);
  const digitColor = t.isArming ? "#ffb02e" : "#ff2d3a";
  // State title = the ENDGAME (total length), not the live count. It stays fixed
  // for the whole run: UP 20:00 (target) / DOWN 20:00 (duration) / EMOM 20:00
  // (total). Derived purely from the engine cfg — no default fallback, so CLEAR
  // (cfg null) shows NOTHING (a blank slate) and can never leak a "20:00" or a
  // mode label. READY/RUNNING/PAUSED (cfg set) show the endgame.
  const endgameMs = engineCfg
    ? ((engineCfg.mode === "emom" ? engineCfg.totalSec : engineCfg.targetSec) ?? 0) * 1000
    : null;
  const titleStr =
    endgameMs === null ? "" : `${MODE_LABEL[liveMode]} ${fmtClock(endgameMs)}`;
  const isEmom = liveMode === "emom";
  const progress = t.totalMs > 0 ? Math.min(1, t.elapsedMs / t.totalMs) : 0;

  // Open the config form for a mode (only when not running).
  // Seeds the form from the ENGINE config when it's the same mode; otherwise
  // the sensible defaults for that mode.
  const openConfig = useCallback(
    (mode: TimerMode) => {
      if (!canPills) return; // locked: can't switch while running/paused
      setSelected(mode);
      const c = t.state.cfg;
      setCfgDraft({
        seconds: toMMSS(c && c.mode === mode ? c.targetSec : DEFAULTS[mode].seconds),
        workSec: toMMSS(c && c.mode === mode && c.workSec != null ? c.workSec : DEFAULTS.emom.workSec),
        totalSec: toMMSS(c && c.mode === mode && c.totalSec != null ? c.totalSec : DEFAULTS.emom.totalSec),
      });
      setShowConfig(true);
    },
    [canPills, t.state.cfg],
  );

  // Confirm/OK on the form: SAVE the config into the engine (does NOT start).
  // This is the ONLY place a pending form edit becomes the real config.
  const confirmConfig = useCallback(() => {
    // Dials are uncontrolled (refs own the live values).
    const secMin = dialSecMin.current?.getValue() ?? 0;
    const secSec = dialSecSec.current?.getValue() ?? 0;
    const workMin = dialWorkMin.current?.getValue() ?? 0;
    const workSecVal = dialWorkSec.current?.getValue() ?? 0;
    const rounds = dialRounds.current?.getValue() ?? 1;

    const seconds = secMin * 60 + secSec;
    const workSec = workMin * 60 + workSecVal;
    // EMOM: total length = rounds × window per round.
    const totalSec = rounds * workSec;

    const cfg: TimerConfig =
      selected === "emom"
        ? { mode: "emom", targetSec: totalSec, workSec, totalSec }
        : { mode: selected, targetSec: seconds };
    t.setReady(cfg);
    setShowConfig(false);
  }, [selected, t]);

  // START: from READY -> arm the 10s windup (state becomes RUNNING at 0); from
  // PAUSED -> RESUME (continue from the frozen position).
  const doStart = useCallback(() => {
    if (state === "running" || state === "ready") {
      // READY -> start fresh: arm the windup from the ENGINE config; the real
      // timer starts at 0. (In CLEAR there's no cfg and Start is disabled.)
      const c = t.state.cfg;
      if (c) t.armStart(c);
    } else if (state === "paused") {
      t.resume();
    }
  }, [state, t]);

  // STOP/RESET (fixed label; context-sensitive):
  //   RUNNING -> PAUSE (freeze, keep position + cfg)  ["stop"]
  //   PAUSED  -> RESET TO READY (throw the position, keep the cfg)  ["reset"]
  const doStopReset = useCallback(() => {
    if (state === "running") {
      t.pause();
    } else if (state === "paused") {
      // Discard the paused position, go to READY (engine cfg retained, fresh next Start).
      const c = t.state.cfg;
      if (c) t.resetToReady(c);
    }
  }, [state, t]);

  // CLEAR — kill switch. READY: confirm then clear. PAUSED: confirm then clear.
  // (Both clear to the CLEAR state: no config, footer hidden.)
  const doClear = useCallback(async () => {
    if (!freak) return;
    const res = await freak.open({
      title: "Kill the timer?",
      body: "This clears the timer AND its config. You'll start from scratch.",
      okText: "Kill it",
    });
    if (!res.ok) return;
    t.clear(); // engine -> cfg null (CLEAR); the title/footer follow automatically
    setSelected("stopwatch"); // reset the selected pill to UP
  }, [freak, t]);

  return (
    <View style={styles.root}>
      {/* Header + back chevron are provided by the stack's global AppHeader. */}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* HERO CLOCK — LiftDex red LED */}
        <View style={styles.heroWrap}>
          {/* State title: "UP 20:00" / "DOWN 20:00" / "EMOM 20:00". Hidden in
              CLEAR (no config) — blank slate, no dead vertical space. */}
          {titleStr ? <Text {...oneLine} style={styles.stateTitle}>{titleStr}</Text> : null}
          {/* 4-digit LED display */}
          <View style={[styles.clockFrame, clock.frame]}>
            {digits.map((d, i) =>
              d === ":" ? (
                <View key={i} style={[styles.colon, clock.colon]}>
                  <View style={[styles.colonDot, clock.dot]} />
                  <View style={[styles.colonDot, clock.dot]} />
                </View>
              ) : (
                <View key={i} style={[styles.well, clock.well]}>
                  <Text allowFontScaling={false} style={[styles.digit, clock.digit, { color: digitColor }]}>{d}</Text>
                  <View style={styles.wellReflect} />
                </View>
              ),
            )}
          </View>
          {/* Progress bar */}
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
          </View>
          {/* Emom round line — round counter ONLY (no "MM:SS left") */}
          {isEmom && active && (
            <Text style={styles.roundLine}>
              Round {t.round ?? "—"} / {t.totalRounds}
            </Text>
          )}
        </View>

        {/* MODE PILLS — UP / DOWN / EMOM */}
        <View style={styles.pillRow}>
          {MODES.map((id) => {
            // Pills pressable only in CLEAR/READY. Dim otherwise.
            const dim = !canPills || (active && selected !== id);
            const lit = selected === id && !dim;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.pill, lit && styles.pillLit, dim && styles.pillDim]}
                onPress={() => openConfig(id)}
                disabled={!canPills}
                activeOpacity={0.7}
              >
                <Text style={[styles.pillText, lit && styles.pillTextLit, dim && styles.pillTextDim]}>
                  {MODE_LABEL[id]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* THREE BUTTONS */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.btn, styles.btnStart, !canStart && styles.btnDim]}
            onPress={doStart}
            disabled={!canStart}
            activeOpacity={0.85}
          >
            <Text style={[styles.btnStartText, !canStart && styles.btnTextDim]}>Start</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, !canStopReset && styles.btnDim]}
            onPress={doStopReset}
            disabled={!canStopReset}
            activeOpacity={0.85}
          >
            <Text style={[styles.btnText, !canStopReset && styles.btnTextDim]}>Stop/Reset</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnClear, !canClear && styles.btnDim]}
            onPress={() => void doClear()}
            disabled={!canClear}
            activeOpacity={0.85}
          >
            <Text style={[styles.btnClearText, !canClear && styles.btnTextDim]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* CONFIG FORM (sets the timer; Confirm only saves) */}
      {/* Full-screen overlay View (not <Modal>): keeps dials in the same view
          hierarchy so PanResponder works. Rendered as the LAST child so it
          stacks above everything. zIndex + elevation cover iOS + Android. */}
      {showConfig && (
        <View style={styles.overlay}>
          {/* Backdrop: closes on tap. Rendered BEFORE the sheet so the sheet
              is above it (z-order = document order for same-parent siblings). */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowConfig(false)} />
          <View
            style={styles.sheet}
            accessibilityViewIsModal
            importantForAccessibility={"no-hide-descendants"}
          >
            <Text style={styles.sheetTitle}>{MODE_LABEL[selected]}</Text>

            {selected === "emom" ? (
              <View style={styles.dialField}>
                <Text style={styles.fieldLabel}>Window (per round)</Text>
                <View style={styles.dialPair}>
                  <DialValue
                    ref={dialWorkMin}
                    value={parseInt(cfgDraft.workSec.split(":")[0], 10)}
                    max={59}
                    label="min"
                    onChange={() => {}}
                  />
                  <DialValue
                    ref={dialWorkSec}
                    value={parseInt(cfgDraft.workSec.split(":")[1], 10)}
                    max={59}
                    label="sec"
                    onChange={() => {}}
                  />
                </View>
                <Text style={styles.fieldLabel}>Rounds</Text>
                <DialValue
                  ref={dialRounds}
                  value={Math.min(99, Math.max(1, Math.round(
                    (parseInt(cfgDraft.totalSec.split(":")[0], 10) * 60 + parseInt(cfgDraft.totalSec.split(":")[1], 10))
                    / Math.max(1, parseInt(cfgDraft.workSec.split(":")[0], 10) * 60 + parseInt(cfgDraft.workSec.split(":")[1], 10))
                  )))}
                  max={99}
                  label="rounds"
                  onChange={() => {}}
                />
              </View>
            ) : (
              <View style={styles.dialField}>
                <Text style={styles.fieldLabel}>{selected === "stopwatch" ? "Target (count up to)" : "Duration"}</Text>
                <View style={styles.dialPair}>
                  <DialValue
                    ref={dialSecMin}
                    value={parseInt(cfgDraft.seconds.split(":")[0], 10)}
                    max={59}
                    label="min"
                    onChange={() => {}}
                  />
                  <DialValue
                    ref={dialSecSec}
                    value={parseInt(cfgDraft.seconds.split(":")[1], 10)}
                    max={59}
                    label="sec"
                    onChange={() => {}}
                  />
                </View>
              </View>
            )}

            <View style={styles.sheetBtns}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setShowConfig(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnOk]} onPress={confirmConfig}>
                <Text style={styles.btnOkText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <FreakConfirm handle={setFreak} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },

  heroWrap: { alignItems: "center", marginBottom: 28 },
  // State title: "UP 20:00" — small, letter-spaced, above the clock.
  stateTitle: {
    color: "#ff5a64",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 14,
  },
  // The clock bezel — a thin dark frame holding the segmented digit wells.
  clockFrame: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#030303",
    borderStyle: "solid",
    borderWidth: 2,
    borderColor: "#262626",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  // One digit "well" — a dark segmented cell (LCD-style).
  well: {
    width: 70,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
    borderRadius: 6,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "#191919",
  },
  // The lit LCD digit (red glow).
  digit: {
    fontSize: 82,
    fontFamily: "monospace",
    fontWeight: "800",
    lineHeight: 104,
    // RN-web renders textShadow as a glow around the glyph.
    textShadowColor: "rgba(255,45,58,0.85)",
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  // Faint ghost reflection of the digit (LCD sheen).
  wellReflect: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.04)",
  },
  // Colon = two stacked dots (segmented, not a hyphen).
  colon: {
    width: 18,
    height: 104,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  colonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff2d3a",
  },
  // Progress bar under the clock (thin, LED-red).
  barTrack: { width: 260, height: 5, backgroundColor: "#1a1a1a", borderRadius: 3, marginTop: 18, overflow: "hidden", borderStyle: "solid", borderWidth: 1, borderColor: "#242424" },
  barFill: { height: 5, backgroundColor: "#ff2d3a", borderRadius: 3 },
  roundLine: { marginTop: 12, color: "#888", fontSize: 14 },

  pillRow: { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 28 },
  pill: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
  },
  pillLit: { backgroundColor: "#ffd24d", borderColor: "#ffd24d", ...shadow.glow }, // Grok 5e: gold glow — the one place it earns its keep
  dialField: { alignItems: "center" },
  dialPair: { flexDirection: "row", gap: 14, justifyContent: "center", marginBottom: 18 },
  pillDim: { opacity: 0.4 },
  // Disabled state for the 3 action buttons — same dim treatment as the pills.
  btnDim: { opacity: 0.4 },
  btnTextDim: { color: "#777" },
  pillText: { color: "#bbb", fontSize: 15, fontWeight: "700", letterSpacing: 1 },
  pillTextLit: { color: "#1a1a1a" },
  pillTextDim: { color: "#777" },

  btnRow: { flexDirection: "row", gap: 12 },
  btn: { flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: "center", backgroundColor: "#1c1c1c", borderWidth: 1, borderColor: "#2c2c2c" },
  btnText: { color: "#e6e6e6", fontSize: 16, fontWeight: "700" },
  btnStart: { backgroundColor: "#2e7d32", borderColor: "#2e7d32" },
  btnStartText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  btnClear: { backgroundColor: "#3a1414", borderColor: "#5a2020" },
  btnClearText: { color: "#ff8a8a", fontSize: 16, fontWeight: "700" },

  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    elevation: 100,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: { backgroundColor: "#161616", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10 },
  sheetTitle: { color: "#f2f2f2", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  fieldLabel: { color: "#999", fontSize: 13, fontWeight: "600", marginTop: 6 },

  sheetBtns: { flexDirection: "row", gap: 12, marginTop: 16 },
  btnGhost: { backgroundColor: "#1c1c1c" },
  btnGhostText: { color: "#bbb", fontSize: 15, fontWeight: "700" },
  btnOk: { backgroundColor: "#ffd24d", borderColor: "#ffd24d" },
  btnOkText: { color: "#1a1a1a", fontSize: 15, fontWeight: "800" },
});
