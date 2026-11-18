// ChamberLanding — the lobby (Phase 3, W3).
//
// Replaces the Phase 2 stub. The user arrives here after the entry ritual
// (AppHeader: tap → ping → password → reauth → navigate). This screen is:
//
//   1. Live occupancy — "N inside" + who's in the room.
//   2. Persona picker — 10 storms, taken ones greyed. Tap a free storm → enter.
//   3. Summon/Dismiss 🦈 Doug — button row, polls doug/status every 3s.
//
// No socket needed for the lobby itself — it uses REST (GET /api/chamber/state)
// which is gate-exempt. The socket (W2) is opened when the user enters the
// room (W4 chat screen).
//
// Persona selection is the bridge to W4: tapping a free persona calls
// onEnter(persona), which the parent (ChamberScreen) uses to open the socket
// and navigate to the chat room.

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootParamList } from "../App";
import { colors } from "../src/theme";
import { chamberGate } from "../src/chamberGate";
import type { ChamberState, ChamberPersona, DougStatus } from "../src/apiTypes";
import { config } from "../config/app-config";

import { oneLine } from "../src/textFit";
type Nav = NativeStackNavigationProp<RootParamList, "Chamber">;

interface Props {
  /** Called when the user taps a free persona. The parent opens the socket
   *  and navigates to the chat room (W4). */
  onEnter: (persona: string) => void;
}

// ---------------------------------------------------------------------------
// REST helpers (gate-exempt endpoints — no token needed)
// ---------------------------------------------------------------------------

const base = () => config.serverUrl.replace(/\/+$/, "");

async function fetchChamberState(): Promise<ChamberState | null> {
  try {
    const res = await fetch(`${base()}/api/chamber/state`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ChamberState;
  } catch {
    return null;
  }
}

async function fetchDougStatus(): Promise<DougStatus | null> {
  try {
    const res = await fetch(`${base()}/api/chamber/doug/status`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as DougStatus;
  } catch {
    return null;
  }
}

async function summonDoug(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const token = await chamberGate.getGateToken();
    const res = await fetch(`${base()}/api/chamber/doug/summon`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gate-Token": token },
    });
    if (res.status === 401) {
      // Server restarted → token rotated. Clear cache so next call re-mints.
      chamberGate.clearGateToken();
      const fresh = await chamberGate.getGateToken();
      const res2 = await fetch(`${base()}/api/chamber/doug/summon`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gate-Token": fresh },
      });
      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok) return { ok: false, reason: data2.detail || `server ${res2.status}` };
      return { ok: true, reason: data2.reason };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: data.detail || `server ${res.status}` };
    return { ok: true, reason: data.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}

