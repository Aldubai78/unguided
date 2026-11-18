// Pac-Man screen — Step 4: full game loop, ghosts, frightened, death, restart.
//
// Fixed-timestep loop (setInterval at level-config tick rate).
// Keyboard input (arrows + WASD) with buffered turns.
// SVG renderer: 28×31 grid, all vector, no sprites.
import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions, Platform } from "react-native";
import { Svg, Rect, Circle, Path, G, Text as SvgText } from "react-native-svg";
import { MazeWalls } from "../src/pacman/MazeWalls";
import {
  COLS,
  ROWS,
  TUNNEL_ROW,
  GHOST_HOUSE_CENTER,
  type Cell,
} from "../src/pacman/maze";
import {
  createGame,
  createGrid,
  step,
  applyInput,
  levelConfig,
} from "../src/pacman/engine";
import {
  initAudio,
  soundDot,
  soundPower,
  soundEatGhost,
  soundDeath,
  soundFruit,
  soundExtraLife,
} from "../src/audio/sounds";
import type { Direction, Ghost, GameState, GameEvent } from "../src/pacman/types";
import WWT10Overlay from "../components/WWT10Overlay";
import { getBoundMemberId } from "../src/pacmanProgress";

import { oneLine, CHROME_MAX_SCALE } from "../src/textFit";
// Device-store keys (web: localStorage shim; Phase 3.8 → secure store)
const bestKey = () => `unguided.pacman.best.${getBoundMemberId() ?? "anon"}`;
const savedKey = () => `unguided.pacman.saved.${getBoundMemberId() ?? "anon"}`;

// --- Palette ---
const C = {
  bg: "#000",
  wall: "#3333ff",
  dot: "#ffb8ae",
  power: "#ffb8ae",
  pac: "#ffe600",
  text: "#fff",
  muted: "#888",
  ghostBlinky: "#ff0000",
  ghostPinky: "#ffb8ff",
  ghostInky: "#00ffff",
  ghostClyde: "#ffb852",
  ghostFrightened: "#2121ff",
  ghostFrightenedFlash: "#fff",
  eye: "#fff",
  pupil: "#2121ff",
};

const GHOST_COLORS = [C.ghostBlinky, C.ghostPinky, C.ghostInky, C.ghostClyde];

// Pac-Man mouth (two states, facing right by default).
// Pac-Man: circle with a wedge-shaped mouth. The mouth opens to the right.
// PAC_OPEN: mouth open ~45° (top and bottom edges at ±22.5° from horizontal).
// PAC_CLOSED: mouth nearly shut (top and bottom edges at ±5° from horizontal).
// Pac-Man: circle with a wedge-shaped mouth carved out. The mouth opens to the right.
// Both mouth-edge points lie ON the circle (radius 0.35), and the arc sweeps the
// LONG way around (large-arc=1, sweep=1) so the body is a near-full circle.
//
// PAC_OPEN: mouth angle ±30° from horizontal.
//   top edge:  (0.35·cos30°, -0.35·sin30°) = (0.303, -0.175)
//   bot edge:  (0.35·cos30°,  0.35·sin30°) = (0.303,  0.175)
// PAC_CLOSED: mouth angle ±5° from horizontal.
//   top edge:  (0.35·cos5°, -0.35·sin5°) = (0.349, -0.030)
//   bot edge:  (0.35·cos5°,  0.35·sin5°) = (0.349,  0.030)
const PAC_OPEN = "M 0,0 L 0.303,-0.175 A 0.35,0.35 0 1,0 0.303,0.175 Z";
const PAC_CLOSED = "M 0,0 L 0.349,-0.030 A 0.35,0.35 0 1,0 0.349,0.030 Z";

// Ghost body (rounded top, wavy bottom).
const GHOST_BODY =
  "M -0.35,0.25 L -0.35,-0.1 A 0.35,0.35 0 0,1 0.35,-0.1 L 0.35,0.25 L 0.25,0.15 L 0.15,0.25 L 0.05,0.15 L -0.05,0.25 L -0.15,0.15 L -0.25,0.25 Z";

// Rotation for direction (Pac-Man mouth faces the direction of travel).
const DIR_ROTATION: Record<Direction, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: 270,
};

