// Snake screen (Phase 3.0 S2.5).
//
// SKIN ONLY. All game logic lives in ../src/snake/engine.ts (renderer-agnostic).
// This file knows how to PAINT one frame from an EngineSnapshot and how to
// drive the fixed-timestep loop. Swapping SVG → canvas (Phase 3.8) replaces the
// <svg> block + the measure below; the loop, input, chrome, and engine stay.
//
// LAYOUT (locked 10-24, Allen's vision):
//   Banner (shared AppHeader) → game box (tap-to-pause) → L/R buttons (just under
//   the board, high for reach) → score row. Game-over = overlay on the box.
//
// ENTRY: a "Snake game! ▶ Start" welcome overlay shows ONLY on first arrival from
// the landing (fresh mount). Restart re-arms the board directly — no welcome box.
//
// "Grown-up Nokia": dark panel, soft rounded segments, one food accent.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import { Svg, Rect } from "react-native-svg";
import {
  COLS,
  ROWS,
  newGame,
  step,
  applyTurn,
  togglePause,
  snapshot,
  restoreInto,
  type EngineSnapshot,
  type PausedSnapshot,
  type TurnInput,
} from "../src/snake/engine";
import { initAudio, soundBleepBleep, soundWaa } from "../src/audio/sounds";
import FreakConfirm, { type FreakConfirmHandle } from "../components/FreakConfirm";
import EggToast, { type EggToastHandle } from "../components/EggToast";
import {
  getProgress,
  getScaledFlag,
  setScaledFlag,
  advance,
  isUnlocked,
  setMantraPinned,
  getBoundMemberId,
} from "../src/pacmanProgress";
import { useFocusEffect } from "@react-navigation/native";
import WWT10Overlay from "../components/WWT10Overlay";

// --- Grown-up-Nokia palette (matches the app's dark theme) -----------------
const C = {
  root: "#111",
  boardBg: "#0d0d0d",
  boardBorder: "#2a2a2a",
  seg: "#e6e6e6", // soft off-white body
  head: "#ffffff", // head one step brighter = "better cheekbones"
  food: "#4af", // app accent, single pop of color
  text: "#fff",
  muted: "#888",
  dim: "#666",
  btn: "#1a1a1a",
  btnBorder: "#2a2a2a",
  overlay: "rgba(17,17,17,0.82)",
};

// RX ↔ Scaled difficulty (side quest 10-27). RX = "as recommended" (baseline
// speed); Scaled = "easier" (slower). Only the tick changes — grid/steps/max
// (297) and all engine logic are untouched. Toggling is between-games only.
const TICK_RX = 130; // one snake step per tick (slightly slower for wall-dodge comfort)
const TICK_SCALED = 190; // slower than RX, but 210 felt sluggish → 190 (~0.68×)
type Difficulty = "rx" | "scaled";
const tickFor = (d: Difficulty) => (d === "scaled" ? TICK_SCALED : TICK_RX);
// device-store keys (web: localStorage shim; Phase 3.8 → secure store)
const diffKey = () => `unguided.snake.diff.${getBoundMemberId() ?? "anon"}`;
const bestKeyFor = (d: Difficulty) => `unguided.snake.best.${getBoundMemberId() ?? "anon"}.${d}`;
const snakeSavedKey = () => `unguided.snake.saved.${getBoundMemberId() ?? "anon"}`;
const COUNTDOWN_MS = 700; // 3 → 2 → 1, ~700ms each (~2.1s to get ready)

