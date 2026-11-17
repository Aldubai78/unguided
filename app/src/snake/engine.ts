// Snake — game engine (Phase 3.0 S2.5).
//
// Renderer-AGNOSTIC by design: this module is the "brain." It models the board
// and returns PLAIN DATA (snake cells, food, score, state) each step. It never
// imports react, react-native, or any renderer. The screen is a dumb consumer
// that calls `step()`/`newGame()` and paints whatever comes back.
//
// WHY THIS SEAM: S2.5 ships with an SVG skin (web-verifiable). The "upgrade to
// canvas" (Phase 3.8 — Device) replaces ONLY the paint function in the screen;
// this engine is untouched. Keeping all logic here is what makes the canvas
// swap a ~40-line paint change, not a rewrite.
//
// AUTHENTICITY (Nokia 6110, 1998 — original "Snake"):
//   - Board: 20 (cols) × 15 (rows) = 300 cells. Snake is ~1/3 of a cell.
//   - Starts at 3 segments (head + 2 body).
//   - Snake I rules: SOLID WALLS — touching any edge = game over. (No wrap.)
//   - Eat food → grow by 1 segment. Max score 297 (300 - 3).
//   - Steering is LEFT / RIGHT turns only; the snake always advances forward
//     (the original Nokia control model — 2 buttons, not a 4-way D-pad).

/** Board dimensions (cells). */
export const COLS = 20;
export const ROWS = 15;
/** Starting snake length (head + body). */
export const START_LENGTH = 3;
/** Max possible score = total cells - starting length (can't eat itself away). */
export const MAX_SCORE = COLS * ROWS - START_LENGTH; // 297

/** A single board cell. */
export interface Cell {
  x: number;
  y: number;
}

/** Snake advances one of these per step. */
export type Dir = "up" | "down" | "left" | "right";

/** Terminal / in-game states the screen renders. */
export type GameState = "playing" | "paused" | "gameover";

/** A left-or-right turn request — the only input the game accepts. */
export type TurnInput = "left" | "right";

/**
 * A PAUSED game frozen for later resume (the "Continue" feature). Plain, JSON-
 * serializable data so the screen can persist it to the device store (localStorage
 * on web; the secure store on device, Phase 3.8) and revive it on the next mount.
 */
export interface PausedSnapshot {
  snake: Cell[];
  food: Cell;
  score: number;
  dir: Dir;
  /** When the game was paused — surfaced as "left at HH:MM" on the welcome box. */
  pausedAt: number; // epoch ms
}

/** Everything the screen needs to paint one frame. */
export interface EngineSnapshot {
  snake: Cell[]; // index 0 is the HEAD
  food: Cell;
  score: number;
  state: GameState;
  /** Current heading — exposed so the skin can, e.g., rotate the head. */
  dir: Dir;
  /**
   * Buffered turn from the turn queue (one tick's worth). Taps queue here
   * instead of mutating `dir` immediately, so two taps within one tick are
   * applied over two consecutive ticks (the second no longer overwrites the
   * first). null = nothing buffered. See applyTurn()/step().
   */
  pending: TurnInput | null;
}

