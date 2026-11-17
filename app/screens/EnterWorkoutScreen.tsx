// Enter Workout (Phase 3.0 S3) — the OpenGym free-text log form.
//
// TRUE to the 8001 reference (templates/gymforge/gymforge.html renderOgForm +
// ogSubmit, ~line 1800): ONE date + ONE row of 3 free-text strings
// (lift / weight / notes). There is NO add/remove of rows, NO numeric typing,
// NO totalization, NO rounding, NO calculation. The 3 strings may each be any
// text or empty — they are stored VERBATIM and only ever re-published in the
// Last-10 card (OpenGymLanding.sessionLine) and History search (S5).
//
// This is note capture, not structured set logging. The CrossFit numeric path
// (recordLog.ts / numWeight / totalScore) is deliberately NOT used here.
//
// Flow (device is the source of truth): Save -> localStore.insertLog
//        (details=[{lift,weight,note}], total_score=0) -> refreshSessions/
//        refreshCounts -> success line. NO server call on save. The on-device
//        log appears in Last-10 immediately. The server is only touched by the
//        explicit Backup (api.sync) / Restore (api.pull) actions on the Profile
//        page — never by a workout save.
import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,

} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../src/AuthContext";
import SavedModal from "../components/SavedModal";
import { DateDials } from "../components/DateDials";
import { clampDate } from "../components/dialDate";
import { localStore } from "../src/localStore";
import FreakConfirm, { type FreakConfirmHandle } from "../components/FreakConfirm";
import EggToast, { type EggToastHandle } from "../components/EggToast";
import { getProgress, advance } from "../src/pacmanProgress";
import { colors, radius, type, spacing, touch, shadow, list } from "../src/theme";

/** Today as YYYY-MM-DD (UTC day, matching the reference's new Date().toISOString().slice(0,10)). */
function todayParts(): { d: number; m: number; y: number } {
  const t = new Date();
  return { d: t.getDate(), m: t.getMonth() + 1, y: t.getFullYear() };
}

// Clamp a (d, m, y) to a real calendar date (leap-aware). Invalid combos like
// 31/04 roll back to the month's last day (30/04). Returns the clamped parts +
// whether anything changed (so the UI can show a non-blocking note).
// clampDate now lives in components/dialDate.ts (shared with PRsScreen) — imported above.
const pad2 = (n: number) => String(n).padStart(2, "0");