// S6.3: test-mode override — set "1" in localStorage to force the PAC-MAN
// pill visible without completing the 4-step easter egg. Cleared before sign-off.
const PACMAN_TEST_KEY = "unguided.pacman.test";
function pacManTestMode(): boolean {
  try {
    return localStorage.getItem(PACMAN_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

export default function SnakeScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  const boardW = width - 48; // 24px side margins
  const boardH = (boardW * ROWS) / COLS; // keep the authentic 20:15 cell aspect

  // --- game state (engine object is mutable; React state is a render tick) --
  // Start FROZEN (paused): the fixed-timestep loop only moves the snake when
  // state === "playing", so a paused init means the welcome gate genuinely holds
  // the board. onStart/onContinue drop it into play.
  const engineRef = useRef<EngineSnapshot | null>(null);
  if (engineRef.current === null) {
    const g = newGame();
    g.state = "paused";
    engineRef.current = g;
  }
  const [, setTick] = useState(0); // bump to re-render after each engine mutation
  // Difficulty: "rx" (baseline 130ms) | "scaled" (210ms). Persisted (last choice
  // remembered across reloads). Only flippable between games (see UI gate).
  const [diff, setDiff] = useState<Difficulty>("rx");
  const [high, setHigh] = useState(0);
  const [showWWT10, setShowWWT10] = useState(false);
  // Welcome box on first arrival from the landing only. Restart clears it and
  // drops straight into the game (per Allen). Stack unmounts on nav, so a
  // landing→snake re-entry remounts this and the welcome box shows again.
  const [gated, setGated] = useState(true);
  // A paused game saved on a previous visit (the "Continue" target). Null =
  // nothing to continue → the Continue button renders greyed out / inactive.
  const [savedGame, setSavedGame] = useState<PausedSnapshot | null>(null);
  // 3-2-1 pre-launch countdown. null = not running; a number = current count.
  // Shown on every resume (box-tap, Start, Continue, Restart) so the player sees
  // the frozen board for ~2s, gets fingers on the L/R buttons, and plays the
  // instant it hits 0. The engine stays "paused" during the count (board frozen),
  // then flips to "playing" at zero.
  const [countdown, setCountdown] = useState<number | null>(null);
  // S6.3: mantra pin — on every focus of the Snake screen, set the pin so
  // OpenGymLanding shows the "pause at 30" mantra on the next return.
  useFocusEffect(
    React.useCallback(() => {
      setMantraPinned(true);
      // Re-read the per-mode best on every focus. Catches the race where the
      // member wasn't bound at initial mount (getBoundMemberId() null → "anon"
      // key → 0). By the time focus fires, bindMember has completed.
      try {
        const h = parseInt(localStorage.getItem(bestKeyFor(diff)) || "0", 10) || 0;
        setHigh(h);
      } catch {}
    }, [diff])
  );
  // S6.3: easter-egg egg counter re-render trigger. The progress lives in
  // localStorage (pacmanProgress), so a local tick bump is how the header
  // picks up a fresh 🥚 n/m after a trigger fires.
  const [, setEggTick] = useState(0);
  const bumpEgg = useCallback(() => setEggTick((t) => t + 1), []);
  // S6.3: FreakConfirm handle (for other uses) + EggToast for egg popups.
  const [confirm, setConfirm] = useState<FreakConfirmHandle | null>(null);
  const [egg, setEgg] = useState<EggToastHandle | null>(null);
  const showEggPopup = useCallback(
    (body: string, emoji: string) => {
      egg?.open({ title: "🥚 EASTER EGG", body, emoji, okText: "🥚 Nice", stage: 1 });
    },
    [egg]
  );
  const countdownTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearCountdownTimers = useCallback(() => {
    countdownTimers.current.forEach(clearTimeout);
    countdownTimers.current = [];
  }, []);
  const beginCountdown = useCallback(
    (n = 3) => {
      if (!engineRef.current) return;
      clearCountdownTimers();
      setCountdown(n);
      let cur = n;
      // schedule the ticks: show n, n-1, ..., 1, then drop into play at 0.
      for (let i = 1; i <= n; i++) {
        const stepNum = n - i; // value shown AFTER this step (n-1 ... 0)
        countdownTimers.current.push(
          setTimeout(() => {
            cur = stepNum;
            if (cur > 0) {
              setCountdown(cur);
            } else {
              setCountdown(null);
              const s = engineRef.current;
              if (s && s.state !== "playing") {
                s.state = "playing"; // launch into the game
                setTick((t) => t + 1);
              }
            }
          }, i * COUNTDOWN_MS)
        );
      }
    },
    [clearCountdownTimers]
  );
  // clear any pending countdown timers on unmount
  useEffect(() => () => clearCountdownTimers(), [clearCountdownTimers]);

  // --- high-score persistence (device store). Web loop: localStorage shim;
  // Phase 3.8 swaps this to the secure store. Kept OUT of the engine.
  // Per-mode bests (RX / Scaled). `high` = the ACTIVE mode's best; flipping the
  // toggle re-reads the other mode's value (see the diff effect below).
  useEffect(() => {
    let h = 0;
    try {
      h = parseInt(localStorage.getItem(bestKeyFor(diff)) || "0", 10) || 0;
    } catch {}
    setHigh(h);
  }, [diff]);

  // Load the persisted difficulty on mount (defaults to rx).
  useEffect(() => {
    let d: Difficulty = "rx";
    try {
      const v = localStorage.getItem(diffKey());
      if (v === "scaled" || v === "rx") d = v;
    } catch {}
    setDiff(d);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(diffKey(), diff);
    } catch {}
  }, [diff]);
  const saveHigh = useCallback(
    (score: number) => {
      setHigh((prev) => {
        const next = Math.max(prev, score);
        try {
          localStorage.setItem(bestKeyFor(diff), String(next));
        } catch {}
        return next;
      });
    },
    [diff],
  );

  // --- Continue: load a saved paused game on mount --------------------------
  // (The engine object is in-memory only; leaving the screen unmounts it and
  // loses the paused game, so we persist the snapshot here, like the high-score.
  // Phase 3.8 swaps localStorage → the secure store.)
  // If a saved game exists, the welcome gate stays up so the player can hit
  // Continue (or Start a fresh game). Without this, a saved game on mount is
  // unreachable — the box never shows and the engine just runs a fresh board.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(snakeSavedKey());
      if (raw) {
        setSavedGame(JSON.parse(raw) as PausedSnapshot);
        setGated(true); // surface the Continue option
      }
    } catch {}
  }, []);

  // --- persist a PAUSED game on unmount (only if it's actually paused) ------
  // A game that's mid-play or finished when the player leaves is NOT saved —
  // only a deliberate pause is resumable. The engine is frozen at unmount, so
  // this reads the final state exactly.
  useEffect(() => {
    return () => {
      const st = engineRef.current;
      if (!st) return;
      try {
        if (st.state === "paused") {
          localStorage.setItem(snakeSavedKey(), JSON.stringify(snapshot(st)));
        } else {
          localStorage.removeItem(snakeSavedKey()); // no resume target
        }
      } catch {}
    };
  }, []);

  // --- fixed-timestep loop --------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      const s = engineRef.current;
      if (!s || s.state !== "playing") return;
      // Capture pre-step state for sound detection.
      const prevScore = s.score;
      const prevState = s.state;
      // Turns are applied the instant the button is pressed (see press() /
      // applyTurn), so the tick is pure motion — no queued input to consume.
      step(s, null);
      // step() mutates s in place (may set state="gameover"); TS doesn't track
      // cross-call mutation, so re-read through a widened type for the check.
      if ((s.state as string) === "gameover") {
        if (prevState === "playing") soundWaa();
        saveHigh(s.score);
      } else if (s.score > prevScore) {
        soundBleepBleep();
      }
      setTick((t) => t + 1);
    }, tickFor(diff)); // RX 130ms / Scaled 210ms; re-arms when diff flips
    return () => clearInterval(id);
  }, [saveHigh, diff]);

  // --- inputs ----------------------------------------------------------------
  const press = useCallback((dir: TurnInput) => {
    initAudio(); // unlock Web Audio on first gesture
    // The L/R buttons are only "live" while the snake is actually playing. A
    // steer during the welcome gate, the 3-2-1 countdown, pause, or game-over
    // would otherwise aim the snake for the next launch — no-op unless playing.
    // (applyTurn re-checks state too, so this is the fast path.)
    const s = engineRef.current;
    if (!s || s.state !== "playing") return;
    // Queue the turn (not applied instantly — one buffered per tick). The
    // heading is aimed on this press so the skin can react immediately; the
    // actual move happens on the next motion tick. Bumping the render tick makes
    // the queued turn visible (head rotates) right away.
    applyTurn(s, dir);
    setTick((t) => t + 1);
  }, []);
  const onBoxTap = useCallback(() => {
    initAudio(); // unlock Web Audio on first gesture
    // The whole board is a tap-to-pause surface, and the welcome box sits ON it.
    // While the gate is up, a tap on the box (not the Start/Continue buttons)
    // would otherwise bubble here and unpause the game behind the overlay.
    // No-op it while gated; the buttons have their own onPress handlers.
    if (gated) return;
    const s = engineRef.current;
    if (!s) return;
    if (s.state === "paused") {
      // Resume with a 3-2-1 pre-launch so the player sees the frozen board and
      // gets fingers ready before the snake moves. (Pause stays instant.)
      beginCountdown(3);
    } else if (s.state === "playing") {
      const wasScore = s.score;
      togglePause(s);
      setTick((t) => t + 1);
      // S6.3: easter-egg trigger — pause at score ≥ 30 (RX = egg 1, Scaled =
      // just surfaces the counter with the "RX only" roast).
      if (s.score >= 30) {
        if (diff === "scaled" && !getScaledFlag()) {
          // Scaled-first roast: counter appears (0/4), nudge to RX.
          setScaledFlag();
          bumpEgg();
          showEggPopup(
            "Found it. Scaled gets a pat on the back — but only RX athletes get to Pac-Man. Pause at 30 on RX.",
            "🥚"
          );
        } else if (diff === "rx" && getProgress() === 0) {
          // RX pause at 30 = the real egg 1 (works whether or not they did Scaled first).
          advance(0); // → 1/4
          bumpEgg();
          showEggPopup("1/4 unlocked! Use Pac-Man as your workout weight.", "🥚");
        }
      }
    }
  }, [gated, beginCountdown, diff, bumpEgg, showEggPopup]);
  const onRestart = useCallback(() => {
    // Fresh board, FROZEN (paused) — same as onStart. engine.restart() would copy
    // a newGame() (state="playing") in and the snake would RUN during the 3-2-1
    // countdown. Pausing first keeps the board still while the player gets ready.
    if (!engineRef.current) return;
    const fresh = newGame();
    fresh.state = "paused";
    Object.assign(engineRef.current, fresh);
    setGated(false); // restart drops straight into the game — no welcome box
    beginCountdown(3);
  }, [beginCountdown]);
  const onStart = useCallback(() => {
    // Fresh board, FROZEN (paused). restart() would set state="playing" and the
    // snake would run behind the welcome overlay before the player is ready.
    // Pausing it means the gate genuinely holds — one box-tap drops it into play.
    if (!engineRef.current) return;
    const fresh = newGame();
    fresh.state = "paused";
    Object.assign(engineRef.current, fresh);
    setSavedGame(null);
    try {
      localStorage.removeItem(snakeSavedKey());
    } catch {}
    setGated(false); // welcome → live (board waiting, frozen)
    beginCountdown(3);
  }, [beginCountdown]);
  const onContinue = useCallback(() => {
    const snap = savedGame;
    if (!snap || !engineRef.current) return; // nothing to continue
    restoreInto(engineRef.current, snap); // revive frozen (paused)
    setSavedGame(null);
    try {
      localStorage.removeItem(snakeSavedKey());
    } catch {}
    setGated(false); // → live; the box tap resumes from paused
    setTick((t) => t + 1);
    beginCountdown(3);
  }, [savedGame, beginCountdown]);

  const s = engineRef.current;
  if (!s) return null;
  // S6.3: PAC-MAN pill visibility — unlocked (progress ≥ 4) OR test mode.
  const pacManVisible = isUnlocked() || pacManTestMode();
  // Difficulty toggle: ONLY enabled when score === 0 (before game starts) or
  // state === "gameover" (after game is over). That's it. (Allen 10-29.)
  const st = s.state as string;
  const isLive = s.score > 0 && st !== "gameover";

  // --- paint one frame from the snapshot ------------------------------------
  // The <Svg> uses a GRID viewBox (0 0 COLS ROWS), so one cell = exactly 1 unit.
  // Every size below is in those units — NOT pixels. (Old bug: `cell` was a
  // pixel value (boardW/COLS) used as a unit size → 35-unit-wide blobs.)
  const pad = 0.12; // inset so segments read as rounded blocks w/ gaps
  const r = 0.28; // corner radius — the "grown-up" softness
  const cellSize = 1 - pad * 2; // fill of one unit cell after the inset

  return (
    <View style={styles.root}>
      {/* SCORE ROW — above the box (the bottom of the screen is reserved for a
          future Timer banner on this page). */}
      <View style={styles.scoreRow} testID="snake-score-row">
        <View style={styles.scoreGroup}>
          <Text style={styles.scoreLabel}>1UP</Text>
          <Text style={styles.scoreVal}>{String(s.score).padStart(3, "0")}</Text>
        </View>
        {/* RX ↔ Scaled difficulty toggle (between-games only). */}
        <View
          style={[styles.diffToggle, isLive && styles.diffToggleDim]}
          testID="snake-diff-toggle"
        >
          {(["rx", "scaled"] as const).map((d) => {
            const on = diff === d;
            return (
              <TouchableOpacity
                key={d}
                disabled={isLive}
                activeOpacity={0.7}
                onPress={() => !isLive && setDiff(d)}
                style={[styles.diffPill, on && styles.diffPillOn]}
                testID={`snake-diff-${d}`}
              >
                <Text style={[styles.diffPillText, on && styles.diffPillTextOn]}>
                  {d === "rx" ? "RX" : "Scaled"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {pacManVisible && (
          <TouchableOpacity
            style={[styles.diffPill, styles.pacPill]}
            onPress={() => navigation.navigate("PacMan")}
            testID="snake-pac-pill"
          >
            <Text style={styles.pacPillText}>🟡</Text>
          </TouchableOpacity>
        )}
        {showWWT10 ? (
          <WWT10Overlay
            score={high}
            diff={diff}
            label="TOP"
            initialOpen
            onClose={() => setShowWWT10(false)}
          />
        ) : (
          <TouchableOpacity
            style={[styles.diffPill, styles.bestPill]}
            onPress={() => {
              // Pause if playing so the leaderboard can be read without the game running.
              if (engineRef.current && engineRef.current.state === "playing") {
                togglePause(engineRef.current);
                setTick((t) => t + 1);
              }
              setShowWWT10(true);
            }}
            testID="snake-wwt10-pill"
          >
            <Text style={styles.scoreLabel}>
              TOP <Text style={styles.scoreVal}>{String(Math.max(high, s.score)).padStart(3, "0")}</Text>
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* GAME BOX — tap to pause */}
      <TouchableOpacity activeOpacity={0.9} onPress={onBoxTap} style={styles.boxWrap} testID="snake-box">
        <View style={[styles.board, { width: boardW, height: boardH, borderColor: C.boardBorder }]}>
          <Svg width={boardW} height={boardH} viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="xMidYMid meet">
            <Rect x={0} y={0} width={COLS} height={ROWS} fill={C.boardBg} />
            {/* food */}
            {s.food.x >= 0 && (
              <Rect
                x={s.food.x + pad}
                y={s.food.y + pad}
                width={cellSize}
                height={cellSize}
                rx={r * 1.4}
                ry={r * 1.4}
                fill={C.food}
              />
            )}
            {/* body (index 1..n) then head (index 0) on top */}
            {s.snake.map((c, i) => (
              <Rect
                key={i}
                x={c.x + pad}
                y={c.y + pad}
                width={cellSize}
                height={cellSize}
                rx={r}
                ry={r}
                fill={i === 0 ? C.head : C.seg}
                opacity={i === 0 ? 1 : Math.max(0.55, 1 - i * 0.02)}
              />
            ))}
          </Svg>

          {/* PAUSE veil — hidden while the welcome gate is up (so the overlays
              never stack) and while a countdown is running (the 3-2-1 overlay
              replaces it; the board is still paused underneath during the count). */}
          {!gated && countdown === null && s.state === "paused" && (
            <View style={[styles.overlay, { width: boardW, height: boardH }]}>
              <Text style={styles.overlayTitle}>PAUSED</Text>
              <Text style={styles.overlaySub}>tap the box to resume</Text>
            </View>
          )}

          {/* 3-2-1 PRE-LAUNCH countdown — runs on every resume (box-tap, Start,
              Continue, Restart). The board stays frozen underneath so the player
              sees the current state and gets fingers on the L/R buttons; the game
              launches the instant it hits 0. */}
          {countdown !== null && (
            <View style={[styles.overlay, { width: boardW, height: boardH }]} testID="snake-countdown">
              <Text style={styles.countdownNum} key={countdown}>
                {countdown}
              </Text>
              <Text style={styles.overlaySub}>get ready…</Text>
            </View>
          )}

          {/* WELCOME overlay — first arrival from the landing only (never on
          restart), and only on a fresh, non-terminal board so it can't stack on
          a game-over. Restart clears `gated` and re-arms straight into the game. */}
          {gated && s.state !== "gameover" && (
            <View style={[styles.overlay, { width: boardW, height: boardH }]} testID="snake-welcome">
              <Text style={styles.welcomeEmoji}>🐍</Text>
              <Text style={styles.overlayTitle}>SNAKE GAME</Text>
              {high > 0 && (
                <Text style={styles.bestChip}>
                  BEST <Text style={styles.scoreVal}>{String(high).padStart(3, "0")}</Text>
                </Text>
              )}
              <View style={styles.welcomeBtns}>
                {/* Start (left) is the primary fresh-game action. Continue (right)
                    is active only if a paused game was saved; greyed out
                    (invisible to press) when there's nothing to resume. */}
                <TouchableOpacity style={[styles.restartBtn, styles.welcomeBtn]} onPress={onStart} testID="snake-start">
                  <Text style={styles.restartText}>Start</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.restartBtn, styles.welcomeBtn, !savedGame && styles.restartBtnDisabled]}
                  onPress={savedGame ? onContinue : undefined}
                  disabled={!savedGame}
                  testID="snake-continue"
                >
                  <Text style={[styles.restartText, !savedGame && styles.restartTextDisabled]}>Continue</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* GAME-OVER overlay (restart lives here — never steals thumb space) */}
          {s.state === "gameover" && (
            <View style={[styles.overlay, { width: boardW, height: boardH }]}>
              <Text style={styles.overlayTitle}>GAME OVER</Text>
              <Text style={styles.overlayScore}>
                {s.score} {s.score === 1 ? "point" : "points"}
              </Text>
              {s.score >= high && s.score > 0 && <Text style={styles.newBest}>NEW BEST 🦈</Text>}
              <TouchableOpacity style={styles.restartBtn} onPress={onRestart} testID="snake-restart">
                <Text style={styles.restartText}>Restart</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* L / R — one per thumb, chunky, authentic 2-button steering. Just under
      the board for easy reach. (Score row now lives above the box; the bottom
      of the screen is reserved for a future Timer banner.) */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.dirBtn, { flex: 1 }]}
          onPress={() => press("left")}
          activeOpacity={0.7}
          testID="snake-left"
        >
          <Text style={styles.dirGlyph}>‹</Text>
          <Text style={styles.dirLabel}>LEFT</Text>
        </TouchableOpacity>
        <View style={styles.ctrlGap} />
        <TouchableOpacity
          style={[styles.dirBtn, { flex: 1 }]}
          onPress={() => press("right")}
          activeOpacity={0.7}
          testID="snake-right"
        >
          <Text style={styles.dirGlyph}>›</Text>
          <Text style={styles.dirLabel}>RIGHT</Text>
        </TouchableOpacity>
      </View>

      <FreakConfirm handle={setConfirm} />
      <EggToast handle={setEgg} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.root, paddingHorizontal: 24, paddingTop: 12 },
  boxWrap: { alignItems: "center", justifyContent: "flex-start" },
  // (spacer removed — score row moved above the box; bottom is free for a
  // future Timer banner)
  board: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    backgroundColor: C.boardBg,
  },

  controls: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16, // just under the board — high on the screen, easy reach
  },
  ctrlGap: { width: 24 },
  dirBtn: {
    height: 76,
    borderRadius: 14,
    backgroundColor: C.btn,
    borderWidth: 1,
    borderColor: C.btnBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  dirGlyph: { color: C.text, fontSize: 40, lineHeight: 44, fontWeight: "700" },
  dirLabel: { color: C.muted, fontSize: 11, letterSpacing: 2, marginTop: 2 },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    marginBottom: 16,
  },
  scoreLabel: { color: C.dim, fontSize: 11, letterSpacing: 1, marginRight: 6 },
  scoreVal: { color: C.text, fontSize: 15, fontWeight: "900", fontVariant: ["tabular-nums"], letterSpacing: 1 },
  scoreGroup: { flexDirection: "row", alignItems: "baseline" },
  // RX ↔ Scaled segmented toggle (center of the score row).
  diffToggle: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.boardBorder,
    overflow: "hidden",
  },
  diffToggleDim: { opacity: 0.35 }, // locked while a run is live
  diffPill: { paddingHorizontal: 10, paddingVertical: 3 },
  diffPillOn: { backgroundColor: C.food }, // RX blue = selected
  diffPillText: { color: C.dim, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  diffPillTextOn: { color: "#0d0d0d" },
  // S6.3: PAC-MAN pill — yellow tint, sits in the score row after BEST.
  pacPill: { backgroundColor: "#2a2410", borderWidth: 1, borderColor: "#f5d442" },
  pacPillText: { color: "#f5d442", fontSize: 14, fontWeight: "800" },
  // WWT10 pill — THE ONLY entry to the Snake leaderboard. Sits where BEST was.
  bestPill: { backgroundColor: "#1a1a2e", borderWidth: 1, borderColor: C.btn, flexDirection: "row", alignItems: "center", gap: 4 },
  bestPillDot: { fontSize: 8 },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    backgroundColor: C.overlay,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayTitle: { color: C.text, fontSize: 26, fontWeight: "800", letterSpacing: 2 },
  overlaySub: { color: C.muted, fontSize: 13, marginTop: 8 },
  overlayScore: { color: C.text, fontSize: 20, fontWeight: "700", marginTop: 14 },
  // Big 3-2-1 pre-launch digits (grid-units, like the board SVG).
  countdownNum: { color: C.food, fontSize: 64, fontWeight: "800" },
  newBest: { color: C.food, fontSize: 13, fontWeight: "700", marginTop: 6, letterSpacing: 1 },
  welcomeEmoji: { fontSize: 40, marginBottom: 6 },
  bestChip: { color: C.muted, fontSize: 13, letterSpacing: 1.5, marginTop: 16 },
  welcomeBtns: { flexDirection: "row", gap: 12, marginTop: 20 },
  // Content-sized (NOT flex:1) — matches the game-over Restart button exactly.
  // flex:1 stretched the welcome buttons to the box width, which wrapped
  // "Continue" onto two lines. Hugging the text keeps them centered + flat.
  welcomeBtn: { marginTop: 0, alignSelf: "center" },
  restartBtnDisabled: { opacity: 0.4 },
  restartTextDisabled: { color: C.dim },
  restartBtn: {
    marginTop: 20,
    backgroundColor: C.btn,
    borderWidth: 1,
    borderColor: C.btnBorder,
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 4,
  },
  restartText: { color: C.text, fontSize: 16, fontWeight: "600" },
});
