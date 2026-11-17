// History screen (Phase 3.0 S5).
//
// Faithful port of 8001's ogView('history') (gymforge.html:1172–1524,
// ogHistoryCard 1478, ogLogMatches 1512, ogRenderHistory 1517).
//
// Layout (8001 — single flat, searchable, deletable list. NO Recent/Oldest
// split, NO Enter-PR form. Logs only.):
//   1. Toolbar — ☑ Select All · 🗑 Delete (n) · ⬆ Import CSV · 🔍 Search
//   2. Import report line (8002-style, after a successful import)
//   3. List (ogHistoryList) — one card per log, newest-first.
//
// Card (ogHistoryCard):
//   [x]  dd/mm/yy   [pill]
//        s1 · s2 · s3
//   - date: stored YYYY-MM-DD -> shown dd/mm/yy
//   - pill: entry_id ? 'class' : imported ? 'imported' : 'open gym'
//   - strings: manual rows read lift / weight+" kg" / note; imported rows read
//     c1 / c2 / c3. Empty -> "—". Only this group wraps to a 2nd line.
//
// Data is read live from localStore (device is source of truth). Search is
// client-side (no re-fetch). Delete is checkbox-driven (full-adopt deleteLogs).
import React, { useCallback, useMemo, useState } from "react";
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
import FreakConfirm, { type FreakConfirmHandle } from "../components/FreakConfirm";
import { pickCsvFile } from "../components/pickCsvFile";
import { importHistoryCsv } from "../src/importHistoryCsv";
import type { WorkoutLog } from "../src/apiTypes";
import { colors, radius, type, spacing, touch, shadow, list } from "../src/theme";

// --- 8001 display helpers (verbatim ports) ---
// ogHistoryCard: dayRaw = completed_at.slice(0,10); if 3 parts -> dd/mm/yy.
const ogHistDate = (v: string): string => {
  const dayRaw = (v || "").slice(0, 10);
  const p = dayRaw.split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0].slice(-2) : dayRaw;
};

// A detail row is either {lift, weight, note} (manual) or {c1, c2, c3} (imported).
type DetRow = Record<string, unknown>;

// ogHistoryCard: isImported = det[0].c1 !== undefined.
const isImportedRow = (l: WorkoutLog): boolean => {
  const det = (l.details as DetRow[]) || [];
  return det.length > 0 && (det[0] as DetRow).c1 !== undefined;
};

// ogHistoryCard: the three strings. manual -> lift / weight+" kg" / note;
// imported -> c1 / c2 / c3. Empty -> "" (rendered as "—").
const histStrings = (l: WorkoutLog): [string, string, string] => {
  const det = (l.details as DetRow[]) || [];
  const strings: DetRow = det.length ? (det[0] as DetRow) : {};
  const imp = isImportedRow(l);
  const s1 = imp ? String(strings.c1 || "") : String(strings.lift || "");
  const s2 = imp
    ? String(strings.c2 || "")
    : strings.weight != null
      ? String(strings.weight) + " kg"
      : "";
  const s3 = imp ? String(strings.c3 || "") : String(strings.note || "");
  return [s1, s2, s3];
};

