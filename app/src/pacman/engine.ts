// Pac-Man engine — pure TS, renderer-agnostic.
// Fixed-timestep loop. Grid-based movement. No React, no DOM.
//
// Tick rate: 150ms/cell (Pac-Man base). Ghosts at 80% speed (move every other tick
// in a 2-tick cycle, or use fractional stepping).
//
// For v1 simplicity: all entities move on the same tick. Ghosts move 1 cell per tick
// but with a speed modifier: they only move on ticks where (tick % 5) < 4 (80% speed).
// In tunnel: (tick % 10) < 4 (50% speed).

import {
  COLS,
  ROWS,
  TUNNEL_ROW,
  PAC_START,
  GHOST_STARTS,
  GHOST_SPAWN_DIRS,
  GHOST_SCATTER_TARGETS,
  GHOST_COLORS,
  GHOST_NAMES,
  HOUSE_EXIT_DOTS,
  HOUSE_BOUNDS,
  parseMaze,
  countPellets,
  FRUIT_POS,
  type Cell,
} from "./maze";
import type {
  Direction,
  Position,
  Ghost,
  GhostMode,
  GamePhase,
  GameState,
  GameEvent,
} from "./types";

// --- Constants ---
export const TICK_MS = 270; // one game tick (arcade-feel, not frantic)
const READY_TICKS = 10; // ~2.5s "READY!" freeze
const SCATTER_FIRST = 70; // 7s at 150ms/tick
const CHASE_FIRST = 133; // 20s
const SCATTER_2ND = 47; // 7s
const CHASE_2ND = 133; // 20s
const SCATTER_3RD = 33; // 5s
const CHASE_3RD = 133; // 20s
const SCATTER_4TH = 33; // 5s
// After scatter 4: permanent chase

// Frightened mode durations (ticks) per level.
// 1 tick = 150ms. Flash period = last 2s (13 ticks) for levels 1-8, last 1s (7 ticks) for 9+.
// Level 19+: 0s (Blue Mode Trick — reverse but stay deadly, never turn blue).
function frightDuration(level: number): number {
  if (level <= 1) return 40;   // 6s
  if (level === 2) return 33;  // 5s
  if (level <= 4) return 27;   // 4s
  if (level <= 8) return 20;   // 3s
  if (level <= 18) return 7;   // 1s
  return 0;                    // Level 19+: no frightened mode (Blue Mode Trick)
}

// Flash period (ticks) — when ghosts start flashing white/blue.
function frightFlashStart(level: number): number {
  if (level <= 8) return 13;   // last 2s
  return 7;                    // last 1s (levels 9-18)
}

// Fruit spawn thresholds (dots eaten this level) and lifetime (9.5s = 63 ticks @ 150ms).
export const FRUIT_DOTS_1 = 70;
export const FRUIT_DOTS_2 = 170;
export const FRUIT_LIFE_TICKS = 63; // ~9.5s

// Fruit score per level (arcade progression; 6+ = max).
export function fruitPoints(level: number): number {
  const table = [100, 300, 500, 700, 1000, 2000];
  return table[Math.min(level - 1, table.length - 1)];
}

// Level speed config (Pac-Man and ghost base speed as fraction of tick).
// v1: fixed tick rate. Speed scaling via tick interval adjustment in the UI loop.
export interface LevelConfig {
  pacTickMs: number;
  ghostTickMs: number;
  frightDuration: number;
  flashStart: number;
}

export function levelConfig(level: number): LevelConfig {
  const base = TICK_MS;
  const speedScale = Math.max(0.5, 1 - (level - 1) * 0.03); // -3% per level, min 50%
  return {
    pacTickMs: Math.round(base * speedScale),
    ghostTickMs: Math.round(base * 1.25 * speedScale), // ghosts move slower than pac
    frightDuration: frightDuration(level),
    flashStart: frightFlashStart(level),
  };
}

// --- Helpers ---
const DIRS: Record<Direction, Position> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// Priority order for tiebreaker: Up, Left, Down, Right.
const DIR_PRIORITY: Direction[] = ["up", "left", "down", "right"];

// The 4 intersections above the ghost house where UP is forbidden for ghosts.
// These are the cells where a ghost would turn up into the ghost house area.
const NO_UP_CELLS = new Set([
  "11,11", // top-left of ghost house
  "16,11", // top-right of ghost house
  "11,15", // bottom-left of ghost house
  "16,15", // bottom-right of ghost house
]);

