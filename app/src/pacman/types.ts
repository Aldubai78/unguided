// Pac-Man shared types.
import type { Cell } from "./maze";

export type Direction = "up" | "down" | "left" | "right";

export interface Position {
  col: number;
  row: number;
}

export type GhostMode = "chase" | "scatter" | "frightened" | "eyes" | "inHouse" | "exiting";

export interface Ghost {
  id: number; // 0=Blinky, 1=Pinky, 2=Inky, 3=Clyde
  name: string;
  color: string; // body color
  pos: Position;
  prevPos: Position; // for crossing-collision detection
  dir: Direction;
  mode: GhostMode;
  // frightened timer (ticks remaining)
  frightTicks: number;
  // dot counter for house exit (Level 1 authentic: Inky@30, Clyde@60)
  houseTicks: number;
}

export type GamePhase = "levelIntro" | "playing" | "paused" | "dying" | "gameOver" | "levelClear";

export interface GameState {
  phase: GamePhase;
  level: number;
  score: number;
  lives: number;
  pelletsLeft: number;
  // Pac-Man
  pac: Position;
  pacPrev: Position;
  pacDir: Direction;
  pacQueuedDir: Direction | null;
  pacMouthOpen: boolean; // for animation
  // Ghosts
  ghosts: Ghost[];
  // Frightened mode (global, triggered by power pellet)
  frightActive: boolean;
  frightTicks: number; // ticks remaining for frightened mode
  // Score chain (resets per power pellet)
  ghostChain: number; // 0=next is 200, 1=400, 2=800, 3=1600
  // Frightened freeze (ghost eaten → 1s freeze with score display)
  frightFreezeGhost: number | null;
  frightFreezeScore: number;
  // Fruit
  fruit: Position | null;
  fruitTicks: number; // ticks remaining for fruit to disappear
  fruitSpawned: number; // 0=none yet, 1=first (70 dots), 2=second (170 dots)
  // Bonus life (arcade tradition: 10,000 pts; then again at double)
  extraLifeAt: number; // next bonus threshold (10000, then 20000, ...)
  bonusFlash: number; // increments on each extra life (UI popup trigger)
  // Timers
  tickCount: number; // total ticks elapsed (for scatter/chase timing)
  levelIntroTicks: number; // ticks remaining for "LEVEL n" display
  deathTicks: number; // ticks remaining for death animation
  // Scatter/chase phase
  scatterTicks: number; // ticks remaining in scatter mode
  // Tunnel wrap
  tunnelWrapping: boolean; // pac is in the tunnel this tick
  // Events (drained by the UI each tick for audio — engine stays renderer-agnostic)
  events: GameEvent[];
}

export type GameEvent =
  | "dot"
  | "power"
  | "eatGhost"
  | "death"
  | "levelClear"
  | "fruit"
  | "extraLife";
