// WWT10Overlay — tappable high-score chip + leaderboard modal (SNAKE-WWT10.md).
//
// Two variants:
//   1. Game over (Snake): "WWT10  BEST 297" — tappable, opens modal.
//   2. In-game (Pac-Man): "BEST 297" pill in the header — tappable, opens modal.
//
// Modal content:
//   - Title: "WWT10 LEADERBOARD"
//   - Two tabs: RX | Scaled
//   - Top 10 list (rank, name, score)
//   - "YOU: rank X — score Y" (if you have a score)
//   - "UPDATE" button → FreakConfirm password → submit → green check
//
// W7: ambient sync state (red/green dot + unguided.snake.submitted.*) removed.
// Update/Backup are explicit actions — no ambient sync indicator.
import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from "react-native";
import { api } from "../src/api";
import type { SnakeDifficulty, LeaderboardResult } from "../src/apiTypes";
import { readCache, writeCache, type BoardKey } from "../src/leaderboardCache";
import FreakConfirm, { type FreakConfirmHandle } from "./FreakConfirm";
import { useAuth } from "../src/AuthContext";

const C = {
  root: "#111",
  chip: "#1a1a1a",
  chipBorder: "#2a2a2a",
  text: "#fff",
  muted: "#888",
  dim: "#666",
  accent: "#4af",
  red: "#f44",
  green: "#4f4",
  modalBg: "#111",
  row: "#1a1a1a",
  rowBorder: "#2a2a2a",
};

export type Board = "snake" | "pacman";

interface Props {
  /** Score to display on the chip. */
  score: number;
  /** Which difficulty this chip represents. */
  diff: SnakeDifficulty;
  /** Which board this chip drives: snake (rx/scaled tabs, snake endpoints) or
   *  pacman (single board, pacman endpoints). Default "snake" (W6). */
  board?: Board;
  /** Label: "WWT10" (Snake) or "TOP" (Pac-Man). */
  label?: string;
  /** Open the modal immediately on mount (direct-to-wwt10 mode). */
  initialOpen?: boolean;
  /** Called when the modal is closed (OK/Back). */
  onClose?: () => void;
  /** Digits to pad score to (default 3). */
  scoreDigits?: number;
  /** Called when the modal is about to open (e.g. to pause the game). */
  onOpen?: () => void;
}