function key(c: number, r: number): string {
  return `${c},${r}`;
}

// Is this cell walkable for Pac-Man?
function isWalkableForPac(grid: Cell[][], col: number, row: number): boolean {
  if (row < 0 || row >= ROWS) return false;
  // Tunnel wrap
  if (col < 0 || col >= COLS) return row === TUNNEL_ROW;
  const cell = grid[row][col];
  return cell.type !== "wall" && cell.type !== "ghostDoor";
}

// Is this cell walkable for a ghost?
function isWalkableForGhost(grid: Cell[][], col: number, row: number, isEyes: boolean): boolean {
  if (row < 0 || row >= ROWS) return false;
  if (col < 0 || col >= COLS) return row === TUNNEL_ROW;
  const cell = grid[row][col];
  if (cell.type === "wall") return false;
  // Door: passable for all ghosts (normal ghosts exit the house, eyes return home).
  // Pac-Man never reaches this function (isWalkableForPac blocks the door).
  return true;
}

// --- Game State ---
export function createGame(level = 1): GameState {
  const pellets = countPellets();
  const ghosts: Ghost[] = GHOST_STARTS.map((pos, i) => ({
    id: i,
    name: GHOST_NAMES[i],
    color: GHOST_COLORS[i],
    pos: { ...pos },
    prevPos: { ...pos },
    dir: GHOST_SPAWN_DIRS[i],
    mode: i === 0 ? "scatter" : "inHouse" as GhostMode, // Blinky starts in scatter (arcade-authentic)
    frightTicks: 0,
    houseTicks: 0, // dot counter for house exit
  }));

  return {
    phase: "levelIntro",
    level,
    score: 0,
    lives: 3,
    pelletsLeft: pellets.total,
    pac: { ...PAC_START },
    pacPrev: { ...PAC_START },
    pacDir: "left",
    pacQueuedDir: null,
    pacMouthOpen: true,
    ghosts,
    frightActive: false,
    frightTicks: 0,
    ghostChain: 0,
    fruit: null,
    fruitTicks: 0,
    fruitSpawned: 0,
    extraLifeAt: 10000,
    bonusFlash: 0,
    tickCount: 0,
    levelIntroTicks: READY_TICKS, // ~2.5s "READY!" freeze (was missing → intro hung forever)
    deathTicks: 0,
    scatterTicks: SCATTER_FIRST,
    tunnelWrapping: false,
    frightFreezeGhost: null,
    frightFreezeScore: 0,
    events: [],
  };
}

// --- Input ---
export function applyInput(state: GameState, dir: Direction): void {
  if (state.phase !== "playing") return;
  state.pacQueuedDir = dir;
}

// --- Movement ---
function movePac(state: GameState, grid: Cell[][]): void {
  state.pacPrev = { ...state.pac };

  // Try queued direction first (turn if possible).
  // Only clear the queue if the turn succeeded — if it failed (wall),
  // keep it buffered so it applies on the next tick when aligned.
  // This gives a ~1 tick grace period, so tapping a direction slightly
  // early still works (classic arcade input feel).
  if (state.pacQueuedDir) {
    const qd = state.pacQueuedDir;
    const nc = state.pac.col + DIRS[qd].col;
    const nr = state.pac.row + DIRS[qd].row;
    if (isWalkableForPac(grid, nc, nr)) {
      state.pacDir = qd;
      state.pacQueuedDir = null; // consume buffer
    }
    // else: keep buffered — will retry next tick
  }

  // Try current direction
  const nc = state.pac.col + DIRS[state.pacDir].col;
  const nr = state.pac.row + DIRS[state.pacDir].row;

  // Tunnel wrap
  state.tunnelWrapping = false;
  let finalCol = nc;
  if (nc < 0) {
    if (state.pac.row === TUNNEL_ROW) {
      finalCol = COLS - 1;
      state.tunnelWrapping = true;
    } else {
      return; // blocked
    }
  } else if (nc >= COLS) {
    if (state.pac.row === TUNNEL_ROW) {
      finalCol = 0;
      state.tunnelWrapping = true;
    } else {
      return; // blocked
    }
  } else if (!isWalkableForPac(grid, nc, nr)) {
    return; // blocked
  }

  state.pac = { col: finalCol, row: nr };
  // On tunnel wrap, snap prevPos = pos so the render lerp doesn't slide
  // the icon across the entire screen — it should disappear/reappear.
  if (state.tunnelWrapping) {
    state.pacPrev = { ...state.pac };
  }
  state.pacMouthOpen = !state.pacMouthOpen;
}