// ogLogMatches: search everything — date, notes, and every free-text cell
// (c1/c2/c3/lift/note), case-insensitive.
const ogLogMatches = (l: WorkoutLog, q: string): boolean => {
  const det = (l.details as DetRow[]) || [];
  const hay = [
    (l.completed_at || "").slice(0, 10),
    l.notes || "",
    ...det.map((s) =>
      [s.c1, s.c2, s.c3, s.lift, s.note]
        .filter((x) => x !== undefined && x !== null)
        .join(" "),
    ),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
};

export default function HistoryScreen() {
  const { user, refreshSessions } = useAuth();
  const memberId = user?.member_id ?? 0;

  // --- Data (live from localStore, completed_at DESC) ---
  const [logs, setLogs] = useState<WorkoutLog[]>(() => localStore.listLogs(memberId));
  const refresh = useCallback(() => {
    setLogs(localStore.listLogs(memberId));
  }, [memberId]);

  // --- Search (client-side, no re-fetch — 8001 ogAllLogs cache) ---
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => ogLogMatches(l, q));
  }, [logs, search]);

  // --- Checkbox selection (8001 ogSelected / ogVisibleIds) ---
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  const [importConfirm, setImportConfirm] = useState<FreakConfirmHandle | null>(null);
  // 8002-style import report.
  const [importReport, setImportReport] = useState<{
    ok: boolean;
    added: number;
    skipped: number;
    errors: number;
  } | null>(null);
  const [importErrorMsg, setImportErrorMsg] = useState<string | null>(null);

  // --- 8001: visible ids = filtered list's ids (select-all targets visible) ---
  const visibleIds = useMemo(
    () => filtered.map((l) => l.id).filter((x): x is number => x != null),
    [filtered],
  );

  // --- Select All / Clear (8001 ogHistSelectAll) ---
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

  // --- Delete selected (8001 ogHistDeleteSelected -> FreakConfirm) ---
  const onDeleteSelected = useCallback(async () => {
    if (selected.size === 0 || !confirm) return;
    const res = await confirm.open({
      title: "DELETE WORKOUTS?",
      body: `Remove ${selected.size} selected workout${selected.size > 1 ? "s" : ""}?`,
      okText: "🔥 Delete them",
    });
    if (res.ok) {
      localStore.deleteLogs(memberId, Array.from(selected));
      setSelected(new Set());
      refresh();
      refreshSessions(); // refresh OpenGymLanding "Last 10 sessions" card
    }
  }, [selected, confirm, memberId, refresh, refreshSessions]);

  // --- Row renderer (8001 ogHistoryCard) ---
  // `key` on the root View so .map() lists don't trip the "unique key" warning
  // (restored rows can share a millisecond id).
  const renderRow = (l: WorkoutLog, key?: string | number) => {
    const [s1, s2, s3] = histStrings(l);
    const cell = (t: string) => <Text style={styles.hcell}>{t || "—"}</Text>;
    const pill = l.entry_id ? "class" : isImportedRow(l) ? "imported" : "open gym";
    return (
      <View style={styles.histCard} key={key}>
        <View style={styles.histTop}>
          {l.id != null ? (
            <TouchableOpacity
              onPress={() => toggleOne(l.id)}
              style={[styles.checkbox, selected.has(l.id) && styles.checkboxChecked]}
            >
              {selected.has(l.id) ? <Text style={styles.checkmark}>✓</Text> : null}
            </TouchableOpacity>
          ) : (
            <View style={styles.checkboxSpacer} />
          )}
          <Text style={styles.histDate}>{ogHistDate(l.completed_at)}</Text>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{pill}</Text>
          </View>
        </View>
        <View style={styles.histStrings}>
          {cell(s1)}
          <Text style={styles.hsep}>·</Text>
          {cell(s2)}
          <Text style={styles.hsep}>·</Text>
          {cell(s3)}
        </View>
      </View>
    );
  };

  const n = selected.size;

  // --- Import CSV (device-local, S5 — 4-column history format) ---
  // ONE FreakConfirm, TWO gates (same as S4 PR import):
  //   GATE 1 = format info  -> "Yes, I'm ready" (or cancel)
  //   GATE 2 = "I hope you backed up" last-chance (or cancel)
  //   confirm -> picker -> parse -> dedup -> insert -> report
  const onImportCsv = useCallback(async () => {
    if (!importConfirm) return;
    const existing = localStore.listLogs(memberId);

    // GATE 1: the INFO (format spec). 8002 history = 4 columns, no header.
    const ok1 = await importConfirm.open({
      emoji: "📥",
      title: "IMPORT WORKOUT HISTORY",
      body:
        "Your CSV must have 4 columns, no header row:\n\n" +
        "date, c1, c2, c3\n" +
        "21/09/26, Back Squat, 190, warm up\n" +
        "22/09/26, Fran, 5:34, \n\n" +
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

    // Device-dedup key: date + c1 + c2 + c3 (case/whitespace-insensitive),
    // mirroring the port's internal in-file dedup but against the device.
    const key = (d: string, c1: string, c2: string, c3: string) =>
      [d, c1, c2, c3].map((x) => String(x).trim().toLowerCase()).join("|");
    // Zip each detail row WITH its log's date (the date lives on the log, not
    // the DetRow), so the dedup key can use it. (Previous version leaked `l`
    // across two .map callbacks -> ReferenceError, aborting the import.)
    const existingKeys = new Set(
      existing
        .flatMap((log) =>
          ((log.details as DetRow[]) || []).map(
            (s) => key(log.completed_at, String(s.c1 ?? ""), String(s.c2 ?? ""), String(s.c3 ?? ""))
          )
        ),
    );

    // Run the pure port on the raw text.
    let result;
    try {
      result = importHistoryCsv(picked.text);
    } catch (e) {
      setImportReport({ ok: false, added: 0, skipped: 0, errors: 0 });
      setImportErrorMsg(String((e as Error)?.message ?? e));
      return;
    }

    // Drop port rows already on the device (the port only dedups within the file).
    const freshRows = result.rows.filter(
      (r) => !existingKeys.has(key(r.date_iso, r.c1, r.c2, r.c3)),
    );
    const deviceDupes = result.rows.length - freshRows.length;

    // Insert survivors as imported rows: details = [{c1, c2, c3}] (verbatim).
    // upsertLog assigns a local id (uniqueId()) so each is selectable for delete.
    for (const r of freshRows) {
      localStore.upsertLog({
        member_id: memberId,
        completed_at: r.date_iso,
        details: [{ c1: r.c1, c2: r.c2, c3: r.c3 }],
        total_score: 0,
      });
    }
    refresh();
    refreshSessions(); // refresh OpenGymLanding "Last 10 sessions" card

    // 8002-style report.
    setImportErrorMsg(null);
    setImportReport({
      ok: true,
      added: freshRows.length,
      skipped: result.skipped + deviceDupes,
      errors: result.errors.length,
    });
  }, [memberId, importConfirm, refresh, refreshSessions]);

  // 8001 ogRenderHistory empty states.
  const isEmpty = logs.length === 0;
  const noMatches = !isEmpty && filtered.length === 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* 1. Toolbar (8001: Select All · Delete · Import · Search) */}
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
        <TouchableOpacity
          style={styles.importBtn}
          onPress={onImportCsv}
          activeOpacity={0.7}
        >
          <Text style={styles.importBtnText}>⬆ Import CSV</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Search workouts..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {importReport ? (
        <Text style={importReport.ok ? styles.importMsg : styles.importMsgErr}>
          {importReport.ok
            ? `✓ Imported ${importReport.added} workout${importReport.added === 1 ? "" : "s"}` +
              (importReport.skipped ? ` · skipped ${importReport.skipped}` : "") +
              (importReport.errors ? ` · ${importReport.errors} bad row${importReport.errors === 1 ? "" : "s"}` : "")
            : `✕ Import failed: ${importErrorMsg ?? "unknown error"}`}
        </Text>
      ) : null}

      {/* 2. List (ogHistoryList) — one card per log, newest-first. */}
      {isEmpty ? (
        <Text style={styles.empty}>no workouts logged yet</Text>
      ) : noMatches ? (
        <Text style={styles.empty}>no matches for “{search.trim()}”</Text>
      ) : (
        filtered.map((l, i) => renderRow(l, l.id ?? `h-${i}`))
      )}

      <FreakConfirm handle={setConfirm} />
      <FreakConfirm handle={setImportConfirm} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  empty: { color: colors.faint2, fontSize: 14, fontStyle: "italic" },
  // --- Toolbar (8001: flex row, wrap) ---
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
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
  importMsg: { color: colors.success, fontSize: 13, marginBottom: 8, fontWeight: "600" },
  importMsgErr: { color: colors.danger, fontSize: 13, marginBottom: 8, fontWeight: "600" },
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
  // --- Card (8001 ogHistoryCard) ---
  histCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16, // Grok #3: match PRs card padding (was 14)
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  histTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: list.rowPadY - 4 }, // Grok #3: row rhythm
  histDate: { color: colors.accentSoft, fontSize: 14, fontWeight: "600", width: 72, textAlign: "right", fontVariant: ["tabular-nums"] }, // Grok R2 #2: date -> soft blue; tabular held
  pill: {
    backgroundColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: { color: colors.muted, ...list.listPill }, // 2026-11-01: imported/open gym pill = boring grey (no pop)
  histStrings: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6,
    marginTop: 6,
    paddingLeft: 27, // clears the 18px checkbox + 9px gap (8001 padding-left 1.65rem)
  },
  hcell: { color: colors.text, fontSize: 14 },
  hsep: { color: colors.faint2, fontSize: 14 },
  // --- Checkbox (8001 hist-check) ---
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
});