const DIRS: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// Turn table: (currentDir, turnInput) → nextDir. Turning "left" while moving
// "left" is invalid (would reverse) → stay. Reversing 180° is impossible with
// only L/R turns, which is a bonus: no self-kill-via-reverse.
function turn(dir: Dir, input: TurnInput): Dir {
  const order: Dir[] = ["up", "right", "down", "left"]; // clockwise
  const i = order.indexOf(dir);
  const next = order[(i + (input === "right" ? 1 : -1) + order.length) % order.length];
  return next;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Pick a random empty cell for food (uniform over free cells). */
function spawnFood(snake: Cell[]): Cell {
  const occupied = new Set(snake.map((c) => c.y * COLS + c.x));
  const free: number[] = [];
  for (let i = 0; i < COLS * ROWS; i++) if (!occupied.has(i)) free.push(i);
  if (free.length === 0) return { x: -1, y: -1 }; // board full → win (score 297)
  const pick = free[Math.floor(Math.random() * free.length)];
  return { x: pick % COLS, y: Math.floor(pick / COLS) };
}

/**
 * Create a fresh game. The snake starts horizontal in the vertical middle,
 * moving RIGHT (the authentic opening), 3 segments long.
 */
export function newGame(): EngineSnapshot {
  const midY = Math.floor(ROWS / 2);
  const snake: Cell[] = [
    { x: 2, y: midY }, // head
    { x: 1, y: midY },
    { x: 0, y: midY },
  ];
  const food = spawnFood(snake);
  return { snake, food, score: 0, state: "playing", dir: "right", pending: null };
}

/**
 * Apply a turn to the CURRENT heading immediately (no motion). Exported so the
 * screen can register a steer the instant the button is pressed, rather than
 * queuing it for the next fixed-timestep tick — that one-tick latency is what
 * made wall dodges feel "too early". The turn table is relative (L/R vs facing),
 * so a 180° reverse is still impossible here (bonus: no self-kill via reverse).
 * No-op unless the snake is actively playing, so a stray tap while gated / during
 * the countdown / paused / game-over can't aim the snake for the next launch.
 */
export function applyTurn(state: EngineSnapshot, input: TurnInput): EngineSnapshot {
  if (state.state !== "playing") return state; // no steering while gated/countdown/paused/gameover

  // Buffer the tap rather than mutating dir immediately. The queue holds ONE
  // turn: the latest legal tap, so two taps within a single tick are applied
  // over two consecutive ticks instead of the second overwriting the first.
  const dirToApplyTo = state.pending ? turn(state.dir, state.pending) : state.dir;
  // A tap that would reverse the heading we're about to commit is a no-op.
  // (e.g. heading right, queue holds left [→ up], then a right tap would put
  // us back to right = no net change, so ignore it — keeps the earlier turn.)
  const wouldReverse = dirToApplyTo === state.dir && turn(dirToApplyTo, input) === oppositeOf(dirToApplyTo);
  if (wouldReverse) return state;
  state.pending = input;
  return state;
}

/** The heading opposite to `d` (a 180° turn) — used to reject reverse taps. */
function oppositeOf(d: Dir): Dir {
  const opp: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
  return opp[d];
}

/**
 * Advance the simulation by one step. PURE w.r.t. the input: the SAME engine
 * object is mutated in place (cheap, no per-frame allocation of the whole
 * board) and the snapshot is returned. The screen drives how often this is
 * called (fixed timestep) and whether it's allowed to (paused). Turns are now
 * applied up front via applyTurn(); pass input=null for pure motion.
 */
export function step(state: EngineSnapshot, input: TurnInput | null): EngineSnapshot {
  if (state.state === "paused") return state; // paused: no motion, no input
  if (state.state === "gameover") return state; // dead: frozen

  // Apply the turn (only while alive & moving). Turns are now buffered by
  // applyTurn() into state.pending and popped ONE per tick here — that is what
  // makes two same-tick taps resolve over two ticks. A direct `input` arg (e.g.
  // conformance fixtures) is still honoured for callers that bypass applyTurn().
  if (input) state.dir = turn(state.dir, input);
  else if (state.pending) {
    state.dir = turn(state.dir, state.pending);
    state.pending = null;
  }

  const head = state.snake[0];
  const d = DIRS[state.dir];
  const nextHead: Cell = { x: head.x + d.x, y: head.y + d.y };

  // Snake I: solid walls. Hitting any edge = game over.
  if (nextHead.x < 0 || nextHead.x >= COLS || nextHead.y < 0 || nextHead.y >= ROWS) {
    state.state = "gameover";
    return state;
  }

  const ateFood = sameCell(nextHead, state.food);

  // Self-collision: the head dies if it lands on its own body. (The tail cell
  // moves this same tick unless we're growing, so exclude it when not eating —
  // classic snake allows chasing your tail-tip.)
  const bodyToCheck = ateFood ? state.snake : state.snake.slice(0, -1);
  if (bodyToCheck.some((c) => sameCell(c, nextHead))) {
    state.state = "gameover";
    return state;
  }

  // Move: prepend the new head.
  state.snake.unshift(nextHead);
  if (ateFood) {
    state.score += 1;
    state.food = spawnFood(state.snake);
    // (tail NOT popped → grew by 1)
    if (state.score >= MAX_SCORE) state.state = "gameover"; // board full = win
  } else {
    state.snake.pop(); // move without growing
  }

  return state;
}

/** Toggle pause/resume (only meaningful while playing or paused). */
export function togglePause(state: EngineSnapshot): EngineSnapshot {
  if (state.state === "playing") state.state = "paused";
  else if (state.state === "paused") state.state = "playing";
  return state;
}

/** Reset to a fresh game (used by the game-over overlay's Restart). */
export function restart(state: EngineSnapshot): EngineSnapshot {
  const fresh = newGame();
  Object.assign(state, fresh);
  return state;
}

/**
 * Freeze a PAUSED game into a plain, serializable snapshot for the device store.
 * Only meaningful when state === "paused"; the screen guards that. Deep-copies the
 * cells so later mutation of the live game can't corrupt the saved copy.
 */
export function snapshot(state: EngineSnapshot): PausedSnapshot {
  return {
    snake: state.snake.map((c) => ({ x: c.x, y: c.y })),
    food: { x: state.food.x, y: state.food.y },
    score: state.score,
    dir: state.dir,
    pausedAt: Date.now(),
  };
}

/**
 * Revive a saved snapshot INTO the engine object, in the paused state. The board
 * is frozen; one box-tap (togglePause) drops it back into play. This is what
 * "Continue" calls.
 */
export function restoreInto(state: EngineSnapshot, snap: PausedSnapshot): EngineSnapshot {
  state.snake = snap.snake.map((c) => ({ x: c.x, y: c.y }));
  state.food = { x: snap.food.x, y: snap.food.y };
  state.score = snap.score;
  state.dir = snap.dir;
  state.state = "paused"; // revive frozen; the player taps the box to resume
  return state;
}