function moveGhost(state: GameState, grid: Cell[][], ghost: Ghost): void {
  // Ghosts move every tick (1 cell per tick), same cadence as Pac-Man.
  // No speed gate — the "move 4, skip 1" pattern caused visible stutter when
  // interpolation was disabled. The arcade-feel of "ghosts slightly slower"
  // comes from AI turn decisions, not a tick-skip.
  ghost.prevPos = { ...ghost.pos };
  const isEyes = ghost.mode === "eyes";
  const isFrightened = ghost.mode === "frightened";
  const isExiting = ghost.mode === "exiting";

  // In-house ghosts: bounce vertically between house floor (row 15) and ceiling (row 13).
  if (ghost.mode === "inHouse") {
    const nc = ghost.pos.col + DIRS[ghost.dir].col;
    const nr = ghost.pos.row + DIRS[ghost.dir].row;
    const inBounds =
      nr >= HOUSE_BOUNDS.minRow &&
      nr <= HOUSE_BOUNDS.maxRow &&
      nc >= HOUSE_BOUNDS.minCol &&
      nc <= HOUSE_BOUNDS.maxCol;
    if (inBounds) {
      ghost.pos = { col: nc, row: nr };
    } else {
      // Reverse (bounce off house walls)
      ghost.dir = OPPOSITE[ghost.dir];
    }
    return;
  }

  // Exiting: glide straight up through the door at (14, 12).
  // Move to col 14 first, then straight up. The door cell (ghostDoor) is
  // passable here because we're exiting — handled with a direct check below.
  if (isExiting) {
    const door = { col: 14, row: 12 };
    if (ghost.pos.col !== door.col) {
      ghost.dir = ghost.pos.col < door.col ? "right" : "left";
    } else {
      ghost.dir = "up";
    }

    const nc = ghost.pos.col + DIRS[ghost.dir].col;
    const nr = ghost.pos.row + DIRS[ghost.dir].row;
    // Door cell is passable when exiting (moving up through it).
    const isDoor = grid[nr]?.[nc]?.type === "ghostDoor";
    const canMove = isDoor || isWalkableForGhost(grid, nc, nr, false);
    if (canMove) {
      ghost.pos = { col: nc, row: nr };
    } else if (ghost.pos.col !== door.col) {
      ghost.dir = OPPOSITE[ghost.dir];
    }

    // Reached/above the door row → back in the maze.
    if (ghost.pos.col === door.col && ghost.pos.row <= door.row) {
      ghost.mode = state.scatterTicks > 0 ? "scatter" : "chase";
      ghost.dir = "left"; // authentic exit direction
    }
    return;
  }

  // Eyes: navigate to ghost house at 200% speed (move every tick, no speed gate)
  if (isEyes) {
    const houseEntrance = { col: 14, row: 12 }; // ghost house door
    // Move toward entrance — eyes use their own pathfinding (can reverse, can go up anywhere)
    // Anti-oscillation: avoid reversing direction unless it's the only option.
    const candidates: Direction[] = [];
    for (const d of DIR_PRIORITY) {
      const nc = ghost.pos.col + DIRS[d].col;
      const nr = ghost.pos.row + DIRS[d].row;
      if (isWalkableForGhost(grid, nc, nr, true)) {
        candidates.push(d);
      }
    }
    if (candidates.length > 0) {
      // Prefer non-reversing directions (anti-oscillation)
      const reverseDir = OPPOSITE[ghost.dir];
      const nonReverseCandidates = candidates.filter((d) => d !== reverseDir);
      const pool = nonReverseCandidates.length > 0 ? nonReverseCandidates : candidates;

      // Pick direction that minimizes distance to house entrance
      let bestDir = pool[0];
      let bestDist = Infinity;
      for (const d of pool) {
        const nc = ghost.pos.col + DIRS[d].col;
        const nr = ghost.pos.row + DIRS[d].row;
        const dist = Math.sqrt((nc - houseEntrance.col) ** 2 + (nr - houseEntrance.row) ** 2);
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = d;
        }
      }
      ghost.dir = bestDir;
    }
    const nc = ghost.pos.col + DIRS[ghost.dir].col;
    const nr = ghost.pos.row + DIRS[ghost.dir].row;
    if (isWalkableForGhost(grid, nc, nr, true)) {
      ghost.pos = { col: nc, row: nr };
    }
    // Reached entrance? → inHouse, will exit and re-enter maze
    if (ghost.pos.col === houseEntrance.col && ghost.pos.row === houseEntrance.row) {
      ghost.mode = "inHouse";
      ghost.pos = { col: 14, row: 14 }; // teleport back into house center
      ghost.dir = "up";
    }
    return;
  }

  // Normal chase/scatter/frightened movement
  // At intersections, choose direction by minimizing distance to target
  const candidates: Direction[] = [];
  for (const d of DIR_PRIORITY) {
    if (d === OPPOSITE[ghost.dir]) continue; // no reverse (even when frightened)
    // No-up restriction: DISABLED when frightened
    if (d === "up" && !isFrightened && NO_UP_CELLS.has(key(ghost.pos.col, ghost.pos.row))) continue;
    const nc = ghost.pos.col + DIRS[d].col;
    const nr = ghost.pos.row + DIRS[d].row;
    // No-enter rule: chase/scatter/frightened ghosts CANNOT walk into the
    // ghost house. Only "eyes" (returning) and "exiting" (leaving) can.
    if (!isEyes && !isExiting) {
      if (
        nc >= HOUSE_BOUNDS.minCol && nc <= HOUSE_BOUNDS.maxCol &&
        nr >= HOUSE_BOUNDS.minRow && nr <= HOUSE_BOUNDS.maxRow
      ) continue;
    }
    if (isWalkableForGhost(grid, nc, nr, false)) {
      candidates.push(d);
    }
  }

  if (candidates.length === 0) {
    // Dead end — reverse (shouldn't happen in Pac-Man maze, but safety)
    ghost.dir = OPPOSITE[ghost.dir];
    const nc = ghost.pos.col + DIRS[ghost.dir].col;
    const nr = ghost.pos.row + DIRS[ghost.dir].row;
    const inHouse =
      nc >= HOUSE_BOUNDS.minCol && nc <= HOUSE_BOUNDS.maxCol &&
      nr >= HOUSE_BOUNDS.minRow && nr <= HOUSE_BOUNDS.maxRow;
    if (!inHouse && isWalkableForGhost(grid, nc, nr, false)) {
      ghost.pos = { col: nc, row: nr };
    }
    return;
  }

  if (candidates.length === 1) {
    ghost.dir = candidates[0];
  } else if (isFrightened) {
    // Pseudo-random: pick from valid open paths (no reverse, no walls)
    // Standard random selection (simpler than 1980 16-bit shift register)
    const idx = Math.floor(Math.random() * candidates.length);
    ghost.dir = candidates[idx];
  } else {
    // Euclidean distance to target (screen coords: add 3 to grid row)
    const target = getGhostTarget(state, ghost, grid);
    let bestDir = candidates[0];
    let bestDist = Infinity;
    for (const d of candidates) {
      const nc = ghost.pos.col + DIRS[d].col;
      const nr = ghost.pos.row + DIRS[d].row;
      const dScreen = Math.sqrt((nc - target.col) ** 2 + (nr + 3 - target.row) ** 2);
      if (dScreen < bestDist) {
        bestDist = dScreen;
        bestDir = d;
      }
    }
    ghost.dir = bestDir;
  }

  const nc = ghost.pos.col + DIRS[ghost.dir].col;
  const nr = ghost.pos.row + DIRS[ghost.dir].row;

  // Tunnel wrap for ghosts
  let finalCol = nc;
  let wrapped = false;
  if (nc < 0 && ghost.pos.row === TUNNEL_ROW) { finalCol = COLS - 1; wrapped = true; }
  else if (nc >= COLS && ghost.pos.row === TUNNEL_ROW) { finalCol = 0; wrapped = true; }
  else if (!isWalkableForGhost(grid, nc, nr, false)) return;

  ghost.pos = { col: finalCol, row: nr };
  // On tunnel wrap, snap prevPos = pos so the render lerp doesn't slide
  // the icon across the entire screen — it should disappear/reappear.
  if (wrapped) {
    ghost.prevPos = { ...ghost.pos };
  }
}