export default function EnterWorkoutScreen() {
  const navigation = useNavigation();
  const { user, refreshSessions, refreshCounts } = useAuth();
  const today = todayParts();
  const [dateDay, setDateDay] = useState(today.d);
  const [dateMonth, setDateMonth] = useState(today.m);
  const [dateYear, setDateYear] = useState(today.y);
  const [dateNote, setDateNote] = useState<string | null>(null);
  const [lift, setLift] = useState("");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const liftRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const weightRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const noteRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  // S6.3: easter-egg popup handle (egg 2 — weight match).
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  const [egg, setEgg] = useState<EggToastHandle | null>(null);

  const memberId = user?.member_id ?? null;

  const save = async () => {
    if (memberId == null) {
      setMsg({ kind: "err", text: "no member linked to this account" });
      return;
    }
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // Clamp the dialed date to a real calendar date (31/04 -> 30/04) and
      // build YYYY-MM-DD. A clamp shows a non-blocking note, never blocks save.
      const cd = clampDate(dateYear, dateMonth, dateDay);
      const wasClamped = cd.d !== dateDay || cd.m !== dateMonth || cd.y !== dateYear;
      if (wasClamped) {
        setDateNote(`⚠ saved as ${pad2(cd.d)}/${pad2(cd.m)}/${cd.y} (that date doesn't exist)`);
        setTimeout(() => setDateNote(null), 2500);
      }
      const completed_at = `${cd.y}-${pad2(cd.m)}-${pad2(cd.d)}`;
      // Device is the source of truth: write to the on-device store only
      // (free-text, verbatim, no math). NO server call — the server is only
      // touched by the explicit Backup/Restore actions on the Profile page.
      localStore.insertLog({
        member_id: memberId,
        completed_at,
        lift,
        weight,
        note,
      });
      refreshSessions();
      refreshCounts();
      // Clear the form back to a fresh empty row (date stays today) so a fresh
      // entry starts clean. Then show the "Saved locally" modal.
      const t = todayParts();
      setDateDay(t.d);
      setDateMonth(t.m);
      setDateYear(t.y);
      setLift("");
      setWeight("");
      setNote("");
      setMsg(null);
      setSaved(true);
      // S6.3: egg 2 — a workout saved with "Pac-Man" in the weight advances 1→2.
      // (The log is already saved; the egg is a side effect, never blocks.)
      if (getProgress() === 1 && /pac-man/i.test(weight)) {
        advance(1); // → 2/4
        setTimeout(() => {
          egg?.open({
            title: "🥚 EASTER EGG",
            body: "2/4 unlocked! Enter a Pac-Man PR.",
            emoji: "🥚",
            okText: "🥚 Nice",
            stage: 2,
          });
        }, 150);
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "save failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.hint}>
          Free-text notes — anything goes, any field can stay empty. No numbers,
          no math.
        </Text>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Lift</Text>
          <TextInput
            ref={liftRef}
            style={styles.input}
            value={lift}
            onChangeText={setLift}
            placeholder="lift (e.g. Back Squat)"
            placeholderTextColor="#444"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => weightRef.current?.focus()}
            blurOnSubmit={false}
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Weight</Text>
          <TextInput
            ref={weightRef}
            style={styles.input}
            value={weight}
            onChangeText={setWeight}
            placeholder="kg"
            placeholderTextColor="#444"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => noteRef.current?.focus()}
            blurOnSubmit={false}
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            ref={noteRef}
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="notes"
            placeholderTextColor="#444"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
        </View>
        {/* Date — rolling dials (DD / MM / YYYY), compact. */}
        <View style={styles.dateBlock}>
          <Text style={styles.fieldLabel}>📅 Date</Text>
          <DateDials
            day={dateDay}
            month={dateMonth}
            year={dateYear}
            onDay={setDateDay}
            onMonth={setDateMonth}
            onYear={setDateYear}
            size="sm"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, busy && styles.saveBtnBusy]}
          onPress={save}
          disabled={busy}
        >
          <Text style={styles.saveBtnText}>{busy ? "Saving…" : "Save workout"}</Text>
        </TouchableOpacity>

        {msg ? (
          <Text style={[styles.msg, msg.kind === "err" ? styles.msgErr : styles.msgOk]}>
            {msg.text}
          </Text>
        ) : null}
        {dateNote ? (
          <Text style={styles.msgWarn}>{dateNote}</Text>
        ) : null}
      </ScrollView>

      {/* "Saved locally" modal — one action (Back to home), must be tapped. */}
      <SavedModal
        visible={saved}
        title="Saved locally"
        sub="Logged on this device"
        buttonLabel="Back to home"
        onOK={() => navigation.goBack()}
      />
      <FreakConfirm handle={setConfirm} />
      <EggToast handle={setEgg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 18,
  },
  fieldRow: { marginBottom: 10 },
  fieldLabel: { color: colors.accent, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  saveBtn: {
    marginTop: 12,
    backgroundColor: colors.success, // Grok 5b: green save — blue is reserved for nav
    height: list.btn.height, // Grok #2: unified primary button 52 tall
    borderRadius: list.btn.borderRadius, // 16
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { color: "#04121f", fontSize: 16, fontWeight: "700" },
  msg: { marginTop: 16, fontSize: 14, textAlign: "center" },
  msgOk: { color: colors.success },
  msgErr: { color: colors.danger },
  msgWarn: { marginTop: 12, fontSize: 13, textAlign: "center", color: colors.gold },
  dateBlock: { marginTop: 4, marginBottom: 8, alignItems: "center" },
});