// Interpolate between previous and current grid position.
//
// Rules:
//  - At rest (prev === curr): render exactly at the current cell center. No
//    interpolation, no slide. This is the fix for the "ghost glitch back one
//    spot" artifact — when a ghost's tick is skipped by the speed gate, its
//    prevPos stays equal to pos, and we must NOT re-interpolate from a stale
//    prevPos (which would look like a snap-back).
//  - Diagonal move (both axes changed): snap to current (shouldn't happen in
//    a grid maze, but guards against wall-clipping on turns).
//  - Straight move: interpolate normally.
function lerpPos(prev: { col: number; row: number }, curr: { col: number; row: number }, t: number) {
  const dx = curr.col - prev.col;
  const dy = curr.row - prev.row;

  // At rest: snap to current cell center. No interpolation.
  if (dx === 0 && dy === 0) {
    return { x: curr.col + 0.5, y: curr.row + 0.5 };
  }

  // Diagonal (shouldn't happen): snap to current to avoid wall-clipping.
  if (dx !== 0 && dy !== 0) {
    return { x: curr.col + 0.5, y: curr.row + 0.5 };
  }

  // Straight line: interpolate.
  return {
    x: prev.col + dx * t + 0.5,
    y: prev.row + dy * t + 0.5,
  };
}

// Wall-aware guard for Pac-Man: if the cell AHEAD in the current travel
// direction is a wall (or out of bounds / the ghost door), Pac-Man is blocked
// and must render at his current cell center — NOT interpolated toward the
// wall. This kills the "Pac-Man slides partway into the wall" artifact on the
// tick where he's blocked. Returns the exact cell center if blocked, otherwise
// returns the normal interpolated position.
function lerpPosWallAware(
  prev: { col: number; row: number },
  curr: { col: number; row: number },
  dir: Direction,
  grid: Cell[][],
  t: number,
) {
  // If at rest, just snap (no wall check needed).
  if (prev.col === curr.col && prev.row === curr.row) {
    return { x: curr.col + 0.5, y: curr.row + 0.5 };
  }

  // Compute the cell ahead in the current direction.
  const dc = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  const dr = dir === "up" ? -1 : dir === "down" ? 1 : 0;
  const aheadCol = curr.col + dc;
  const aheadRow = curr.row + dr;

  // Out of bounds (tunnel row wraps; other rows are blocked).
  if (aheadCol < 0 || aheadCol >= COLS) {
    // Tunnel wrap: only allowed on the tunnel row.
    if (curr.row !== TUNNEL_ROW) {
      return { x: curr.col + 0.5, y: curr.row + 0.5 };
    }
  } else if (aheadRow < 0 || aheadRow >= ROWS) {
    return { x: curr.col + 0.5, y: curr.row + 0.5 };
  } else {
    const cell = grid[aheadRow][aheadCol];
    if (cell.type === "wall" || cell.type === "ghostDoor") {
      return { x: curr.col + 0.5, y: curr.row + 0.5 };
    }
  }

  // Not blocked: interpolate normally.
  const dx = curr.col - prev.col;
  const dy = curr.row - prev.row;
  return {
    x: prev.col + dx * t + 0.5,
    y: prev.row + dy * t + 0.5,
  };
}

// Eye pupil offset by direction.
const PUPIL_OFFSET: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -0.03 },
  down: { x: 0, y: 0.03 },
  left: { x: -0.03, y: 0 },
  right: { x: 0.03, y: 0 },
};

