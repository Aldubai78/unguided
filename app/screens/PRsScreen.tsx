// PRs screen (Phase 3.0 S4).
//
// Faithful port of 8001's ogView('prs') (gymforge.html:1375–1350).
// Layout:
//   1. Enter PR (card) — lift + value (weight OR time) + date + Save
//   2. Toolbar — Select All · 🗑 Delete (n) · 🔍 Search
//   3. Recent — 5 most recent BESTS (newest→oldest)
//   4. Oldest — 5 oldest BESTS (oldest→newest)
//   5. Full history — every PR (checkbox-selectable)
//
// Data is read live from localStore (device is source of truth).
// Bests use bestPerLift (port of ogPrsBestByLift). Search filters by
// lift + value + date (same haystack as 8001). Delete is checkbox-driven.
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useAuth } from "../src/AuthContext";
import { localStore } from "../src/localStore";
import { bestPerLift } from "../src/bestPerLift";
// 8001's ogPrTime: "M:SS" (minutes NOT zero-padded, seconds padded).
// PR time_value is stored in SECONDS (unlike fmtClock, which takes ms).
const ogPrTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m + ":" + String(sec).padStart(2, "0");
};
import FreakConfirm, { type FreakConfirmHandle } from "../components/FreakConfirm";
import { getProgress, advance } from "../src/pacmanProgress";
import EggToast, { type EggToastHandle } from "../components/EggToast";
import { DateDials } from "../components/DateDials";
import { clampDate, daysInMonth } from "../components/dialDate";
import SavedModal from "../components/SavedModal";
import { pickCsvFile } from "../components/pickCsvFile";
import { importPrsCsv } from "../src/importPrsCsv";
import type { Pr } from "../src/apiTypes";
import { colors, radius, type, spacing, touch, shadow, list } from "../src/theme";

// --- 8001 display helpers (verbatim ports) ---
const ogPrDate = (v: string): string => {
  if (!v) return "—";
  const parts = String(v).slice(0, 10).split("-").reverse().slice(0, 3);
  return parts.map((x, i) => (i === 2 ? x.slice(2) : x)).join("/");
};

const ogPrVal = (i: Pr): string =>
  i.time_value != null
    ? ogPrTime(i.time_value) + " ⏱"
    : i.weight != null
      ? `${i.weight} kg`
      : "—";

// --- Calendar helpers for the date dials (leap-year aware) ---
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// clampDate + daysInMonth now live in components/dialDate.ts (shared with
// EnterWorkout) — imported above.

