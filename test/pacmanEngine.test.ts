/**
 * pacmanEngine tests — Step 5: fruit timing, level scaling, extra life.
 * Pure engine, no DOM. Pac-Man is driven by BFS through the grid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  createGrid,
  step,
  applyInput,
  levelConfig,
  fruitPoints,
  FRUIT_DOTS_1,
  FRUIT_DOTS_2,
  FRUIT_LIFE_TICKS,
} from "../app/src/pacman/engine";
import { COLS, ROWS, FRUIT_POS, countPellets, type Cell } from "../app/src/pacman/maze";
import type { Direction, GameState } from "../app/src/pacman/types";

// --- Test helpers ---

function isWalkable(grid: Cell[][], col: number, row: number): boolean {
  if (row < 0 || row >= ROWS) return false;
  if (col < 0 || col >= COLS) return row === 14; // tunnel row
  const cell = grid[row][col];
  return cell.type !== "wall" && cell.type !== "ghostDoor";
}

const DIR_DELTA: Record<Direction, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

/** BFS a path of directions from `from` to `to` on the grid. */
function bfsPath(grid: Cell[][], from: { col: number; row: number }, to: { col: number; row: number }): Direction[] {
  const key = (c: number, r: number) => r * COLS + c;
  const prev = new Map<number, { c: number; r: number; d: Direction } | null>();
  prev.set(key(from.col, from.row), null);
  const q: { col: number; row: number }[] = [from];
  while (q.length > 0) {
    const cur = q.shift()!;
    if (cur.col === to.col && cur.row === to.row) break;
    for (const d of Object.keys(DIR_DELTA) as Direction[]) {
      const nc = cur.col + DIR_DELTA[d].dc;
      const nr = cur.row + DIR_DELTA[d].dr;
      if (!isWalkable(grid, nc, nr)) continue;
      if (prev.has(key(nc, nr))) continue;
      prev.set(key(nc, nr), { c: cur.col, r: cur.row, d });
      q.push({ col: nc, row: nr });
    }
  }
  // Reconstruct
  const path: Direction[] = [];
  let node: { c: number; r: number; d: Direction } | null | undefined = prev.get(key(to.col, to.row));
  while (node) {
    path.unshift(node.d);
    node = prev.get(key(node.c, node.r));
  }
  return path;
}

/**
 * Drive Pac-Man along `dirs` one tick per direction, then step `idleTicks`
 * extra ticks with no input. Waits out frightFreeze. Stops on dying/gameOver.
 */
function drive(state: GameState, grid: Cell[][], dirs: Direction[], idleTicks = 0): GameState {
  let i = 0;
  let guard = 0;
  while (guard++ < 20000) {
    if (state.phase === "dying" || state.phase === "gameOver") break;
    if (state.phase !== "playing") break;
    if (i < dirs.length) {
      applyInput(state, dirs[i++]);
    }
    step(state, grid);
  }
  for (let k = 0; k < idleTicks && state.phase === "playing"; k++) {
    step(state, grid);
  }
  return state;
}

/**
 * Walk Pac-Man until `pelletsLeft <= target` (or phase changes / bail out).
 * Greedy: repeatedly BFS to the nearest remaining pellet and drive the full path.
 */
function eatPellets(state: GameState, grid: Cell[][], target: number): GameState {
  let outer = 0;
  while (state.pelletsLeft > target && state.phase === "playing" && outer++ < 50) {
    // Find nearest pellet
    let best: { col: number; row: number; dist: number } | null = null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = grid[r][c];
        if (cell.type !== "dot" && cell.type !== "power") continue;
        const dist = Math.abs(c - state.pac.col) + Math.abs(r - state.pac.row);
        if (!best || dist < best.dist) best = { col: c, row: r, dist };
      }
    }
    if (!best) break;
    const path = bfsPath(grid, state.pac, { col: best.col, row: best.row });
    if (path.length === 0) break;
    // Drive the full path
    drive(state, grid, path);
    if (state.phase !== "playing") break;
  }
  return state;
}

// --- Tests ---

test("fruitPoints: arcade progression (100/300/500/700/1000/2000, capped)", () => {
  assert.equal(fruitPoints(1), 100);
  assert.equal(fruitPoints(2), 300);
  assert.equal(fruitPoints(3), 500);
  assert.equal(fruitPoints(4), 700);
  assert.equal(fruitPoints(5), 1000);
  assert.equal(fruitPoints(6), 2000);
  assert.equal(fruitPoints(10), 2000); // capped
});

test("levelConfig: level 2 is faster than level 1 (Pac + ghosts)", () => {
  const l1 = levelConfig(1);
  const l2 = levelConfig(2);
  assert.ok(l2.pacTickMs < l1.pacTickMs, `L2 pac (${l2.pacTickMs}) should be < L1 (${l1.pacTickMs})`);
  assert.ok(l2.ghostTickMs < l1.ghostTickMs, `L2 ghost (${l2.ghostTickMs}) should be < L1 (${l1.ghostTickMs})`);
  // Frightened duration should be <= L1
  assert.ok(l2.frightDuration <= l1.frightDuration);
});

test("levelConfig: speed floor (min 50% scale)", () => {
  const l100 = levelConfig(100);
  const l1 = levelConfig(1);
  assert.ok(l100.pacTickMs >= l1.pacTickMs * 0.5, "speed floor at 50%");
});