export default function PacManScreen() {
  const { width } = useWindowDimensions();
  // Arcade aspect ratio: playable grid is 28x29; we render at its native ratio (no distortion).
  // boardH is capped so the D-pad zone keeps ≥ ~35% of the screen on tall phones.
  const boardW = width; // full width
  const boardH = boardW * (ROWS / COLS); // native 29:28 ratio (playable maze)

  // Mutable game state (ref to avoid re-render per tick).
  const gridRef = useRef<Cell[][]>(createGrid());
  const stateRef = useRef<GameState>(createGame(1));
  const renderInterpRef = useRef(0); // 0..1 — interpolation factor for smooth movement
  const [renderTick, setRenderTick] = useState(0); // force re-render each frame
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  // Welcome gate: shows INSERT COIN / TAP TO START on first arrival.
  const [gated, setGated] = useState(true);
  const gatedRef = useRef(true);

  // Arcade intro: 3-phase cinematic, plays ONCE per member.
  // Phase 1 "coin":   INSERT COIN blinks (~8s)
  // Phase 2 "parade": Pac-Man + 4 ghosts glide L→R, eat the text
  // Phase 3 "press":  PRESS TO START (same yellow/font) → tap → game
  type IntroPhase = "coin" | "parade" | "press";
  const [introPhase, setIntroPhase] = useState<IntroPhase | null>(null);
  const [paradePos, setParadePos] = useState(-1);
  const [coinVisible, setCoinVisible] = useState(true);
  const [coinBlink, setCoinBlink] = useState(true);
  const [pacMouth, setPacMouth] = useState(true); // true=open, false=closed
  const arcadeSeenKey = `unguided.pacman.arcadeSeen.${getBoundMemberId()}`;

  useEffect(() => {
    try {
      if (!localStorage.getItem(arcadeSeenKey)) setIntroPhase("coin");
    } catch {}
  }, [arcadeSeenKey]);

  // Phase 1: coin blink + waka-waka. INSERT COIN blinks; each blink plays a
  // waka tone → "wa-ka-wa-ka-wa-ka" (6 waka) over ~3s, then it cuts to the parade.
  useEffect(() => {
    if (introPhase !== "coin") return;
    let blinkOn = true;
    let wakaN = 0;
    initAudio();
    const firstT = setTimeout(() => { initAudio(); setCoinBlink(false); soundDot(); wakaN = 1; }, 300);
    const blinkInt = setInterval(() => {
      blinkOn = !blinkOn;
      setCoinBlink(blinkOn);
      if (wakaN < 6) { soundDot(); wakaN++; }   // cap at 6 waka (wa-ka ×3)
    }, 500);
    const phaseT = setTimeout(() => setIntroPhase("parade"), 3000);
    return () => { clearInterval(blinkInt); clearTimeout(firstT); clearTimeout(phaseT); };
  }, [introPhase]);

  // Phase 2: parade animation. Pac-Man + ghosts glide L→R (~3s to cross).
  // A DOUBLE-SPEED waka-waka plays continuously while the parade is on screen —
  // it signals "Pac-Man is coming" and stops the instant the parade leaves.
  const coinVisibleRef = useRef(coinVisible);
  useEffect(() => { coinVisibleRef.current = coinVisible; }, [coinVisible]);
  useEffect(() => {
    if (introPhase !== "parade") return;
    initAudio();
    // Double-speed waka: alternate 440/330 every 160ms while on screen.
    let wakaAlt = false;
    const wakaInt = setInterval(() => { wakaAlt = !wakaAlt; soundDot(); }, 160);
    let pos = -0.15;
    const STEPS = 60;
    const int = setInterval(() => {
      pos += 1 / STEPS;
      setParadePos(pos);
      if (pos >= 0.48 && pos < 0.52 && coinVisibleRef.current) {
        coinVisibleRef.current = false;
        setCoinVisible(false);
      }
      if (pos >= 1.35) {            // parade fully off-screen → stop waka
        clearInterval(int);
        clearInterval(wakaInt);
        setTimeout(() => setIntroPhase("press"), 600);
      }
    }, 50);
    // Pac-Man mouth chomp: toggle every 150ms (3 frames per state)
    const mouthInt = setInterval(() => setPacMouth((m) => !m), 150);
    return () => { clearInterval(int); clearInterval(wakaInt); clearInterval(mouthInt); };
  }, [introPhase]);

  // Mark arcade intro as seen (called when user taps to start).
  const markArcadeSeen = useCallback(() => {
    if (introPhase) {
      try { localStorage.setItem(arcadeSeenKey, "1"); } catch {}
      setIntroPhase(null);
    }
  }, [introPhase, arcadeSeenKey]);

  // Restore saved game state on mount (if the player paused and navigated away).
  const [hasSaved, setHasSaved] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(savedKey());
      if (saved) {
        const parsed = JSON.parse(saved);
        stateRef.current = parsed.state;
        gridRef.current = parsed.grid;
        pausedRef.current = true;
        setPaused(true);
        setHasSaved(true);
        gatedRef.current = false;
        setGated(false);
        setRenderTick((t) => t + 1); // force re-render
      }
    } catch {
      /* ignore */
    }
  }, []);

  // High-score persistence (device store). Web loop: localStorage shim;
  // Phase 3.8 swaps for the secure store.
  const [high, setHigh] = useState(0);
  useEffect(() => {
    try {
      const h = parseInt(localStorage.getItem(bestKey()) || "0", 10) || 0;
      setHigh(h);
    } catch {
      /* ignore */
    }
  }, []);
  const saveHigh = useCallback((score: number) => {
    setHigh((prev) => {
      const next = Math.max(prev, score);
      try {
        localStorage.setItem(bestKey(), String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Restart game (from game over screen).
  const handleRestart = useCallback(() => {
    const finalScore = stateRef.current.score;
    saveHigh(finalScore);
    stateRef.current = createGame(1);
    gridRef.current = createGrid();
    pausedRef.current = false;
    setPaused(false);
    setHasSaved(false);
    try { localStorage.removeItem(savedKey()); } catch {}
    setRenderTick((t) => t + 1); // force re-render
  }, [saveHigh]);

  // Start fresh from the welcome gate.
  const handleStart = useCallback(() => {
    markArcadeSeen();
    stateRef.current = createGame(1);
    gridRef.current = createGrid();
    pausedRef.current = false;
    setPaused(false);
    setHasSaved(false);
    try { localStorage.removeItem(savedKey()); } catch {}
    gatedRef.current = false;
    setGated(false);
    setRenderTick((t) => t + 1);
  }, [markArcadeSeen]);

  // Arcade intro: tap during "press" phase → start game.
  const handleArcadePress = useCallback(() => {
    if (introPhase === "press") handleStart();
  }, [introPhase, handleStart]);

  // Continue saved game from the welcome gate.
  const handleContinue = useCallback(() => {
    markArcadeSeen();
    gatedRef.current = false;
    setGated(false);
    pausedRef.current = false;
    setPaused(false);
    setRenderTick((t) => t + 1);
  }, [markArcadeSeen]);

  // Keyboard input.
  const handleKey = useCallback((e: KeyboardEvent) => {
    const keyDir: Record<string, Direction> = {
      ArrowUp: "up", w: "up", W: "up",
      ArrowDown: "down", s: "down", S: "down",
      ArrowLeft: "left", a: "left", A: "left",
      ArrowRight: "right", d: "right", D: "right",
    };
    const dir = keyDir[e.key];
    if (dir) {
      e.preventDefault();
      if (gatedRef.current) return; // ignore input while gated
      initAudio(); // unlock Web Audio on first gesture
      applyInput(stateRef.current, dir);
    }
    // Space = pause/resume, or restart if game over
    if (e.key === " ") {
      e.preventDefault();
      initAudio();
      if (stateRef.current.phase === "gameOver") {
        handleRestart();
      } else {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }
    }
  }, [handleRestart]);

  // Web-only input path: the game loop + on-screen d-pad drive native.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  // Game loop with smooth interpolation (60fps rendering, fixed-timestep logic).
  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();
    let accumulator = 0;
    const cfg = levelConfig(stateRef.current.level);
    const tickMs = cfg.pacTickMs;

  let prevLevel = stateRef.current.level;
    let prevPhase = stateRef.current.phase;
    const loop = (now: number) => {
      rafId = requestAnimationFrame(loop);
      const dt = now - lastTime;
      lastTime = now;
      if (pausedRef.current || gatedRef.current) return;
      accumulator += dt;
      // Fixed-timestep updates
      while (accumulator >= tickMs) {
        step(stateRef.current, gridRef.current);
        accumulator -= tickMs;
      }
      // Reset grid when level changes (e.g., L1 → L2)
      if (stateRef.current.level !== prevLevel) {
        gridRef.current = createGrid();
        prevLevel = stateRef.current.level;
      }
      // Save high score when game ends
      if (stateRef.current.phase === "gameOver" && prevPhase !== "gameOver") {
        saveHigh(stateRef.current.score);
      }
      prevPhase = stateRef.current.phase;
      // Render every frame with interpolation factor
      const alpha = accumulator / tickMs; // 0..1 — how far into current tick
      renderInterpRef.current = alpha;
      setRenderTick((t) => t + 1);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [stateRef.current.level, saveHigh]); // restart on level change

  // Drain engine events → audio (runs after each render frame).
  useEffect(() => {
    const evs = stateRef.current.events;
    if (evs.length === 0) return;
    stateRef.current.events = [];
    for (const ev of evs) {
      switch (ev) {
        case "dot": soundDot(); break;
        case "power": soundPower(); break;
        case "eatGhost": soundEatGhost(); break;
        case "death": soundDeath(); break;
        case "fruit": soundFruit(); break;
        case "extraLife": soundExtraLife(); break;
        case "levelClear": soundExtraLife(); break; // fanfare on level complete
      }
    }
  }, [renderTick]);

  // Touch: tap to start / pause / resume.
  const onBoardPress = useCallback(() => {
    initAudio(); // unlock Web Audio on first gesture
    if (gatedRef.current) {
      // Dismiss the welcome gate → start the game.
      markArcadeSeen();
      handleStart();
      return;
    }
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
    // Save game state when pausing; clear when resuming.
    if (pausedRef.current) {
      try {
        localStorage.setItem(savedKey(), JSON.stringify({ state: stateRef.current, grid: gridRef.current }));
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.removeItem(savedKey());
      } catch {
        /* ignore */
      }
    }
  }, []);

  // D-Pad button press → apply input.
  const onDir = useCallback((dir: Direction) => {
    initAudio(); // unlock Web Audio on first gesture
    applyInput(stateRef.current, dir);
  }, []);

  const [dpadActive, setDpadActive] = useState<Direction | null>(null);

  // Extra life popup: shows briefly when the engine bumps bonusFlash.
  // NOTE: the hide-timeout handle lives in a REF, not the effect's cleanup —
  // this effect re-runs every renderTick, so a cleanup-based clearTimeout()
  // would cancel the pending hide on the very next frame (popup stuck forever).
  const [bonusLifeVisible, setBonusLifeVisible] = useState(false);
  const prevBonusRef = useRef(0);
  const bonusHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (stateRef.current.bonusFlash > prevBonusRef.current) {
      prevBonusRef.current = stateRef.current.bonusFlash;
      setBonusLifeVisible(true);
      if (bonusHideRef.current) clearTimeout(bonusHideRef.current);
      bonusHideRef.current = setTimeout(() => setBonusLifeVisible(false), 3000);
    }
  }, [renderTick]);
  useEffect(() => () => { if (bonusHideRef.current) clearTimeout(bonusHideRef.current); }, []);

  const s = stateRef.current;
  const grid = gridRef.current;
  const cfg = levelConfig(s.level);

  // Frightened flash check.
  const isFlashing =
    s.frightActive && s.frightTicks <= cfg.flashStart;
  const flashOn = isFlashing && Math.floor(s.tickCount / 3) % 2 === 0;

  return (
    <View style={styles.root}>
      {/* 1. Upper Mobile HUD: [1UP score] [Level] [TOP pill → leaderboard] */}
      <View style={styles.scoreRow}>
        <View style={styles.scoreGroup}>
          <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.scoreLabel}>1UP</Text>
          <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.scoreVal}>{String(s.score).padStart(6, "0")}</Text>
        </View>
        <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.levelText}>L{s.level}</Text>
        <WWT10Overlay
          score={Math.max(high, s.score)}
          diff="rx"
          board="pacman"
          label="TOP"
          scoreDigits={6}
          onOpen={() => {
            // Pause if the game is running.
            if (!pausedRef.current && s.phase !== "gameOver") {
              pausedRef.current = true;
              setPaused(true);
              try {
                localStorage.setItem(savedKey(), JSON.stringify({ state: stateRef.current, grid: gridRef.current }));
              } catch { /* ignore */ }
            }
          }}
        />
      </View>

      {/* 2. Main Game Viewport (locked arcade aspect ratio) */}
      <TouchableOpacity onPress={onBoardPress} activeOpacity={1}>
        <View style={[styles.board, { width: boardW, height: boardH, borderColor: C.wall }]}>
          <Svg width={boardW} height={boardH} viewBox={`0 0 ${COLS} ${ROWS}`} preserveAspectRatio="xMidYMid meet">
            {/* Walls - continuous neon lines */}
            <MazeWalls grid={grid} glow="fake" />

            {/* Dots */}
            <G>
              {grid.map((row, r) =>
                row.map((cell, c) => {
                  if (cell.type !== "dot") return null;
                  return <Circle key={`d${r}${c}`} cx={c + 0.5} cy={r + 0.5} r={0.12} fill={C.dot} />;
                })
              )}
            </G>

            {/* Power pellets */}
            <G>
              {grid.map((row, r) =>
                row.map((cell, c) => {
                  if (cell.type !== "power") return null;
                  return (
                    <Circle
                      key={`p${r}${c}`}
                      cx={c + 0.5}
                      cy={r + 0.5}
                      r={0.3}
                      fill={C.power}
                      opacity={Math.floor(s.tickCount / 8) % 2 === 0 ? 1 : 0.5}
                    />
                  );
                })
              )}
            </G>

            {/* Ghost house walls are in the maze data; no extra debug rect */}

            {/* Ghosts */}
            {s.ghosts.map((g: Ghost) => {
              const isFright = g.mode === "frightened";
              const isEyes = g.mode === "eyes";
              const bodyColor = isFright
                ? (flashOn ? C.ghostFrightenedFlash : C.ghostFrightened)
                : GHOST_COLORS[g.id];
              const pupil = PUPIL_OFFSET[g.dir] ?? PUPIL_OFFSET.right;
              const pos = lerpPos(g.prevPos, g.pos, renderInterpRef.current);
              return (
                <G key={`g${g.id}`} x={pos.x} y={pos.y}>
                  {!isEyes && <Path d={GHOST_BODY} fill={bodyColor} />}
                  {/* Eyes */}
                  <Circle cx={-0.12 + pupil.x} cy={-0.08 + pupil.y} r={0.1} fill={C.eye} />
                  <Circle cx={0.12 + pupil.x} cy={-0.08 + pupil.y} r={0.1} fill={C.eye} />
                  <Circle cx={-0.1 + pupil.x * 1.5} cy={-0.06 + pupil.y * 1.5} r={0.05} fill={C.pupil} />
                  <Circle cx={0.14 + pupil.x * 1.5} cy={-0.06 + pupil.y * 1.5} r={0.05} fill={C.pupil} />
                </G>
              );
            })}

            {/* Pac-Man */}
            {s.phase !== "gameOver" &&
              (() => {
                const pos = lerpPos(s.pacPrev, s.pac, renderInterpRef.current);
                // Death animation: mouth closes to full circle, then Pac-Man
                // shrinks to nothing. Driven by deathTicks (counts down from 10).
                //   deathTicks 10..6  → mouth closing (PAC_CLOSED, no spin)
                //   deathTicks 5..0   → shrinking (scale 1.0 → 0.0)
                let scale = 1;
                let mouthPath = s.pacMouthOpen ? PAC_OPEN : PAC_CLOSED;
                if (s.phase === "dying") {
                  if (s.deathTicks >= 6) {
                    // Phase 1: mouth fully closed, no movement
                    mouthPath = PAC_CLOSED;
                  } else {
                    // Phase 2: shrink to nothing
                    mouthPath = PAC_CLOSED;
                    scale = Math.max(0, s.deathTicks / 6);
                  }
                }
                return (
                  <G
                    x={pos.x}
                    y={pos.y}
                    rotation={DIR_ROTATION[s.pacDir] ?? 0}
                    originX={0}
                    originY={0}
                  >
                    <G scale={scale}>
                      <Path d={mouthPath} fill={C.pac} />
                    </G>
                  </G>
                );
              })()}

            {/* Fruit (spawns at 70 & 170 dots eaten, lives 9.5s) */}
            {s.fruit && (
              <G>
                <SvgText
                  x={s.fruit.col + 0.5}
                  y={s.fruit.row + 0.7}
                  fontSize={1.2}
                  textAnchor="middle"
                >
                  {fruitForLevel(s.level)}
                </SvgText>
              </G>
            )}

            {/* Score popup (frightened freeze) */}
            {s.frightFreezeGhost !== null && (
              <G
                x={s.ghosts[s.frightFreezeGhost].pos.col + 0.5}
                y={s.ghosts[s.frightFreezeGhost].pos.row}
              >
                <SvgText fontSize={0.8} fill={C.pac} textAnchor="middle" fontWeight="bold">
                  {s.frightFreezeScore}
                </SvgText>
              </G>
            )}

            {/* READY! — rendered at maze center (ghost house / through-wall area, row ~14) */}
            {s.phase === "levelIntro" && (
              <G>
                {/* Glow layer */}
                <SvgText
                  x={COLS / 2}
                  y={14.5}
                  fontSize={4.4}
                  fill="rgba(255,230,0,0.3)"
                  textAnchor="middle"
                  fontWeight="900"
                >
                  READY!
                </SvgText>
                {/* Main text */}
                <SvgText
                  x={COLS / 2}
                  y={14.5}
                  fontSize={4.0}
                  fill={C.pac}
                  textAnchor="middle"
                  fontWeight="900"
                  letterSpacing="0.2"
                >
                  READY!
                </SvgText>
              </G>
            )}
          </Svg>

          {/* Overlays (inside the board so they don't cover the score row) */}
          {gated && (
            <TouchableOpacity
              style={[styles.overlay, introPhase && { backgroundColor: "#000" }]}
              activeOpacity={0.9}
              onPress={introPhase ? handleArcadePress : handleStart}
              testID="pacman-welcome"
            >
              {introPhase === "coin" ? (
                // ── Phase 1: INSERT COIN blinking ──
                <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={[styles.arcadeCoinText, { opacity: coinBlink ? 1 : 0.15 }]}>
                  INSERT COIN
                </Text>
              ) : introPhase === "parade" ? (
                // ── Phase 2: Pac-Man + 4 ghosts glide L→R (SVG) ──
                <View style={styles.paradeTrack}>
                  {coinVisible && (
                    <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.arcadeCoinText}>INSERT COIN</Text>
                  )}
                  <Svg
                    width={width}
                    height={80}
                    viewBox={`0 0 ${width} 80`}
                    style={{ position: "absolute", top: "50%", left: 0, marginTop: -40 }}
                  >
                    {(() => {
                      // Sprite paths are ~0.7 units; scale up 50x → ~35px sprites
                      const S = 50;
                      const actors = [
                        { id: "pac", off: 0, yOff: 0, color: C.pac, isPac: true },
                        { id: "b", off: -0.08, yOff: -18, color: C.ghostBlinky, isPac: false },
                        { id: "p", off: -0.12, yOff: 18, color: C.ghostPinky, isPac: false },
                        { id: "i", off: -0.16, yOff: -18, color: C.ghostInky, isPac: false },
                        { id: "c", off: -0.20, yOff: 18, color: C.ghostClyde, isPac: false },
                      ];
                      return actors.map((a) => {
                        const tx = (paradePos + a.off) * 1.1 * width;
                        return (
                          <G
                            key={a.id}
                            x={tx}
                            y={40 + a.yOff}
                            scale={S}
                          >
                            {a.isPac ? (
                              <Path d={pacMouth ? PAC_OPEN : PAC_CLOSED} fill={a.color} />
                            ) : (
                              <G>
                                <Path d={GHOST_BODY} fill={a.color} />
                                <Circle cx={-0.12} cy={-0.08} r={0.1} fill={C.eye} />
                                <Circle cx={0.12} cy={-0.08} r={0.1} fill={C.eye} />
                                <Circle cx={-0.09} cy={-0.06} r={0.05} fill={C.pupil} />
                                <Circle cx={0.15} cy={-0.06} r={0.05} fill={C.pupil} />
                              </G>
                            )}
                          </G>
                        );
                      });
                    })()}
                  </Svg>
                </View>
              ) : introPhase === "press" ? (
                // ── Phase 3: PRESS TO START ──
                <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.arcadeCoinText}>PRESS TO START</Text>
              ) : (
                // ── Normal welcome gate (no intro) ──
                <>
                  <Svg width={48} height={48} viewBox="-0.5 -0.5 1 1">
                    <Path d={PAC_OPEN} fill={C.pac} />
                  </Svg>
                  <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.welcomeTitle}>PAC-MAN</Text>
                  {high > 0 && (
                    <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.bestChip}>
                      TOP <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.scoreVal}>{String(high).padStart(6, "0")}</Text>
                    </Text>
                  )}
                  <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.insertCoin}>INSERT COIN</Text>
                  <View style={styles.welcomeBtns}>
                    <TouchableOpacity style={styles.restartBtn} onPress={handleStart} testID="pacman-start">
                      <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.restartText}>Start</Text>
                    </TouchableOpacity>
                    {hasSaved && (
                      <TouchableOpacity style={styles.restartBtn} onPress={handleContinue} testID="pacman-continue">
                        <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.restartText}>Continue</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.overlaySub}>tap to start</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          {!gated && paused && (
            <TouchableOpacity
              style={styles.overlay}
              activeOpacity={0.8}
              onPress={onBoardPress}
            >
              <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.overlayText}>PAUSED</Text>
              <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.overlaySub}>tap the box to resume</Text>
            </TouchableOpacity>
          )}
          {s.phase === "gameOver" && (
            <View style={styles.overlay}>
              <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.overlayText}>GAME OVER</Text>
              <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.overlayScore}>
                {s.score} {s.score === 1 ? "point" : "points"}
              </Text>
              {s.score >= high && s.score > 0 && <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.newBest}>NEW BEST 🦈</Text>}
              <TouchableOpacity style={styles.restartBtn} onPress={handleRestart}>
                <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.restartText}>Restart</Text>
              </TouchableOpacity>
            </View>
          )}
          {s.phase === "dying" && (
            <View style={[styles.overlay, { backgroundColor: "transparent" }]}>
              {/* Death spin animation would go here */}
            </View>
          )}
          {bonusLifeVisible && (
            <View style={[styles.overlay, { backgroundColor: "transparent" }]}>
              <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.extraLifeText}>EXTRA LIFE!</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* 3. Footer: [Left D-pad cross] [Lives + Fruit + Pellets] [Right D-pad cross]
          Hidden during the intro gate (gated=true) so the arcade intro is all-black
          board + header only, no D-pads or footer chrome. */}
      {!gated && (
      <View style={styles.footerZone}>
        <View style={styles.footerRow1}>
          {/* Left D-pad: full cross (◀ ▲ ▼ ▶) */}
          <View style={styles.dpadGrid}>
            <View style={[styles.dpadRow, { justifyContent: "center" }]}>
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="up" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
            </View>
            <View style={[styles.dpadRow, { justifyContent: "space-between" }]}>
              <DpadBtn dir="left" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="right" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
            </View>
            <View style={[styles.dpadRow, { justifyContent: "center" }]}>
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="down" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
            </View>
          </View>

          {/* Center: Lives, Fruit, Pellet count */}
          <View style={styles.centerInfo}>
            <View style={styles.livesGroup}>
              {Array.from({ length: Math.max(0, s.lives - 1) }).map((_, i) => (
                <Svg key={i} width={18} height={18} viewBox="-0.5 -0.5 1 1">
                  <Path d={PAC_OPEN} fill={C.pac} />
                </Svg>
              ))}
            </View>
            <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.fruit}>{fruitForLevel(s.level)}</Text>
            <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.pelletCount}>{s.pelletsLeft} left</Text>
          </View>

          {/* Right D-pad: full cross (◀ ▲ ▼ ▶) */}
          <View style={styles.dpadGrid}>
            <View style={[styles.dpadRow, { justifyContent: "center" }]}>
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="up" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
            </View>
            <View style={[styles.dpadRow, { justifyContent: "space-between" }]}>
              <DpadBtn dir="left" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="right" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
            </View>
            <View style={[styles.dpadRow, { justifyContent: "center" }]}>
              <View style={styles.dpadSpacer} />
              <DpadBtn dir="down" active={dpadActive} onDir={onDir} setActive={setDpadActive} />
              <View style={styles.dpadSpacer} />
            </View>
          </View>
        </View>
      </View>
      )}
    </View>
  );
}