// --- Ghost Targeting (Chase Mode) ---
function getGhostTarget(state: GameState, ghost: Ghost, grid: Cell[][]): Position {
  const pac = state.pac;
  const pacDir = state.pacDir;

  switch (ghost.id) {
    case 0: // Blinky
      if (state.pelletsLeft <= 20 || state.pelletsLeft <= 10) {
        // Cruise Elroy: always targets Pac-Man
        return { col: pac.col, row: pac.row };
      }
      if (ghost.mode === "scatter") {
        return GHOST_SCATTER_TARGETS[0];
      }
      return { col: pac.col, row: pac.row };

    case 1: // Pinky
      if (ghost.mode === "scatter") {
        return GHOST_SCATTER_TARGETS[1];
      }
      // 4 tiles ahead of Pac-Man
      let tc = pac.col + DIRS[pacDir].col * 4;
      let tr = pac.row + DIRS[pacDir].row * 4;
      // The upward bug: if facing up, add 4 left
      if (pacDir === "up") {
        tc -= 4;
      }
      return { col: tc, row: tr };

    case 2: // Inky
      if (ghost.mode === "scatter") {
        return GHOST_SCATTER_TARGETS[2];
      }
      // 2 tiles ahead of Pac-Man
      let ic = pac.col + DIRS[pacDir].col * 2;
      let ir = pac.row + DIRS[pacDir].row * 2;
      if (pacDir === "up") {
        ic -= 2;
      }
      // Vector from Blinky to intermediate, doubled
      const blinky = state.ghosts[0].pos;
      const vecX = ic - blinky.col;
      const vecY = ir - blinky.row;
      return { col: ic + vecX, row: ir + vecY };

    case 3: // Clyde
      if (ghost.mode === "scatter") {
        return GHOST_SCATTER_TARGETS[3];
      }
      // Distance check
      const dist = Math.sqrt((ghost.pos.col - pac.col) ** 2 + (ghost.pos.row - pac.row) ** 2);
      if (dist > 8) {
        return { col: pac.col, row: pac.row };
      }
      // Too close: flee to scatter corner
      return GHOST_SCATTER_TARGETS[3];

    default:
      return { col: pac.col, row: pac.row };
  }
}