test("createGame: initial state is sane (READY! intro, fruit not spawned)", () => {
  const s = createGame(1);
  assert.equal(s.phase, "levelIntro");
  assert.ok(s.levelIntroTicks > 0, "levelIntroTicks must be set (was a bug: undefined)");
  assert.equal(s.fruit, null);
  assert.equal(s.fruitSpawned, 0);
  assert.equal(s.lives, 3);
  assert.equal(s.extraLifeAt, 10000);
  assert.equal(s.bonusFlash, 0);
  assert.ok(Array.isArray(s.events));
});

test("fruit: spawns at FRUIT_DOTS_1 (70) dots eaten", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  // Directly set pelletsLeft to simulate 70 dots eaten (total=270 → left=200)
  state.pelletsLeft = countPellets().total - FRUIT_DOTS_1;
  // Step one tick — updateFruit should spawn the fruit
  step(state, grid);
  assert.ok(state.fruit !== null, "fruit should be spawned");
  assert.equal(state.fruit!.col, FRUIT_POS.col);
  assert.equal(state.fruit!.row, FRUIT_POS.row);
  assert.equal(state.fruitSpawned, 1);
  assert.equal(state.fruitTicks, FRUIT_LIFE_TICKS);
});

test("fruit: second spawn at FRUIT_DOTS_2 (170) dots eaten", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  // Trigger first spawn (70 dots)
  state.pelletsLeft = countPellets().total - FRUIT_DOTS_1;
  step(state, grid);
  assert.equal(state.fruitSpawned, 1, "first fruit spawned");
  // Manually clear the first fruit (simulating despawn) to test the second spawn path
  state.fruit = null;
  state.fruitTicks = 0;
  // Now trigger second spawn (170 dots)
  state.pelletsLeft = countPellets().total - FRUIT_DOTS_2;
  step(state, grid);
  assert.equal(state.fruitSpawned, 2, "second fruit should be spawned");
  assert.ok(state.fruit !== null);
});

test("fruit: despawns after FRUIT_LIFE_TICKS ticks", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  // Spawn the fruit
  state.pelletsLeft = countPellets().total - FRUIT_DOTS_1;
  step(state, grid);
  assert.ok(state.fruit !== null, "fruit spawned");
  // Set fruitTicks to 1 so the next step despawns it
  state.fruitTicks = 1;
  step(state, grid);
  assert.equal(state.fruit, null, "fruit should have despawned");
});

test("fruit: eating it adds level-1 points (100) and clears it", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  // Spawn the fruit
  state.pelletsLeft = countPellets().total - FRUIT_DOTS_1;
  step(state, grid);
  assert.ok(state.fruit !== null);
  const scoreBefore = state.score;
  // Place pac one cell left of the fruit, facing right — the step moves pac
  // onto the fruit cell, triggering the eat check.
  state.pac = { col: FRUIT_POS.col - 1, row: FRUIT_POS.row };
  state.pacPrev = { ...state.pac };
  (state as any).pacDir = "right"; // face the fruit
  state.events = [];
  step(state, grid);
  assert.equal(state.fruit, null, "fruit should be eaten");
  assert.equal(state.score, scoreBefore + 100, `score should be +100 (was ${scoreBefore}, now ${state.score})`);
  assert.ok(state.events.includes("fruit"), "should emit fruit event");
});

test("extra life: awarded at 10,000 points, then again at 20,000", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  const livesBefore = state.lives;
  // Directly bump the score to just under the threshold
  state.score = 9999;
  // Eat one dot (+10) → crosses 10,000
  state.pac = { col: 14, row: 21 };
  // Find a dot near pac and eat it
  // (Simpler: just add 10 to score via a dot eat — but we can just step on a dot)
  // Walk right until we hit a dot
  let guard = 0;
  while (state.phase === "playing" && guard++ < 50 && state.score < 10000) {
    applyInput(state, "right");
    step(state, grid);
  }
  assert.ok(state.score >= 10000, `score crossed 10k (now ${state.score})`);
  assert.equal(state.lives, livesBefore + 1, "extra life awarded");
  assert.equal(state.bonusFlash, 1, "bonusFlash incremented");
  assert.equal(state.extraLifeAt, 20000, "next threshold is 20k");
});

test("events: engine emits dot events when pac eats dots", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  state.events = [];
  // Walk right a few ticks (row 21 has dots)
  for (let i = 0; i < 3 && state.phase === "playing"; i++) {
    applyInput(state, "right");
    step(state, grid);
  }
  assert.ok(state.events.some((e) => e === "dot"), `should have emitted dot event (got ${JSON.stringify(state.events)})`);
});

test("events: engine emits power event when pac eats a power pellet", () => {
  const state = createGame(1);
  const grid = createGrid();
  while (state.phase !== "playing") step(state, grid);
  // Find a power pellet
  let pPower: { col: number; row: number } | null = null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c].type === "power") {
        pPower = { col: c, row: r };
        break;
      }
    }
    if (pPower) break;
  }
  assert.ok(pPower, "power pellet exists");
  // Teleport pac onto it
  state.pac = { ...pPower! };
  state.pacPrev = { ...pPower! };
  state.events = [];
  step(state, grid);
  assert.ok(state.events.includes("power"), `should have emitted power event (got ${JSON.stringify(state.events)})`);
  assert.ok(state.frightActive, "fright mode should be active");
  assert.equal(state.score, 50, "power pellet = 50 pts");
});