export default function PRsScreen() {
  const { user } = useAuth();
  const memberId = user?.member_id ?? 0;

  // --- Data (live from localStore, most-recent-first) ---
  const [prs, setPrs] = useState<Pr[]>(() => localStore.listPrs(memberId));
  const refresh = useCallback(() => {
    setPrs(localStore.listPrs(memberId));
  }, [memberId]);

  // --- Enter PR form state (8001: single value field, ':' → time) ---
  const [liftText, setLiftText] = useState("");
  const [valText, setValText] = useState("");
  const liftRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const valRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // Date entry as three dials (DD / MM / YYYY) — same component as the timer.
  // Seeded to today. Day 1-31, month 1-12, year 2000-2099 (invalid days clamp on save).
  const today = new Date();
  const [dateDay, setDateDay] = useState(today.getDate());
  const [dateMonth, setDateMonth] = useState(today.getMonth() + 1);
  const [dateYear, setDateYear] = useState(today.getFullYear());
  const [formMsg, setFormMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Success beat: the "✓ recorded" modal (SavedModal). Stays on the PR screen —
  // the OK button just dismisses it. (Enter Workout navigates home; PRs stays.)
  const [saved, setSaved] = useState(false);
  const [savedSub, setSavedSub] = useState("");

  // --- Search ---
  const [search, setSearch] = useState("");

  // --- Checkbox selection (8001: ogPrsSelected / ogPrsVisible) ---
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  // S6.3: easter-egg popup handle (egg 3 — PR lift match).
  const [egg, setEgg] = useState<EggToastHandle | null>(null);
  // Import CSV: ONE FreakConfirm, TWO gates. Tap 1 arms -> shows the ROAST (the
  // info from gate 1 stays on screen); tap 2 -> fires. Snapshot captured here.
  const [importConfirm, setImportConfirm] = useState<FreakConfirmHandle | null>(null);
  // 8002-style import report (shown after a successful import).
  const [importReport, setImportReport] = useState<{
    ok: boolean;
    added: number;
    skipped: number;
    errors: number;
  } | null>(null);
  // Error line for the import report (e.g. a bad time that made the port throw).
  const [importErrorMsg, setImportErrorMsg] = useState<string | null>(null);

  // --- Derived: filtered list (8001 match: lift + value + date haystack) ---
  const filtered = useMemo(() => {
    if (!search.trim()) return prs;
    const q = search.trim().toLowerCase();
    return prs.filter((i) => {
      const val =
        i.time_value != null
          ? ogPrTime(i.time_value)
          : i.weight != null
            ? String(i.weight)
            : "";
      const hay = [i.lift || "", val, ogPrDate(i.achieved_at)].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [prs, search]);

  // --- Bests (8001: ogPrsBestByLift on filtered items) ---
  const bests = useMemo(() => bestPerLift(filtered), [filtered]);

  // --- Recent / Oldest (8001: sort bests by date, slice 5) ---
  const byDateDesc = useCallback(
    (a: Pr, b: Pr) => String(b.achieved_at || "").localeCompare(String(a.achieved_at || "")),
    [],
  );
  const byDateAsc = useCallback(
    (a: Pr, b: Pr) => String(a.achieved_at || "").localeCompare(String(b.achieved_at || "")),
    [],
  );
  const recent = useMemo(
    () => [...bests].sort(byDateDesc).slice(0, 5),
    [bests, byDateDesc],
  );
  const oldest = useMemo(
    () => [...bests].sort(byDateAsc).slice(0, 5),
    [bests, byDateAsc],
  );

  // --- 8001: visible ids = filtered list's ids (for select-all) ---
  const visibleIds = useMemo(
    () => filtered.map((p) => p.id).filter((x): x is number => x != null),
    [filtered],
  );

  // --- Enter PR submit (8001 ogRecordPr: single value, ':' → time) ---
  const onSubmit = useCallback(() => {
    const lift = liftText.trim();
    const valRaw = valText.trim();
    if (!lift) {
      setFormMsg({ kind: "err", text: "lift or benchmark required" });
      return;
    }
    if (!valRaw) {
      setFormMsg({ kind: "err", text: "enter a weight or time" });
      return;
    }

    const isTime = valRaw.includes(":");
    let weight: number | null = null;
    let timeValue: number | null = null;

    if (isTime) {
      // 8001: /^\d{1,3}(:\d{1,2}){1,2}$/  (M:SS or H:MM:SS)
      const m = valRaw.match(/^(\d{1,3}):(\d{1,2})$/);
      const m2 = valRaw.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
      if (m2) {
        timeValue =
          parseInt(m2[1], 10) * 3600 +
          parseInt(m2[2], 10) * 60 +
          parseInt(m2[3], 10);
      } else if (m) {
        timeValue = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      } else {
        setFormMsg({ kind: "err", text: "time must be M:SS (e.g. 5:34)" });
        return;
      }
    } else {
      const w = parseFloat(valRaw);
      if (isNaN(w) || w <= 0) {
        setFormMsg({ kind: "err", text: "weight must be a positive number" });
        return;
      }
      weight = w;
    }

    // Clamp invalid calendar dates (e.g. 31/04) to the month's last day.
    const cd = clampDate(dateYear, dateMonth, dateDay);
    const achievedAt = `${cd.y}-${String(cd.m).padStart(2, "0")}-${String(cd.d).padStart(2, "0")}`;
    const wasClamped = cd.d !== dateDay || cd.m !== dateMonth || cd.y !== dateYear;
    localStore.insertPr({ member_id: memberId, lift, weight, time_value: timeValue, achieved_at: achievedAt });

    // 8001: "✓ recorded — <lift> best <value>". Now a modal beat (SavedModal)
    // that stays on the PR screen (OK dismisses). The date-clamp warning, when
    // present, becomes the modal's sub-line.
    const best = bestPerLift([...prs, { member_id: memberId, lift, weight, time_value: timeValue, achieved_at: achievedAt, id: Date.now() }]).find(
      (p) => p.lift.trim().toLowerCase() === lift.toLowerCase(),
    );
    const bestStr = best ? ogPrVal(best) : "—";
    // Modal sub-line: lift + best value, plus a clamp warning if the dialed
    // date didn't exist (e.g. 31/04 → 30/04).
    const clampNote = wasClamped
      ? `\n⚠ ${MONTH_NAMES[cd.m - 1]} only has ${daysInMonth(cd.y, cd.m)} days — saved as ${String(cd.d).padStart(2,"0")}/${String(cd.m).padStart(2,"0")}/${String(cd.y).slice(2)}`
      : "";
    // Second line of the modal sub: which PR was logged + its new best.
    setSavedSub(`${lift} · best ${bestStr}${clampNote}`);
    setFormMsg(null);
    setSaved(true);
    setLiftText("");
    setValText("");
    refresh();
    // S6.3: egg 3 — a PR with "Pac-Man" in the lift advances 2→3.
    // (The PR is already saved; the egg is a side effect, never blocks.)
    if (getProgress() === 2 && /pac-man/i.test(lift)) {
      advance(2); // → 3/4
      setTimeout(() => {
        egg?.open({
          title: "🥚 EASTER EGG",
          body: "3/4 unlocked! What's your 5-rep pac-max?",
          emoji: "🥚",
          okText: "🥚 Nice",
          stage: 3,
        });
      }, 150);
    }
  }, [liftText, valText, dateDay, dateMonth, dateYear, prs, memberId, refresh]);

  // Close the "✓ recorded" modal — stays on the PR screen (no navigation).
  const dismissSaved = useCallback(() => {
    setSaved(false);
    setSavedSub("");
  }, []);

  // --- Delete selected (8001: ogPrsDeleteSelected → FreakConfirm) ---
  const onDeleteSelected = useCallback(async () => {
    if (selected.size === 0 || !confirm) return;
    const res = await confirm.open({
      title: "DELETE PRs?",
      body: `Remove ${selected.size} selected PR${selected.size > 1 ? "s" : ""}?`,
      okText: "🔥 Delete them",
    });
    if (res.ok) {
      localStore.deletePrs(memberId, Array.from(selected));
      setSelected(new Set());
      refresh();
    }
  }, [selected, confirm, memberId, refresh]);

  // --- Select All / Clear (8001: ogPrsSelectAll) ---
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(visibleIds) : new Set());
    },
    [visibleIds],
  );

  const toggleOne = useCallback((id: number | undefined) => {
    if (id == null) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Row renderer (8001 ogPrsRow: lift · pill value · date; optional checkbox) ---
  // `key` is applied to the root View so .map() lists don't trip the
  // "unique key" warning (restored rows can share a millisecond id).
  const renderRow = (pr: Pr, selectable: boolean, key?: string | number) => (
    <View style={styles.row} key={key}>
      {selectable && pr.id != null ? (
        <TouchableOpacity
          onPress={() => toggleOne(pr.id)}
          style={[styles.checkbox, selected.has(pr.id) && styles.checkboxChecked]}
        >
          {selected.has(pr.id) ? <Text style={styles.checkmark}>✓</Text> : null}
        </TouchableOpacity>
      ) : (
        <View style={styles.checkboxSpacer} />
      )}
      <Text style={styles.rowLift}>{pr.lift}</Text>
      <View style={styles.pill}>
        <Text style={styles.pillText}>{ogPrVal(pr)}</Text>
      </View>
      <Text style={styles.rowDate}>{ogPrDate(pr.achieved_at)}</Text>
    </View>
  );

  const n = selected.size;

  // --- Import CSV (device-local, S4) ---
  // ONE FreakConfirm, TWO gates:
  //   gate 1 = the INFO (format spec) shown on open
  //   GATE 1 = format info  -> "Yes, I'm ready" (or cancel)
  //   GATE 2 = "I hope you backed up" last-chance (or cancel)
  //   confirm -> picker -> parse -> dedup -> insert -> report
  // The gate is pure text + buttons. No snapshot, no backup, no undo. The user
  // owns their data; this is just a gate.
  const onImportCsv = useCallback(async () => {
    if (!importConfirm) return;
    const existing = localStore.listPrs(memberId);

    // GATE 1: the INFO (format spec). Just tell the user what the CSV needs.
    const ok1 = await importConfirm.open({
      emoji: "📥",
      title: "IMPORT PRs",
      // singleTap: true — resolve {ok:boolean}; callers must read .ok (object is always truthy).
      body:
        "Your CSV must have 3 columns, no header row:\n\n" +
        "date, lift/benchmark, weight/time\n" +
        "21/09/26, Back Squat, 190\n" +
        "21/09/26, Fran, 5:34\n\n" +
        "Data that doesn't match this format may not import correctly. If your CSV looks wrong, consult your favourite OverLord 🦈 to fix it before importing.",
      okText: "⬆ Yes, I'm ready",
      singleTap: true,
    });
    if (!ok1.ok) return;

    // GATE 2: the LAST CHANCE. One line. No snapshot, no undo, no theater.
    const ok2 = await importConfirm.open({
      emoji: "⚠️",
      title: "LAST CHANCE",
      body: "I hope you backed up your data.",
      okText: "🔥 FREAKIN' CONFIRM",
      singleTap: true,
    });
    if (!ok2.ok) return;

    // --- Picker (after the user is committed). ---
    const picked = await pickCsvFile();
    if (!picked) return; // cancel/empty -> just return; no insert, no report.

    // Run the pure port on the raw text.
    let result;
    try {
      result = importPrsCsv(picked.text);
    } catch (e) {
      // Python raises on a bad time value -> surface it, don't crash the app.
      setImportReport({ ok: false, added: 0, skipped: 0, errors: 0 });
      setImportErrorMsg(String((e as Error)?.message ?? e));
      return;
    }

    // Device-dedup: drop port rows already on the device (same lift + value +
    // date). The port only dedups within the file, so this is the UI's job.
    const key = (lift: string, w: number | null, t: number | null, d: string) =>
      `${lift.trim().toLowerCase()}|${w ?? ""}|${t ?? ""}|${d}`;
    const existingKeys = new Set(existing.map((p) => key(p.lift, p.weight, p.time_value, p.achieved_at)));
    const freshRows = result.rows.filter((r) => !existingKeys.has(key(r.lift, r.weight, r.time_value, r.achieved_at)));
    const deviceDupes = result.rows.length - freshRows.length;

    // Insert the survivors (insertPr assigns a local id = Date.now()).
    for (const r of freshRows) {
      localStore.insertPr({ member_id: memberId, lift: r.lift, weight: r.weight, time_value: r.time_value, achieved_at: r.achieved_at });
    }
    refresh();

    // 8002-style report.
    setImportErrorMsg(null);
    setImportReport({
      ok: true,
      added: freshRows.length,
      skipped: result.skipped + deviceDupes,
      errors: result.errors.length,
    });
  }, [memberId, importConfirm, refresh]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 1. Enter PR (8001 card) */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Enter PR</Text>
        <View style={styles.formCol}>
          <TextInput
            ref={liftRef}
            style={styles.formInput}
            placeholder="lift or benchmark (e.g. Back Squat / Fran)"
            placeholderTextColor="#555"
            value={liftText}
            onChangeText={setLiftText}
            returnKeyType="next"
            onSubmitEditing={() => valRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TextInput
            ref={valRef}
            style={styles.formInput}
            placeholder="weight (kg) / time 00:00"
            placeholderTextColor="#555"
            value={valText}
            onChangeText={setValText}
            returnKeyType="done"
            onSubmitEditing={() => {}}
          />
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
        <TouchableOpacity style={styles.saveBtn} onPress={onSubmit} activeOpacity={0.8}>
          <Text style={styles.saveBtnText}>Save PR</Text>
        </TouchableOpacity>
        {formMsg ? (
          <Text style={[styles.formMsg, formMsg.kind === "ok" ? styles.formMsgOk : styles.formMsgErr]}>
            {formMsg.text}
          </Text>
        ) : null}
      </View>

      {/* 2. Toolbar (8001: Select All · Delete · Search) */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.selectAll}
          onPress={() => toggleSelectAll(!allSelected)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, allSelected && styles.checkboxChecked]}>
            {allSelected ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <Text style={styles.selectAllText}>Select All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteBtn, n === 0 && styles.deleteBtnDisabled]}
          onPress={onDeleteSelected}
          disabled={n === 0}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteBtnText}>
            {n ? `🗑 Delete (${n})` : "🗑 Delete"}
          </Text>
        </TouchableOpacity>
        {/* 8001: ogPrsImport — stub for now (device-local import TBD). */}
        <TouchableOpacity
          style={styles.importBtn}
          onPress={onImportCsv}
          activeOpacity={0.7}
        >
          <Text style={styles.importBtnText}>⬆ Import CSV</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Search PRs..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {importReport ? (
        <Text style={importReport.ok ? styles.importMsg : styles.importMsgErr}>
          {importReport.ok
            ? `✓ Imported ${importReport.added} PR${importReport.added === 1 ? "" : "s"}` +
              (importReport.skipped ? ` · skipped ${importReport.skipped}` : "") +
              (importReport.errors ? ` · ${importReport.errors} bad row${importReport.errors === 1 ? "" : "s"}` : "")
            : `✕ Import failed: ${importErrorMsg ?? "unknown error"}`}
        </Text>
      ) : null}

      {/* 3. Recent — 5 most recent bests */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Recent — 5 most recent bests</Text>
        {recent.length === 0 ? (
          <Text style={styles.empty}>none yet</Text>
        ) : (
          recent.map((pr, i) => renderRow(pr, false, pr.id ?? `r-${i}`))
        )}
      </View>

      {/* 4. Oldest — 5 oldest bests */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Oldest — 5 oldest bests</Text>
        {oldest.length === 0 ? (
          <Text style={styles.empty}>none yet</Text>
        ) : (
          oldest.map((pr, i) => renderRow(pr, false, pr.id ?? `o-${i}`))
        )}
      </View>

      {/* 5. Full history — every PR (selectable) */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Full history — every PR</Text>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>no PRs recorded yet</Text>
        ) : (
          filtered.map((pr, i) => renderRow(pr, true, pr.id ?? `f-${i}`))
        )}
      </View>

      <FreakConfirm handle={setConfirm} />
      <FreakConfirm handle={setImportConfirm} />
      <EggToast handle={setEgg} />

      {/* Success beat — stays on the PR screen. OK just dismisses (no nav). */}
      <SavedModal
        visible={saved}
        title="Saved locally"
        sub={`Logged on this device${savedSub ? "\n" + savedSub : ""}`}
        buttonLabel="OK"
        onOK={dismissSaved}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cardLabel: { color: colors.muted, fontSize: 13, marginBottom: 10 },
  empty: { color: colors.faint2, fontSize: 14, fontStyle: "italic" },
  // --- Enter PR form (8001 .setrow.prform) ---
  formCol: { gap: 6, marginBottom: 8 },
  formInput: {
    backgroundColor: colors.bg,
    borderColor: colors.divider,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: colors.text,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.success,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    alignSelf: "stretch", // full-width → button centred in the form column
  },
  saveBtnText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  formMsg: { fontSize: 13, marginTop: 8 },
  formMsgOk: { color: colors.success },
  formMsgErr: { color: "#f88" },
  // --- Toolbar (8001: flex row, wrap) ---
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    flexWrap: "wrap",
  },
  selectAll: { flexDirection: "row", alignItems: "center", gap: 6 },
  selectAllText: { color: colors.text2, fontSize: 14 },
  deleteBtn: {
    backgroundColor: colors.overlay,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  deleteBtnDisabled: { opacity: 0.45 },
  deleteBtnText: { color: colors.danger, fontSize: 14, fontWeight: "600" },
  importBtn: {
    backgroundColor: colors.border,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  importBtnText: { color: colors.accentSoft, fontSize: 14, fontWeight: "600" },
  importMsg: { color: colors.success, fontSize: 13, marginTop: 8, fontWeight: "600" },
  importMsgErr: { color: colors.danger, fontSize: 13, marginTop: 8, fontWeight: "600" },
  searchInput: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.card,
    borderColor: colors.divider,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
  },
  // --- Rows (8001 ogPrsRow: flex, gap, border-bottom) ---
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: list.rowPadY, // Grok #3: shared list row rhythm
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.faint2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkboxSpacer: { width: 18 },
  checkmark: { color: colors.text, fontSize: 12, fontWeight: "800" },
  rowLift: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
  pill: {
    backgroundColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: { color: colors.gold, ...list.listPill }, // Grok #3: shared badge type (gold color held)
  rowDate: { color: colors.accentSoft, fontSize: 12, width: 72, textAlign: "right", fontVariant: ["tabular-nums"] }, // Grok R2 #2: date -> soft blue; tabular held
});
