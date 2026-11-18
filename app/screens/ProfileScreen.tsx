// Profile screen (Phase 2.1 S6 — S7 wires the 3 buttons).
//
// S6 delivers: member identity + LIVE on-device dataset counts (from S5's
// localStore) + sign-out. The 3 action buttons (Back up · Restore ·
// Check for updates) are rendered here as S6 placeholders; S7 replaces their
// onPress stubs with the real sync handlers (push=replace server,
// pull=replace phone, stub).
import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useAuth } from "../src/AuthContext";
import { config } from "../config/app-config";
import FreakConfirm, { FreakConfirmHandle } from "../components/FreakConfirm";
import SavedModal from "../components/SavedModal";
import { ApiError } from "../src/api";

import { oneLine } from "../src/textFit";
export default function ProfileScreen() {
  const { user, counts, signOut, busy, status, setStatus, backup, restore, deleteData, checkUpdates, reauth, api } = useAuth();
  const name = user?.display_name || user?.username || "Member";

  // S7: the real sync handlers live in AuthContext (they own api + localStore +
  // busy + status). The screen gates each destructive one behind the freakin'
  // two-tap confirm, then calls the real handler only after an armed confirm.

  // FreakConfirm handle (set by the <FreakConfirm/> child). open() resolves
  // true on armed-confirm, false on cancel.
  const [freak, setFreak] = useState<FreakConfirmHandle | null>(null);

  // Success-confirmation modal (SavedModal): shown after a backup / restore /
  // delete SUCCEEDS. One "OK" button; closes and stays on Profile.
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  // BACK UP: push — the phone's COMPLETE dataset REPLACES the server copy.
  const onBackup = async () => {
    if (!freak) return;
    const res = await freak.open({
      title: "BACK UP YOUR DATA?",
      body: `This REPLACES the server's backup with your phone's data. Anything on the server that isn't on your phone gets deleted.\n\nYour phone currently holds ${counts.logs} logs · ${counts.prs} PRs.`,
      okText: "🔥 Back it up",
      emoji: "⬆️",
    });
    if (res.ok) void runSync(() => backup(), "backup");
  };

  // Shared online-sync runner: performs the action; if it 401s (dead cached
  // token), re-open the dialog in PASSWORD mode — the user logs in to the
  // server (reauth mints a fresh token), then we retry the action once.
  // The password is the SERVER login, not a "freakin' sure" double-guard.
  const runSync = async (action: () => Promise<string | null>, label: string) => {
    try {
      const msg = await action();
      if (msg) setDoneMsg(msg); // success -> confirmation modal
    } catch (e) {
      // Only a 401 (dead token) triggers the re-login flow. Other errors
      // already surfaced as a status line inside backup()/restore().
      if (!(e instanceof ApiError && e.status === 401)) return;
      const username = user?.username || "";
      if (!freak) return;
      const res = await freak.open({
        title: "SESSION EXPIRED",
        body: `Your server session lapsed. Enter your password to log in to the server and ${label} again.`,
        okText: "🔐 Log in & retry",
        emoji: "🔐",
        password: { label: `Password for ${username}`, placeholder: "your password" },
      });
      if (!res.ok || !res.password) return; // cancelled
      const ok = await reauth(username, res.password);
      if (!ok) return; // wrong password / offline — status already shown
      try {
        const msg = await action(); // retry now that we have a fresh token
        if (msg) setDoneMsg(msg);
      } catch {
        // second failure surfaced by backup()/restore()
      }
    }
  };

  // RESTORE: pull — the server's copy REPLACES the on-device dataset.
  const onRestore = async () => {
    if (!freak) return;
    const res = await freak.open({
      title: "RESTORE FROM SERVER?",
      body: `This REPLACES your phone's data with the server's backup. Anything on your phone that isn't on the server is gone.\n\nYour phone currently holds ${counts.logs} logs · ${counts.prs} PRs.`,
      okText: "🔥 Restore it",
      emoji: "⬇️",
    });
    if (res.ok) void runSync(() => restore(), "restore");
  };

  // CHECK FOR UPDATES: harmless stub, no confirm needed.
  const onCheckUpdates = () => void checkUpdates();

  // CHANGE PASSWORD: 3-field modal (current, new, confirm) via FreakConfirm
  // multi-password mode. Client validation, then POST /api/gymforge/me/change-password.
  const onChangePassword = async () => {
    if (!freak) return;
    const res = await freak.open({
      title: "🔑 CHANGE YOUR PASSWORD?",
      body: "Enter your current password and your new password (min 6 chars). You'll use the new one from your next sign-in.",
      okText: "🔑 Update password",
      emoji: "🔑",
      passwords: [
        { label: "Current password", placeholder: "current" },
        { label: "New password", placeholder: "new (min 6 chars)" },
        { label: "Confirm new password", placeholder: "confirm new" },
      ],
    });
    if (!res.ok || !res.passwords) return;
    const [cur, nw, nw2] = res.passwords;
    // Client validation (mirrors the 8002 web flow).
    if (!cur) return;
    if (nw.length < 6) {
      setStatus({ kind: "err", text: "New password must be at least 6 characters." });
      return;
    }
    if (nw !== nw2) {
      setStatus({ kind: "err", text: "New password and confirmation do not match." });
      return;
    }
    await runSync(async () => {
      const r = await api.post<Record<string, string>>("/app/change-password", {
        current_password: cur,
        new_password: nw,
        confirm_password: nw2,
      });
      if (!r.res.ok) {
        const detail = (r.data as Record<string, string>)?.detail;
        throw new ApiError(r.res.status, detail || `server ${r.res.status}`);
      }
      return "✅ Password updated. Use the new one from your next sign-in.";
    }, "change password");
  };

  // DELETE: wipe ALL on-device data. Was the old in-place two-tap arm; now the
  // same freakin' modal so the whole screen shares one danger pattern.
  const onDelete = async () => {
    if (!freak) return;
    const res = await freak.open({
      title: "BURY IT?",
      body: `This deletes ALL on-device data for ${user?.display_name ?? "this user"} — ${counts.logs} logs · ${counts.prs} PRs — permanently. The server backup is untouched, but you'll have to restore to get it back.`,
      okText: "🗑 Delete it all",
      emoji: "💀",
    });
    if (!res.ok) return;
    const msg = await deleteData();
    if (msg) setDoneMsg(msg);
  };

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text {...oneLine} style={styles.name}>{name}</Text>
        {user ? (
          <Text style={styles.meta}>
            member #{user.member_id ?? "?"} · role {user.role}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>ON-DEVICE DATA</Text>
        <View style={styles.row}>
          <Text style={styles.statLabel}>WORKOUT LOGS</Text>
          <Text style={styles.statValue}>{counts.logs}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.statLabel}>PERSONAL RECORDS</Text>
          <Text style={styles.statValue}>{counts.prs}</Text>
        </View>
        <Text style={styles.hint}>source of truth · full-adopt sync</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={onBackup} disabled={busy} testID="profile-backup">
          <Text style={styles.btnText}>Back up data</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onRestore} disabled={busy} testID="profile-restore">
          <Text style={styles.btnText}>Restore data</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onCheckUpdates} disabled={busy} testID="profile-updates">
          <Text style={styles.btnText}>Check for updates</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => void onChangePassword()} disabled={busy} testID="profile-change-pw">
          <Text style={styles.btnText}>🔑 Change password</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.deleteBtn]}
          onPress={() => void onDelete()}
          disabled={busy}
          testID="profile-delete"
        >
          <Text style={styles.btnText}>Delete data</Text>
        </TouchableOpacity>
      </View>

      {busy ? (
        <Text style={styles.statusBusy} testID="profile-busy">… syncing</Text>
      ) : status ? (
        <Text style={status.kind === "ok" ? styles.statusOk : styles.statusErr} testID="profile-status">
          {status.text}
        </Text>
      ) : null}

      <TouchableOpacity style={styles.signout} onPress={() => void signOut()} testID="profile-signout">
        <Text style={styles.signoutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.foot}>{config.serverUrl} · v{config.appVersion}</Text>
      </ScrollView>
      <FreakConfirm handle={setFreak} />
      <SavedModal
        visible={doneMsg !== null}
        title="Done"
        sub={doneMsg ?? undefined}
        buttonLabel="OK"
        onOK={() => setDoneMsg(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#111" },
  scroll: { flex: 1 },
  scrollContent: { padding: 24 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 14, padding: 18, marginBottom: 16 },
  name: { fontSize: 24, fontWeight: "700", color: "#fff" },
  meta: { fontSize: 13, color: "#888", marginTop: 4 },
  sectionLabel: { fontSize: 12, color: "#666", letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  statLabel: { fontSize: 13, color: "#aaa" },
  statValue: { fontSize: 13, color: "#4af", fontWeight: "700" },
  hint: { fontSize: 11, color: "#555", marginTop: 8 },
  actions: { gap: 12, marginBottom: 12 },
  btn: { backgroundColor: "#2a2a2a", borderRadius: 10, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#333" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  deleteBtn: { backgroundColor: "#2a1515", borderColor: "#5a2a2a" },
  statusOk: { color: "#4f8", fontSize: 13, textAlign: "center", marginBottom: 12 },
  statusErr: { color: "#f66", fontSize: 13, textAlign: "center", marginBottom: 12 },
  statusBusy: { color: "#4af", fontSize: 13, textAlign: "center", marginBottom: 12, opacity: 0.7 },
  signout: { alignItems: "center", padding: 14 },
  signoutText: { color: "#f66", fontSize: 15 },
  foot: { marginTop: "auto", color: "#555", fontSize: 11, textAlign: "center" },
});