export default function WWT10Overlay({ score, diff, board = "snake", label = "WWT10", initialOpen = false, onClose, scoreDigits = 3, onOpen }: Props) {
  const isPacman = board === "pacman";
  const [modalOpen, setModalOpen] = useState(initialOpen);

  const [data, setData] = useState<LeaderboardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  const { reauth, user, dataVersion } = useAuth();
  // Board key: pacman is a single board; snake is rx/scaled by difficulty.
  const boardKeyFor = useCallback((d: SnakeDifficulty): BoardKey => {
    if (isPacman) return "pacman";
    return d === "scaled" ? "snake.scaled" : "snake.rx";
  }, [isPacman]);
  const mid = user?.member_id ?? null;

  // Local-first: read from cache immediately, no server call.
  const loadLocal = useCallback((d: SnakeDifficulty) => {
    const cached = readCache(mid, boardKeyFor(d));
    if (cached) {
      setData(cached);
    } else {
      setData({ leaderboard: [], my_rank: null, my_score: 0 });
    }
  }, [mid, boardKeyFor]);

  // Explicit refresh: hit the server, update cache. Only called by "UPDATE".
  const loadFromServer = useCallback(async (d: SnakeDifficulty) => {
    setLoading(true);
    try {
      const result = isPacman ? await api.getLeaderboardPacman() : await api.getLeaderboard(d);
      writeCache(mid, boardKeyFor(d), result);
      setData(result);
    } catch {
      // Offline — fall back to cache.
      const cached = readCache(mid, boardKeyFor(d));
      setData(cached ?? { leaderboard: [], my_rank: null, my_score: 0 });
    } finally {
      setLoading(false);
    }
  }, [mid, boardKeyFor, isPacman]);

  const openModal = useCallback(() => {
    setModalOpen(true);
    loadLocal(diff);
  }, [diff, loadLocal]);

  const handleUpdate = useCallback(async () => {
    if (submitting || !confirm) return;
    setSubmitting(true);
    try {
      // Prompt for password via FreakConfirm (password mode).
      const res = await confirm.open({
        title: "UPDATE LEADERBOARD",
        body: "Enter password to sync your score.",
        okText: "SUBMIT",
        password: { label: "Password" },
      });
      if (!res.ok || !res.password) {
        setSubmitting(false);
        return;
      }
      // Re-auth (mints a fresh token), then submit.
      const username = user?.username || "";
      const ok = await reauth(username, res.password);
      if (!ok) {
        setSubmitting(false);
        return;
      }
      const result = isPacman
        ? await api.submitPacmanScore({ score })
        : await api.submitScore({ diff, score });
      setData(result);
      writeCache(mid, boardKeyFor(diff), result);
    } catch {
      // Network failure — fall back to cache.
      const cached = readCache(mid, boardKeyFor(diff));
      setData(cached ?? { leaderboard: [], my_rank: null, my_score: 0 });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, confirm, reauth, diff, score, mid, boardKeyFor, isPacman]);

  // Re-read cache when member ID changes (e.g., sign-in / sign-out).
  React.useEffect(() => {
    if (mid != null) {
      const cached = readCache(mid, boardKeyFor(diff));
      setData(cached ?? { leaderboard: [], my_rank: null, my_score: 0 });
    } else {
      // Signed out — clear stale data so the next user sees a clean slate.
      setData(null);
    }
  }, [mid, diff, boardKeyFor]);

  return (
    <>
      <TouchableOpacity
        style={[styles.chip, { borderColor: C.chipBorder }]}
        onPress={() => { onOpen?.(); openModal(); }}
        testID={`wwt10-chip-${diff}`}
      >
        <Text style={styles.chipLabel}>{label}</Text>
        <Text style={styles.chipScore}>{String(score).padStart(scoreDigits, "0")}</Text>
      </TouchableOpacity>

      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setModalOpen(false); onClose?.(); }}
      >
        <View style={styles.modalBack}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>
              {isPacman ? "🟡 Pac-Man World Wide" : "🐍 World Wide Top 10"}
            </Text>
            <Text style={styles.modalSub}>
              LEADERBOARD · {isPacman ? "TOP 10" : (diff === "rx" ? "RX" : "SCALED")}
            </Text>

            {/* Leaderboard — always 10 rows. First-play: YOU #1 + 9 dashes.
                One board at a time, driven by the game's RX/Scaled switch (diff prop). */}
            <View style={styles.list}>
              {loading ? (
                <ActivityIndicator color={C.accent} style={styles.spinner} />
              ) : (
                (() => {
                  const rows: { rank: number; name: string; score: number; isYou: boolean }[] = [];
                  const serverRows = data?.leaderboard || [];
                  const hasServer = serverRows.length > 0;

                  const youName = user?.display_name || user?.username || "YOU";

                  if (!hasServer) {
                    // First play (no server data): YOU #1, then 9 placeholder rows.
                    rows.push({ rank: 1, name: youName, score, isYou: true });
                    for (let i = 2; i <= 10; i++) {
                      rows.push({ rank: i, name: "—", score: 0, isYou: false });
                    }
                  } else {
                    // Server data available. Derive current user's rank from
                    // the cached rows (cache is per-board, shared across users).
                    const myRow = serverRows.find((r) => r.name === youName);
                    const myRank = myRow ? myRow.rank : (data!.my_rank || 0);

                    if (myRank >= 1 && myRank <= 10) {
                      // In top 10 — show all 10, your row highlighted at its rank.
                      serverRows.forEach((r) =>
                        rows.push({ rank: r.rank, name: r.name, score: r.score, isYou: r.name === youName })
                      );
                      // Pad if server has fewer than 10.
                      while (rows.length < 10) {
                        rows.push({ rank: rows.length + 1, name: "—", score: 0, isYou: false });
                      }
                    } else {
                      // Outside top 10 — show 9 others + your row with actual rank.
                      const others = serverRows.slice(0, 9);
                      others.forEach((r) => rows.push({ rank: r.rank, name: r.name, score: r.score, isYou: false }));
                      while (rows.length < 9) {
                        rows.push({ rank: rows.length + 1, name: "—", score: 0, isYou: false });
                      }
                      rows.push({ rank: myRank || 11, name: youName, score: myRow?.score ?? score, isYou: true });
                    }
                  }

                  return rows.slice(0, 10).map((row) => (
                    <View key={row.rank} style={[styles.row, row.isYou && styles.youRow]}>
                      <Text style={[styles.rowRank, row.isYou && styles.youText]}>#{row.rank}</Text>
                      <Text style={[styles.rowName, row.isYou && styles.youText]}>{row.name}</Text>
                      <Text style={[styles.rowScore, row.isYou && styles.youText]}>{String(row.score).padStart(3, "0")}</Text>
                    </View>
                  ));
                })()
              )}
            </View>

            {/* Update button */}
            <TouchableOpacity
              style={[styles.updateBtn, (submitting || score === 0) && styles.updateBtnDisabled]}
              disabled={submitting || score === 0}
              onPress={handleUpdate}
              testID="wwt10-update"
            >
              <Text style={styles.updateText}>
                {submitting ? "SYNCING…" : "UPDATE"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => { setModalOpen(false); onClose?.(); }}
              testID="wwt10-close"
            >
              <Text style={styles.closeText}>CLOSE</Text>
            </TouchableOpacity>

            {/* Password prompt rendered INLINE inside the leaderboard Modal.
                On iOS, a second <Modal> cannot be presented over an open one
                (silent no-op), so FreakConfirm uses the inline overlay mode —
                an absolutely-positioned View, not a native Modal. Must be a
                child of the modal content tree, not a sibling. */}
            <FreakConfirm handle={setConfirm} inline />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  chipLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  chipScore: {
    color: C.text,
    fontSize: 13,
    fontWeight: "800",
  },
  modalBack: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalBody: {
    backgroundColor: C.modalBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.chipBorder,
    padding: 20,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
  },
  modalSub: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 3,
    textAlign: "center",
    marginTop: 2,
    marginBottom: 16,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  list: {
    gap: 4,
    marginBottom: 12,
    maxHeight: 380,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: C.row,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.rowBorder,
  },
  rowRank: {
    color: C.accent,
    fontSize: 12,
    fontWeight: "700",
    width: 32,
  },
  rowName: {
    color: C.text,
    fontSize: 13,
    flex: 1,
  },
  rowScore: {
    color: C.text,
    fontSize: 14,
    fontWeight: "800",
  },
  empty: {
    color: C.dim,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
  spinner: {
    paddingVertical: 12,
  },
  youRow: {
    backgroundColor: "rgba(74,175,255,0.12)",
  },
  youText: {
    color: C.accent,
    fontWeight: "800",
  },
  updateBtn: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  updateBtnDisabled: {
    opacity: 0.4,
  },
  updateText: {
    color: "#0d0d0d",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 2,
  },
  closeBtn: {
    backgroundColor: "transparent",
    paddingVertical: 8,
    alignItems: "center",
  },
  closeText: {
    color: C.dim,
    fontSize: 12,
    letterSpacing: 2,
  },
});