// --- Score (with extra-life check) ---
function addScore(state: GameState, pts: number): void {
  state.score += pts;
  checkBonusLife(state);
}

// Arcade tradition: extra life at 10,000; then again at double each time.
function checkBonusLife(state: GameState): void {
  if (state.score >= state.extraLifeAt) {
    state.lives++;
    state.bonusFlash++;
    state.extraLifeAt *= 2;
    state.events.push("extraLife");
  }
}

// --- Fruit ---
// Spawns at FRUIT_DOTS_1 / FRUIT_DOTS_2 dots eaten, lives FRUIT_LIFE_TICKS,
// and is eaten when Pac-Man steps on it.
function updateFruit(state: GameState): void {
  const dotsEaten = countPellets().total - state.pelletsLeft;

  if (state.fruit) {
    state.fruitTicks--;
    if (state.fruitTicks <= 0) {
      state.fruit = null;
    }
  } else if (state.fruitSpawned === 0 && dotsEaten >= FRUIT_DOTS_1) {
    state.fruit = { ...FRUIT_POS };
    state.fruitTicks = FRUIT_LIFE_TICKS;
    state.fruitSpawned = 1;
  } else if (state.fruitSpawned === 1 && dotsEaten >= FRUIT_DOTS_2) {
    state.fruit = { ...FRUIT_POS };
    state.fruitTicks = FRUIT_LIFE_TICKS;
    state.fruitSpawned = 2;
  }
}

function eatFruit(state: GameState): void {
  if (!state.fruit) return;
  if (state.pac.col === state.fruit.col && state.pac.row === state.fruit.row) {
    state.fruit = null;
    state.fruitTicks = 0;
    addScore(state, fruitPoints(state.level));
    state.events.push("fruit");
  }
}

