/**
 * CalculatorScreen.tsx — S6: Brzycki 1RM Percentage Calculator.
 *
 * Faithful port of 8001 gymforge.html's renderOgCalc (client-side JS).
 * Three cards:
 *   1. Input: 1× reps + weight (kg)
 *   2. Fixed grid: 3×4 percentage weights (col-major, no duplicates)
 *   3. Target %: 6 user-editable % inputs → computed weights
 *
 * No persistence, no localStore, no server. Pure stateless math.
 */
import React, { useState, useCallback, useRef } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { brzycki1rm, round1, pctWeight, GRID_COLS, GRID_ROWS } from "../src/calcMath";
import FreakConfirm, { type FreakConfirmHandle } from "../components/FreakConfirm";
import EggToast, { type EggToastHandle } from "../components/EggToast";
import { getProgress, advance } from "../src/pacmanProgress";
import { listPrs } from "../src/localStore";
import { useAuth } from "../src/AuthContext";
import { colors, radius, type, spacing, touch, shadow } from "../src/theme";

export default function CalculatorScreen() {
  const { user } = useAuth();
  const memberId = user?.member_id ?? 0;
  const insets = useSafeAreaInsets();
  // ── Input state (Card 1) ──────────────────────────────────────────────
  const [repsStr, setRepsStr] = useState("1");
  const [weightStr, setWeightStr] = useState("");
  const repsRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const weightRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const pctRefs = useRef<(React.ComponentRef<typeof TextInput> | null)[]>([
    null, null, null, null, null, null,
  ]);

  // ── Target % state (Card 3) — 6 user-editable inputs ──────────────────
  const [pctStrs, setPctStrs] = useState<string[]>(["", "", "", "", "", ""]);
  // S6.3: egg 4 popup handle (pac-man weight + reps === 5).
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  const [egg, setEgg] = useState<EggToastHandle | null>(null);
  const eggFired = React.useRef(false);
  const showEgg4 = useCallback(
    (w: string) => {
      eggFired.current = true;
      advance(3); // → 4/4
      setTimeout(() => {
        egg?.open({
          title: "🥚 EASTER EGG",
          body: `4/4 — Your 5-rep pac-max is ${w} kg. PAC-MAN unlocked. 🟡`,
          emoji: "🟡",
          okText: "🟡 Let's go",
          color: "#ffe600",
          stage: 4,
        });
      }, 150);
    },
    [egg]
  );

  // ── Derived ───────────────────────────────────────────────────────────
  const reps = parseInt(repsStr, 10) || 0;
  const weight = parseFloat(weightStr);
  const one = brzycki1rm(weight, reps); // null when invalid

  const setPct = (i: number, v: string) => {
    setPctStrs((prev) => prev.map((s, j) => (j === i ? v : s)));
  };

  // S6.3: egg 4 — fires when reps === 5 AND the entered weight matches the
  // numeric weight of a saved PR whose lift contains "Pac-Man" (case-insens).
  // No "calculate" button — the 1RM updates live, so the instant both values
  // are set, the egg fires.
  const checkEgg4 = (wStr: string, r: number) => {
    if (eggFired.current) return;
    if (getProgress() !== 3 || r !== 5) return;
    const w = parseFloat(wStr);
    if (!isFinite(w) || w <= 0) return;
    // Find a saved PR with "pac-man" in the lift and a matching weight.
    const prs = listPrs(memberId);
    const match = prs.find(
      (p) => /pac-man/i.test(p.lift) && p.weight !== null && p.weight === w
    );
    if (match) {
      showEgg4(String(match.weight));
    }
  };
  const onWeightChange = (v: string) => {
    setWeightStr(v);
    checkEgg4(v, reps);
  };
  const onRepsChange = (v: string) => {
    setRepsStr(v);
    const r = parseInt(v, 10) || 0;
    checkEgg4(weightStr, r);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ ...styles.scrollContent, paddingBottom: 80 + insets.bottom }}>
      {/* ── Card 1: Input ─────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.muted}>Enter a set to compute your 1RM &amp; percentages</Text>
        <View style={styles.inputRow}>
          <Text style={styles.inputLabel}>1×</Text>
          <TextInput
            ref={repsRef}
            style={styles.inputSmall}
            placeholder="reps"
            value={repsStr}
            onChangeText={onRepsChange}
            keyboardType="number-pad"
            maxLength={2}
            returnKeyType="next"
            onSubmitEditing={() => weightRef.current?.focus()}
            blurOnSubmit={false}
            testID="calc-reps"
          />
          <TextInput
            ref={weightRef}
            style={styles.inputWide}
            placeholder="weight (kg)"
            value={weightStr}
            onChangeText={onWeightChange}
            keyboardType="decimal-pad"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={() => {}}
            testID="calc-weight"
          />
        </View>
      </View>

      {/* ── Card 2: Fixed 1RM percentage grid ─────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.muted}>1-rep max percentages</Text>
        {one != null ? (
          <View style={styles.grid}>
            {Array.from({ length: GRID_ROWS }, (_, r) =>
              GRID_COLS.map((col, c) => {
                const p = col[r];
                return (
                  <View key={`${r}-${c}`} style={styles.gridCell}>
                    <Text style={styles.gridPct}>{p}%</Text>
                    <Text style={styles.gridVal}>{pctWeight(one, p)}</Text>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <Text style={styles.empty}>—</Text>
        )}
        <Text style={styles.footnote}>Calculated using Brzycki formula</Text>
      </View>

      {/* ── Card 3: Target percentages ────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.muted}>Target percentages — enter any % and get the weight</Text>
        <View style={styles.pctGrid}>
          {pctStrs.map((s, i) => (
            <TextInput
              key={i}
              ref={(ref) => { pctRefs.current[i] = ref; }}
              style={styles.pctInput}
              placeholder="%"
              value={s}
              onChangeText={(v) => setPct(i, v)}
              keyboardType="decimal-pad"
              maxLength={3}
              returnKeyType={i === 5 ? "done" : "next"}
              onSubmitEditing={() => {
                if (i < 5) pctRefs.current[i + 1]?.focus();
              }}
              blurOnSubmit={i < 5}
              testID={`calc-pct-in-${i}`}
            />
          ))}
        </View>
        <View style={styles.divider} />
        <View style={styles.pctGrid}>
          {pctStrs.map((s, i) => {
            const pct = parseFloat(s);
            const valid = one != null && !isNaN(pct) && pct > 0;
            const val = valid ? pctWeight(one, pct) : null;
            return (
              <View key={i} style={styles.pctOutCell}>
                <Text style={styles.pctOutLabel}>{isNaN(pct) ? "—" : `${pct}%`}</Text>
                <Text style={styles.pctOutVal}>{val != null ? val : "—"}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <FreakConfirm handle={setConfirm} />
      <EggToast handle={setEgg} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0a0a0a" },
  scrollContent: { padding: 16, paddingBottom: 80 },

  card: {
    backgroundColor: "#141414",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: 16,
    marginBottom: 12,
  },
  muted: { color: colors.faint, fontSize: 12, marginBottom: 12 },
  footnote: { color: colors.faint2, fontSize: 11, marginTop: 12 },
  empty: { color: colors.faint2, fontSize: 16 },

  // Card 1: input row — label is fixed, inputs flex to fill the rest
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  inputLabel: { color: colors.text, fontSize: 16, fontWeight: "700", width: 28, flex: 0 },
  inputSmall: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: "center",
  },
  inputWide: {
    flex: 2,
    minWidth: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    textAlign: "center",
  },

  // Card 2: fixed grid (3 cols × 4 rows)
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  gridCell: {
    width: "31%",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    paddingVertical: 10,
  },
  gridPct: { color: colors.muted, fontSize: 11 }, // Grok 5d: % labels drop to muted
  gridVal: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 2 },

  // Card 3: target % inputs (3×2)
  pctGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pctInput: {
    width: "31%",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: "center",
  },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.16)", marginVertical: 12 },
  pctOutCell: {
    width: "31%",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    paddingVertical: 10,
  },
  pctOutLabel: { color: colors.faint, fontSize: 11 },
  pctOutVal: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 2 }, // 2026-11-01: match Brzycki grid weights (text, not gold)
});
