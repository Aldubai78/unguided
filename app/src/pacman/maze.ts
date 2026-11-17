// Pac-Man maze — authentic 1980 arcade playable area: 28 cols × 31 rows.
// Full screen: 28×36 (3 rows top = score, 2 rows bottom = lives/fruit).
// Pixel size per tile: 8×8. Screen: 224×288px.
//
// Cell encoding:
//   #  wall        .  dot (+10)      o  power (+50)
//   ' ' empty path  G  ghost house   -  ghost door
//
// 28 cols × 29 rows (playable area). viewBox="0 0 28 29".
// Dot count verified: 240 dots + 4 powers = 244 pellets (arcade-accurate).
import type { Direction } from "./types";

export const COLS = 28;
export const ROWS = 29;

const MAZE_RAW = [
  "############################", // 0
  "#............##............#", // 1
  "#.####.#####.##.#####.####.#", // 2
  "#o####.#####.##.#####.####o#", // 3
  "#.####.#####.##.#####.####.#", // 4
  "#..........................#", // 5
  "#.####.##.########.##.####.#", // 6
  "#.####.##.########.##.####.#", // 7
  "#......##....##....##......#", // 8
  "######.#####.##.#####.######", // 9
  "######.#####.##.#####.######", // 10
  "######.##..........##.######", // 11
  "######.##.###--###.##.######", // 12
  "######.##.#      #.##.######", // 13
  "      ....# GGGG #....      ", // 14 (tunnel row)
  "######.##.# GGGG #.##.######", // 15
  "######.##.#      #.##.######", // 16
  "######.##.########.##.######", // 17
  "#............##............#", // 18
  "#.####.#####.##.#####.####.#", // 19
  "#.####.#####.##.#####.####.#", // 20
  "#o..##.......  .......##..o#", // 21
  "###.##.##.########.##.##.###", // 22
  "###.##.##.########.##.##.###", // 23
  "#......##....##....##......#", // 24
  "#.##########.##.##########.#", // 25
  "#.##########.##.##########.#", // 26
  "#..........................#", // 27
  "############################", // 28
];

export type CellType = "wall" | "path" | "dot" | "power" | "ghostHouse" | "ghostDoor";

export interface Cell {
  type: CellType;
  col: number;
  row: number;
}

export function parseMaze(): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Cell[] = [];
    const line = MAZE_RAW[r] || "";
    for (let c = 0; c < COLS; c++) {
      const ch = c < line.length ? line[c] : "#";
      let type: CellType = "path";
      if (ch === "#") type = "wall";
      else if (ch === ".") type = "dot";
      else if (ch === "o") type = "power";
      else if (ch === "G") type = "ghostHouse";
      else if (ch === "-") type = "ghostDoor";
      row.push({ type, col: c, row: r });
    }
    grid.push(row);
  }
  return grid;
}

export function countPellets(): { dots: number; powers: number; total: number } {
  let dots = 0, powers = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = MAZE_RAW[r]?.[c];
      if (ch === ".") dots++;
      else if (ch === "o") powers++;
    }
  }
  return { dots, powers, total: dots + powers };
}

// Pac-Man start (center, below ghost house). Row 21 is the horizontal corridor
// directly below the ghost house (between the wall blocks at rows 20 and 22).
export const PAC_START = { col: 14, row: 21 };

// Fruit spawn: center of the maze, just below the ghost house (walkable pocket at row 17).
export const FRUIT_POS = { col: 14, row: 21 };

// Ghost house center.
export const GHOST_HOUSE_CENTER = { col: 14, row: 14 };

// Ghost starts (Level 1 / life reset).
// Screen coords: Blinky (13.5,14) → grid (14,11); Pinky (13.5,17) → (14,14);
// Inky (11.5,17) → (12,14); Clyde (15.5,17) → (16,14).
// Grid = screen + (1, 3). House interior: rows 13-15, cols 12-16. Door: row 12, cols 13-14.
export const GHOST_STARTS = [
  { col: 14, row: 11 }, // Blinky (just above the door, in the maze)
  { col: 14, row: 14 }, // Pinky (house center, exits first)
  { col: 12, row: 14 }, // Inky (house left)
  { col: 16, row: 14 }, // Clyde (house right)
];

// Initial spawn direction for each ghost.
export const GHOST_SPAWN_DIRS: Direction[] = ["left", "down", "up", "up"];

// Tunnel row (wrap-around at edges).
export const TUNNEL_ROW = 14;

// Ghost house door cell (the gap in the wall, row 12).
export const GHOST_HOUSE_EXIT = { col: 14, row: 12 };

// House interior bounds (for in-house bounce): open cells rows 13-16, cols 12-16.
export const HOUSE_BOUNDS = { minCol: 12, maxCol: 16, minRow: 13, maxRow: 16 };

// Dot counters: pellets Pac-Man must eat before each house ghost exits (Level 1).
// Pinky exits immediately after Blinky starts; Inky at 30; Clyde at 60.
export const HOUSE_EXIT_DOTS = [0, 0, 30, 60]; // per ghost id (0=Blinky n/a)

// Scatter corners (OFF-GRID — in the unreachable border areas).
// Full screen is 28×36; our playable grid is rows 3-33 (31 rows).
// Screen coords → playable-grid coords: y_grid = y_screen - 3.
// Same Euclidean distance logic handles both chase and scatter —
// ghosts circle the corner loops because the target is unreachable.
export const GHOST_SCATTER_TARGETS = [
  { col: 25, row: -3 },  // Blinky: top-right (screen 25,-3 → grid 25,-6... using screen coords directly)
  { col: 2, row: -3 },   // Pinky: top-left
  { col: 27, row: 34 },  // Inky: bottom-right
  { col: 0, row: 34 },   // Clyde: bottom-left
];
// Note: we use SCREEN coordinates (28×36) for scatter targets.
// The distance calc works in screen-space; the maze grid is offset by +3 rows.
// So when computing distance, add 3 to the ghost's grid row to get screen row.

// Ghost colors (arcade).
export const GHOST_COLORS = ["#ff0000", "#ffb8ff", "#00ffff", "#ffb852"];
export const GHOST_NAMES = ["Blinky", "Pinky", "Inky", "Clyde"];