// --- Eating ---
function eatAt(state: GameState, grid: Cell[][]): void {
  const cell = grid[state.pac.row][state.pac.col];
  if (cell.type === "dot") {
    addScore(state, 10);
    state.pelletsLeft--;
    cell.type = "path";
    state.events.push("dot");
  } else if (cell.type === "power") {
    addScore(state, 50);
    state.pelletsLeft--;
    cell.type = "path";
    // Activate frightened mode
    state.frightActive = true;
    state.frightTicks = frightDuration(state.level);
    state.ghostChain = 0;
    for (const g of state.ghosts) {
      if (g.mode === "chase" || g.mode === "scatter") {
        g.mode = "frightened";
        g.dir = OPPOSITE[g.dir]; // reverse on fright
      }
    }
    state.events.push("power");
  }
}

// --- Collision ---
function checkCollisions(state: GameState): void {
  if (state.phase !== "playing") return;

  for (const g of state.ghosts) {
    if (g.mode === "inHouse" || g.mode === "exiting") continue;
    if (g.mode === "eyes") continue;

    // Same cell or crossing paths
    const sameCell = g.pos.col === state.pac.col && g.pos.row === state.pac.row;
    const crossing =
      g.pos.col === state.pacPrev.col && g.pos.row === state.pacPrev.row &&
      g.prevPos.col === state.pac.col && g.prevPos.row === state.pac.row;

    if (!sameCell && !crossing) continue;

    if (g.mode === "frightened") {
      // Eat ghost: freeze frame + score display + eyes return
      // Combo: 100 * 2^n (n = ghostChain, 0-indexed → 200, 400, 800, 1600)
      const pts = 100 * Math.pow(2, state.ghostChain + 1);
      addScore(state, pts);
      state.ghostChain++;
      state.frightFreezeGhost = g.id;
      state.frightFreezeScore = pts;
      // Score popup only — game keeps moving. The eaten ghost becomes eyes
      // immediately and heads home. No global freeze (classic Pac-Man feel).
      state.deathTicks = 2; // ~0.5s score popup display
      g.mode = "eyes";
      state.events.push("eatGhost");
      break;
    } else {
      // Death
      state.phase = "dying";
      state.deathTicks = 10; // 1.5s
      state.events.push("death");
      break;
    }
  }
}

// --- Level Clear ---
function checkLevelClear(state: GameState): void {
  if (state.pelletsLeft <= 0 && state.phase === "playing") {
    state.phase = "levelClear";
    state.levelIntroTicks = READY_TICKS; // ~2.5s "READY!" freeze (nice break between levels)
    state.events.push("levelClear");
  }
}

// --- Scatter/Chase Timer ---
function updateScatterChase(state: GameState): void {
  state.scatterTicks--;
  if (state.scatterTicks <= 0) {
    // Toggle mode
    const allScatter = state.ghosts.every(
      (g) => g.mode === "scatter" || g.mode === "inHouse"
    );
    const newMode: GhostMode = allScatter ? "chase" : "scatter";
    for (const g of state.ghosts) {
      if (g.mode === "chase" || g.mode === "scatter") {
        g.mode = newMode;
        g.dir = OPPOSITE[g.dir]; // forced reversal on mode switch
      }
    }
    // Set next timer
    const cycle = Math.floor(state.tickCount / 100); // approximate cycle counter
    if (allScatter) {
      // Just entered chase
      state.scatterTicks =
        cycle === 0 ? CHASE_FIRST :
        cycle === 1 ? CHASE_2ND :
        cycle === 2 ? CHASE_3RD :
        CHASE_3RD; // permanent chase after 3rd
    } else {
      // Just entered scatter
      state.scatterTicks =
        cycle === 0 ? SCATTER_2ND :
        cycle === 1 ? SCATTER_3RD :
        SCATTER_4TH;
    }
  }
}

// --- Frightened Timer ---
function updateFrightened(state: GameState): void {
  if (!state.frightActive) return;
  state.frightTicks--;
  if (state.frightTicks <= 0) {
    state.frightActive = false;
    for (const g of state.ghosts) {
      if (g.mode === "frightened") {
        g.mode = "chase"; // or scatter based on global state
      }
    }
  }
}

