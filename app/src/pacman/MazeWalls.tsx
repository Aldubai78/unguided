import React, { useMemo } from 'react';
import Svg, { Path, G, Rect, Defs, Filter, FeGaussianBlur, FeMerge, FeMergeNode } from 'react-native-svg';

// ---- Tuning (all in grid units; 1 unit = 1 cell) ----------------------------
const WALL_COLOR = '#2121ff'; // arcade blue is ~#2121DE; #3333ff also works
const BG_COLOR = '#000';
const OUTER = 0.65; // width of the blue "blob" stroke (reduced to prevent wall-clipping)
const INNER = 0.40; // width of the black stroke laid on top
// Visible neon line thickness = (OUTER - INNER) / 2 = 0.125 units
// On a ~390px-wide phone, 1 unit ≈ 14px, so that's ~1.75px. Increase the gap for thicker lines.

type GridCell = { type: string };
type Grid = GridCell[][];

const isWall = (grid: Grid, r: number, c: number): boolean => grid[r]?.[c]?.type === 'wall';

/**
 * Builds ONE path string for all walls by connecting the centers of
 * neighbouring wall cells. No edge tracing or polygon merging needed.
 *
 * - Right/down neighbours become short line segments ("h1" / "v1").
 * - Solid 2x2 wall blocks get a filled square so thick walls have no hole
 *   in the middle.
 * - Isolated single wall cells get a tiny segment so the round cap draws a dot.
 */
export function buildWallPath(grid: Grid): string {
  let d = '';
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!isWall(grid, r, c)) continue;

      const x = c + 0.5; // cell center (cell c spans c..c+1)
      const y = r + 0.5;
      const right = isWall(grid, r, c + 1);
      const down = isWall(grid, r + 1, c);

      if (right) d += `M${x} ${y}h1`;
      if (down) d += `M${x} ${y}v1`;

      if (right && down && isWall(grid, r + 1, c + 1)) {
        d += `M${x} ${y}h1v1h-1Z`; // fill the inside of solid blocks
      }

      if (!right && !down && !isWall(grid, r, c - 1) && !isWall(grid, r - 1, c)) {
        d += `M${x} ${y}h0.001`; // lone wall cell
      }
    }
  }
  return d;
}

type MazeWallsProps = {
  grid: Grid;
  glow?: 'fake' | 'filter' | 'none';
};

/**
 * Static wall layer.
 * glow: 'fake'   -> layered translucent strokes (works on every react-native-svg version, cheapest)
 *       'filter' -> real Gaussian blur (needs a react-native-svg 15.x release with FeGaussianBlur/FeMerge)
 *       'none'
 */
export const MazeWalls = React.memo(function MazeWalls({ grid, glow = 'fake' }: MazeWallsProps) {
  const d = useMemo(() => buildWallPath(grid), [grid]);

  const common = {
    d,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <G filter={glow === 'filter' ? 'url(#neonGlow)' : undefined}>
      {glow === 'fake' && (
        <>
          <Path {...common} fill="none" stroke={WALL_COLOR} strokeOpacity={0.12} strokeWidth={OUTER + 0.35} />
          <Path {...common} fill="none" stroke={WALL_COLOR} strokeOpacity={0.25} strokeWidth={OUTER + 0.16} />
        </>
      )}

      {/* 1. Fat blue blob covering every wall region, rounded via caps/joins */}
      <Path {...common} fill={WALL_COLOR} stroke={WALL_COLOR} strokeWidth={OUTER} />

      {/* 2. Same shape, thinner, in black -> leaves only a blue outline */}
      <Path {...common} fill={BG_COLOR} stroke={BG_COLOR} strokeWidth={INNER} />
    </G>
  );
});
