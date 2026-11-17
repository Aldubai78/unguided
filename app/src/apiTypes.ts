// App server contract — the shapes the /app/* endpoints return (Phase 2.0).
// These mirror douglabs_sandbox/gymforge/sync_routes.py + authz.py exactly.
// Keep in sync with the server; a shape drift = a broken sync.

/** Public user as returned by /app/signin and /app/me (authz._public_user). */
export interface User {
  id: number;
  username: string;
  role: "member" | "coach" | "admin";
  member_id: number | null;
  display_name?: string | null;
  /** Present only on /app/signin when the server flags a forced change. */
  password_needs_change?: boolean;
}

/** Member profile as returned by /app/pull (members table, public columns). */
export interface MemberProfile {
  id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  tier: string | null;
}

/** A workout log row (workout_logs). `details` is the JSON array of sets. */
export interface WorkoutLog {
  id?: number;
  member_id: number;
  entry_id?: string | null;
  wod_id?: string | null;
  completed_at: string;
  details: unknown[];
  notes?: string | null;
  total_score: number;
}

/** A PR row (prs). Weight and time_value are mutually exclusive by lift type. */
export interface Pr {
  id?: number;
  member_id: number;
  lift: string;
  weight: number | null;
  time_value: number | null;
  achieved_at: string;
  entry_id?: string | null;
}

/** Response of POST /app/signin (authz.login). */
export interface SigninResult {
  token: string;
  user: User;
}

/** Response of GET /app/pull — the full dataset for the signed-in member. */
export interface PullResult {
  member: MemberProfile | null;
  logs: WorkoutLog[];
  prs: Pr[];
  game_scores: Record<string, number | string>;
  pulled_at: string;
}

/** Body for POST /app/sync — the app's COMPLETE dataset (full-adopt). */
export interface SyncPayload {
  logs: WorkoutLog[];
  prs: Pr[];
  game_scores: Record<string, number | string>;
}

/** Response of POST /app/sync (what was adopted vs. replaced). */
export interface SyncResult {
  logs: number;
  prs: number;
  replaced: { logs: number; prs: number };
  game_scores: number;
  synced_at: string;
}

// --- Snake WWT10 Leaderboard (SNAKE-WWT10.md, 2026-10-30) ---

export type SnakeDifficulty = "rx" | "scaled";

/** One row in the leaderboard response. */
export interface SnakeScoreEntry {
  rank: number;
  name: string;
  score: number;
}

/** Response of GET+POST /app/leaderboard/snake. */
export interface LeaderboardResult {
  leaderboard: SnakeScoreEntry[];
  my_rank: number | null;
  my_score: number;
}

/** Body for POST /app/leaderboard/snake. */
export interface SubmitScorePayload {
  diff: SnakeDifficulty;
  score: number;
}

/** Pac-Man score submit — single board, no difficulty. (W6) */
export interface PacmanScorePayload {
  score: number;
}

// ---------------------------------------------------------------------------
// Chamber of Chaos — lobby state (Phase 3, W3).
// Mirrors the server's _chamber_state_payload() in chamber.py.
// ---------------------------------------------------------------------------

/** A persona as seen in the lobby (occupant or available). */
export interface ChamberPersona {
  persona: string;
  color: string;
  emoji: string;
  is_bot?: boolean;
}

/** The lobby state snapshot (GET /api/chamber/state). */
export interface ChamberState {
  active: boolean;
  count: number;
  occupants: ChamberPersona[];
  available: ChamberPersona[];
}

/** Doug's status (GET /api/chamber/doug/status). */
export interface DougStatus {
  running: boolean;
  pid: number | null;
  persona: string | null;
  reason: string | null;
  llm_available: boolean;
  llm_reason: string | null;
}
