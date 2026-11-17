/**
 * leaderboardCache.ts — local-first WWT10 leaderboard cache, per BOARD (not per member).
 *
 * The leaderboard is a server-wide list of all users. Caching it per-member
 * meant each user saw a stale/different snapshot. Now the cache is shared
 * across all users on the device; my_rank/my_score are derived at render time
 * by looking up the current member in the cached rows.
 *
 * Keys:
 *   unguided.wwt10.snake.rx      → JSON(LeaderboardResult)
 *   unguided.wwt10.snake.scaled  → JSON(LeaderboardResult)
 *   unguided.wwt10.pacman        → JSON(LeaderboardResult)
 */
import type { LeaderboardResult } from "./apiTypes";

export type BoardKey = "snake.rx" | "snake.scaled" | "pacman";

function cacheKey(board: BoardKey): string {
  return `unguided.wwt10.${board}`;
}

export function readCache(
  _memberId: number | null,
  board: BoardKey,
): LeaderboardResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(board));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.leaderboard)) {
      return parsed as LeaderboardResult;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCache(
  _memberId: number | null,
  board: BoardKey,
  result: LeaderboardResult,
): void {
  try {
    localStorage.setItem(cacheKey(board), JSON.stringify(result));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

/** Clear all leaderboard caches (used by deleteData / sign-out). */
export function clearMember(_memberId: number): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("unguided.wwt10.")) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
}