async function dismissDoug(): Promise<{ ok: boolean }> {
  try {
    const token = await chamberGate.getGateToken();
    const res = await fetch(`${base()}/api/chamber/doug/dismiss`, {
      method: "POST",
      headers: { "X-Gate-Token": token },
    });
    if (res.status === 401) {
      chamberGate.clearGateToken();
      const fresh = await chamberGate.getGateToken();
      await fetch(`${base()}/api/chamber/doug/dismiss`, {
        method: "POST",
        headers: { "X-Gate-Token": fresh },
      });
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChamberLanding({ onEnter }: Props) {
  const navigation = useNavigation<Nav>();
  const [state, setState] = useState<ChamberState | null>(null);
  const [doug, setDoug] = useState<DougStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset stale state on mount (lobby unmounts while in chat; Doug may have
  // idle-quit in the meantime — don't show "Doug in room" from the old render).
  useEffect(() => {
    setState(null);
    setDoug(null);
    setLoading(true);
  }, []);
  const [busy, setBusy] = useState(false); // persona entry / summon in flight
  const [dougBusy, setDougBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([fetchChamberState(), fetchDougStatus()]);
    if (s) {
      setState(s);
      setError(null);
    } else {
      setError("Can't reach the chamber. Is the server up?");
    }
    if (d) setDoug(d);
    setLoading(false);
  }, []);

  // Initial load + 5s poll (lightweight REST, not socket).
  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  // The entry ritual (AppHeader) already re-authed the user — the gate token
  // should be cached in memory by chamberGate. If not (e.g. app restarted
  // mid-session), mint it now so Summon/Dismiss works without a round-trip.
  useEffect(() => {
    chamberGate.getGateToken().catch(() => { /* offline or wrong passphrase — Summon/Dismiss will surface it */ });
  }, []);

  const enterPersona = useCallback(
    async (p: ChamberPersona) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      // Hand off to the parent — it opens the socket and navigates to chat.
      onEnter(p.persona);
      // busy is released by the parent on navigation (or stays if they go back).
    },
    [busy, onEnter],
  );

  const onSummon = useCallback(async () => {
    if (dougBusy) return;
    setDougBusy(true);
    const res = await summonDoug();
    if (!res.ok && res.reason) setError(`Summon failed: ${res.reason}`);
    setDougBusy(false);
    load(); // refresh
  }, [dougBusy, load]);

  const onDismiss = useCallback(async () => {
    if (dougBusy) return;
    setDougBusy(true);
    await dismissDoug();
    setDougBusy(false);
    load(); // refresh
  }, [dougBusy, load]);

  // Build the full persona list (all 10 storms, in server order).
  const takenSet = new Set((state?.occupants ?? []).map((o) => o.persona));
  const availableSet = new Set((state?.available ?? []).map((a) => a.persona));
  // The full list = available ∪ taken (in server order: available first, then taken).
  const allPersonas: ChamberPersona[] = [
    ...(state?.available ?? []),
    ...(state?.occupants ?? []).filter((o) => !o.is_bot),
  ].filter((p) => p.persona !== "Monsoon");

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accentSoft} />
        <Text style={styles.loadingText}>Opening the chamber…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        {/* ── Occupancy header ── */}
        <View style={styles.occupancy}>
          <Text style={styles.occupancyEmoji}>🚀</Text>
          <View style={styles.occupancyText}>
            <Text {...oneLine} style={styles.occupancyTitle}>Chamber of Chaos</Text>
            <Text style={styles.occupancySub}>
              {state ? (state.count > 0 ? `${state.count} inside` : "empty — chaos awaits") : "…"}
            </Text>
          </View>
        </View>

        {/* ── Summon / Dismiss Doug ── */}
        <View style={styles.section}>
          <View style={styles.dougRow}>
            <Text style={styles.dougStatus}>
              {doug?.running
                ? "🦈 In the room"
                : doug?.llm_available
                ? "Ready to summon"
                : "Model offline"}
            </Text>
            {doug?.running ? (
              <TouchableOpacity
                style={[styles.dougBtn, styles.dougBtnDismiss]}
                onPress={onDismiss}
                disabled={dougBusy}
              >
                <Text style={styles.dougBtnText}>{dougBusy ? "…" : "Dismiss"}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.dougBtn, !doug?.llm_available && styles.dougBtnOff]}
                onPress={onSummon}
                disabled={dougBusy || !doug?.llm_available}
              >
                <Text style={styles.dougBtnText}>{dougBusy ? "Summoning…" : "Summon 🦈"}</Text>
              </TouchableOpacity>
            )}
          </View>
          {doug && !doug.llm_available && !doug.running && (
            <Text style={styles.dougNote}>His model is down — can't summon right now.</Text>
          )}
        </View>

        {/* ── Persona picker ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Choose your storm</Text>
          <View style={styles.picker}>
            {allPersonas.map((p) => {
              const taken = takenSet.has(p.persona) && !availableSet.has(p.persona);
              return (
                <TouchableOpacity
                  key={p.persona}
                  style={[styles.pickerCard, taken && styles.pickerCardTaken]}
                  onPress={() => !taken && enterPersona(p)}
                  disabled={taken || busy}
                  activeOpacity={taken ? 1 : 0.7}
                >
                  <Text style={styles.pickerEmoji}>{p.emoji}</Text>
                  <Text {...oneLine} style={[styles.pickerName, taken && styles.pickerNameTaken]}>
                    {p.persona}
                  </Text>
                  {taken && <Text style={styles.takenBadge}>taken</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Error ── */}
        {error && <Text style={styles.error}>{error}</Text>}

        {/* ── Footer ── */}
        <Text style={styles.footer}>
          Persona-only. No history. The header above is always here — you can always get out.
        </Text>
        </ScrollView>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 12,
  },
  // Occupancy header
  occupancy: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    padding: 12,
    backgroundColor: colors.cardRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  occupancyEmoji: {
    fontSize: 26,
    marginRight: 12,
  },
  occupancyText: {
    flex: 1,
  },
  occupancyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  occupancySub: {
    color: colors.accentSoft,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  // Sections
  section: {
    marginBottom: 14,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  // Occupant chips
  occupantRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  occupantChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardRaised,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    padding: 6,
    paddingRight: 12,
  },
  occupantEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  occupantName: {
    fontSize: 13,
    fontWeight: "700",
  },
  // Persona picker
  picker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pickerCard: {
    width: "31%",
    aspectRatio: 1,
    backgroundColor: colors.cardRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  pickerCardTaken: {
    opacity: 0.4,
  },
  pickerEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  pickerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  pickerNameTaken: {
    color: colors.faint,
  },
  takenBadge: {
    color: colors.faint,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
  },
  // Doug row
  dougRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.cardRaised,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  dougStatus: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  dougBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  dougBtnDismiss: {
    backgroundColor: colors.danger,
  },
  dougBtnOff: {
    backgroundColor: colors.faint,
  },
  dougBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  dougNote: {
    color: colors.faint,
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  // Error
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  // Footer
  footer: {
    color: colors.faint,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 14,
    paddingBottom: 40,
  },
});