// --- Main Step ---
export function step(state: GameState, grid: Cell[][]): void {
  // Level intro
  if (state.phase === "levelIntro") {
    state.levelIntroTicks--;
    if (state.levelIntroTicks <= 0) {
      state.phase = "playing";
    }
    return;
  }

  // Score popup countdown (ghost eaten → score display, game keeps moving).
  // No phase change — the game stays in "playing". We just count down the
  // popup timer and clear it. The eaten ghost is already in "eyes" mode and
  // will be moved by the normal ghost update loop below.
  if (state.frightFreezeGhost !== null) {
    state.deathTicks--;
    if (state.deathTicks <= 0) {
      state.frightFreezeGhost = null;
      state.frightFreezeScore = 0;
    }
  }

  // Dying (Pac-Man hit by ghost → death animation + life loss)
  if (state.phase === "dying") {
    // Freeze positions: set prevPos = pos so the render lerp has no distance
    // to interpolate across (prevents the backward-forward-backward glitch).
    state.pacPrev = { ...state.pac };
    for (const g of state.ghosts) {
      g.prevPos = { ...g.pos };
    }
    state.deathTicks--;
    if (state.deathTicks <= 0) {
      state.lives--;
      if (state.lives <= 0) {
        // Freeze positions: set prevPos = pos so the render lerp has no distance
        // to interpolate across (prevents the forward-back glitch on game over).
        state.pacPrev = { ...state.pac };
        for (const g of state.ghosts) {
          g.prevPos = { ...g.pos };
        }
        state.phase = "gameOver";
      } else {
        // Reset positions
        state.pac = { ...PAC_START };
        state.pacPrev = { ...PAC_START };
        state.pacDir = "left";
        state.pacQueuedDir = null;
        for (let i = 0; i < state.ghosts.length; i++) {
          state.ghosts[i].pos = { ...GHOST_STARTS[i] };
          state.ghosts[i].prevPos = { ...GHOST_STARTS[i] };
          state.ghosts[i].dir = "left";
          state.ghosts[i].mode = i === 0 ? "chase" : "inHouse";
          state.ghosts[i].frightTicks = 0;
        }
        state.frightActive = false;
        state.frightTicks = 0;
        state.ghostChain = 0;
        state.fruit = null;
        state.fruitTicks = 0;
        for (let i = 0; i < state.ghosts.length; i++) {
          state.ghosts[i].houseTicks = 0;
        }
        state.phase = "levelIntro";
        state.levelIntroTicks = READY_TICKS;
      }
    }
    return;
  }

  // Level clear → next level
  if (state.phase === "levelClear") {
    // Freeze positions: set prevPos = pos so the render lerp has no distance
    // to interpolate across (prevents the forward-back glitch during levelClear).
    state.pacPrev = { ...state.pac };
    for (const g of state.ghosts) {
      g.prevPos = { ...g.pos };
    }
    state.levelIntroTicks--;
    if (state.levelIntroTicks <= 0) {
      // Next level: same score, lives, but new maze state
      const newLevel = state.level + 1;
      const oldScore = state.score;
      const oldLives = state.lives;
      Object.assign(state, createGame(newLevel));
      state.score = oldScore;
      state.lives = oldLives;
      // pelletsLeft is already correct from createGame() (new maze's total)
      state.phase = "levelIntro";
      state.levelIntroTicks = READY_TICKS; // "READY!" freeze for the new level
    }
    return;
  }

  if (state.phase !== "playing") return;

  state.tickCount++;

  // Update timers
  updateScatterChase(state);
  updateFrightened(state);
  updateFruit(state);

  // Move entities
  movePac(state, grid);
  for (const g of state.ghosts) {
    moveGhost(state, grid, g);
  }

  // Eating
  eatAt(state, grid);
  eatFruit(state);

  // Collisions
  checkCollisions(state);

  // Level clear
  checkLevelClear(state);

  // Ghost house exit — dot-counter based (Level 1 authentic).
  // Dots eaten = total pellets - pellets remaining.
  const dotsEaten = countPellets().total - state.pelletsLeft;
  for (const g of state.ghosts) {
    if (g.mode === "inHouse") {
      g.houseTicks = dotsEaten;
      if (dotsEaten >= HOUSE_EXIT_DOTS[g.id]) {
        g.mode = "exiting";
      }
    }
  }
}

// --- Convenience ---
export function createGrid(): Cell[][] {
  return parseMaze();
}