// Fruit by level (authentic arcade progression).
function fruitForLevel(level: number): string {
  const fruits = ["🍒", "🍓", "🍊", "🍎", "🍌", "🍇", "🍐", "🍑", "⭐"];
  return fruits[Math.min(level - 1, fruits.length - 1)];
}

// Reusable D-pad button (cross-shaped D-pad: 4 directions)
const DpadBtn: React.FC<{
  dir: Direction;
  active: Direction | null;
  onDir: (d: Direction) => void;
  setActive: (d: Direction | null) => void;
}> = ({ dir, active, onDir, setActive }) => {
  const arrow: Record<Direction, string> = { up: "▲", down: "▼", left: "◀", right: "▶" };
  return (
    <TouchableOpacity
      style={[styles.dpadBtn, active === dir && styles.dpadActive]}
      onPress={() => {
        setActive(dir);
        onDir(dir);
        setTimeout(() => setActive(null), 120);
      }}
      activeOpacity={0.8}
    >
      <Text allowFontScaling={false} style={styles.dpadArrow}>{arrow[dir]}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // Full-height column: HUD → viewport → footer → D-pad.
  root: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "flex-start", overflow: "hidden" },
  // 1. Upper HUD.
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  scoreGroup: { flexDirection: "row", alignItems: "baseline" },
  scoreLabel: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginRight: 8 },
  scoreVal: { color: C.text, fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"], letterSpacing: 1 },
  levelText: { color: C.pac, fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  // 2. Viewport (aspect-locked board).
  board: { position: "relative", borderRadius: 4, borderWidth: 1.5, borderColor: C.wall, backgroundColor: "#000" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.82)" },
  overlayText: { color: C.text, fontSize: 28, fontWeight: "900", letterSpacing: 3, marginBottom: 8 },
  overlaySub: { color: C.muted, fontSize: 13 },
  welcomeTitle: { color: C.pac, fontSize: 32, fontWeight: "900", letterSpacing: 4, marginBottom: 12, marginTop: 8 },
  // ── Arcade intro (first-unlock) ──
  arcadeCoinText: { color: C.pac, fontSize: 22, fontWeight: "800", letterSpacing: 4, textShadowColor: "rgba(255,230,0,0.4)", textShadowRadius: 12 },
  // ── Parade animation ──
  paradeTrack: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  bestChip: { color: C.muted, fontSize: 13, fontWeight: "700", letterSpacing: 1, marginBottom: 16 },
  insertCoin: { color: C.pac, fontSize: 16, fontWeight: "800", letterSpacing: 2, marginBottom: 16 },
  welcomeBtns: { flexDirection: "row", gap: 12, marginBottom: 16 },
  overlayScore: { color: C.text, fontSize: 20, fontWeight: "700", marginTop: 14 },
  newBest: { color: C.dot, fontSize: 13, fontWeight: "700", marginTop: 6, letterSpacing: 1 },
  restartBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#222",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#444",
  },
  restartText: { color: C.text, fontSize: 16, fontWeight: "600" },
  levelIntro: { color: C.pac, fontSize: 24, fontWeight: "900", letterSpacing: 2 },
  readyText: { color: C.text, fontSize: 20, fontWeight: "900", letterSpacing: 4, marginTop: 12, backgroundColor: "#000", paddingHorizontal: 12, paddingVertical: 4 },
  // 3. Footer: two cross-shaped D-pads (left + right) with center info (lives, fruit, pellets).
  footerZone: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", paddingBottom: 6, gap: 4 },
  footerRow1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", paddingHorizontal: 4 },
  // Cross-shaped D-pad grid (3x3, center empty)
  dpadGrid: { width: 156, height: 156, justifyContent: "center" },
  dpadRow: { flexDirection: "row", width: "100%", height: 48, alignItems: "center" },
  dpadSpacer: { width: 52, height: 52 },
  // Center info: lives, fruit, pellet count
  centerInfo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  livesGroup: { flexDirection: "row", gap: 2 },
  fruit: { fontSize: 18 },
  pelletCount: { color: C.muted, fontSize: 12, fontWeight: "bold", textAlign: "center" },
  extraLifeText: { color: C.pac, fontSize: 24, fontWeight: "900", letterSpacing: 3, textShadowColor: "rgba(255,230,0,0.5)", textShadowRadius: 12 },
  dpadBtn: { width: 52, height: 52, borderRadius: 12, backgroundColor: "#111", borderWidth: 1.5, borderColor: C.wall, alignItems: "center", justifyContent: "center" },
  dpadActive: { backgroundColor: "#3333ff33", borderColor: C.pac },
  dpadArrow: { color: C.pac, fontSize: 20, fontWeight: "900" },
});
