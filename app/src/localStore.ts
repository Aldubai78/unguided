// Local store — the on-device dataset (Phase 2.1 S5).
//
// LOCKED MODEL (2026-10-23): the PHONE is the source of truth; the server is a
// backup. The store holds the member's COMPLETE dataset locally.
//   - `loadFromPull(p)`  : after /app/pull, replace the local dataset with it.
//   - `toSyncPayload()`  : the app's COMPLETE dataset — what /app/sync sends.
//   - `replace()`        : full-adopt, one direction. No merge, no cursor, no
//                          uuid, no soft-delete, no outbox. Deletions propagate
//                          for free: a record not in the dataset is not sent.
//
// This is deliberately NOT the reference archive's outbox/cursor layer — that
// model was superseded. We persist through the web shim's in-memory + localStorage
// store (shims/expo-sqlite.web.ts) so the dataset survives a browser refresh.
//
// NOTE: no uuid here. Rows are stored as their server shapes (apiTypes). The
// server assigns `id` on adopt; the app doesn't rely on it for identity.
import { Platform } from "react-native";
import { openDatabaseSync } from "./db/platform";
import { getBoundMemberId } from "./pacmanProgress";
import type {
  WorkoutLog,
  Pr,
  PullResult,
  SyncPayload,
} from "./apiTypes";

/**
 * The on-device dataset that `replace()` full-adopts. Deliberately NARROWER than
 * the network `SyncPayload`: the internal replace only touches the logs + prs
 * tables. `game_scores` (the S6.6 10-key per-member snapshot) is a localStorage
 * concern, handled separately by the caller (loadFromPull's W5 block) — the
 * network `SyncPayload` still carries it for /app/sync.
 */
export type DatasetPayload = Pick<SyncPayload, "logs" | "prs">;

/** Convenience: read the currently bound member_id (null when signed out). */
function _boundMemberId(): number | null {
  return getBoundMemberId();
}

const DB_NAME = "unguided.store";

// The shim keys rows by column name. We store the dataset under two tables
// (workout_logs, prs) so it round-trips through the shim's getAllSync listing
// and persists to localStorage for the web dev loop.
type Row = Record<string, unknown>;

const db = openDatabaseSync(DB_NAME);

// Native SQLite needs an explicit schema (the web shim pre-defines tables in
// its constructor, so web never hits this). Runs once per DB lifetime.
if (Platform.OS !== "web") {
  db.execSync(
    `CREATE TABLE IF NOT EXISTS workout_logs (
       id INTEGER PRIMARY KEY,
       member_id INTEGER NOT NULL,
       entry_id TEXT,
       wod_id TEXT,
       completed_at TEXT NOT NULL,
       details TEXT NOT NULL DEFAULT '[]',
       notes TEXT,
       total_score INTEGER NOT NULL DEFAULT 0
     );
     CREATE TABLE IF NOT EXISTS prs (
       id INTEGER PRIMARY KEY,
       member_id INTEGER NOT NULL,
       lift TEXT NOT NULL,
       weight REAL,
       time_value REAL,
       achieved_at TEXT NOT NULL,
       entry_id TEXT
     );`
  );
}

// Monotonic unique local id. Date.now() alone collides when many rows are
// inserted in the same millisecond (a full restore loop) — which breaks the
// PR delete-checkbox (duplicate pr.id). Combine a per-process counter so every
// id is unique even within a single burst.
let _idSeq = 0;
function uniqueId(): number {
  _idSeq += 1;
  return Date.now() * 1000 + (_idSeq % 1000);
}

/** Replace the entire local dataset with a pulled dataset (full-adopt). */
export function loadFromPull(p: PullResult): void {
  replace({ logs: p.logs, prs: p.prs });
  // S6.6 Data Vision (W5): restore the FULL 10-key per-member snapshot, uniformly.
  // NO guards: a 0 score or "" board is a VALID snapshot value and must be written
  // (a 0 means "reset to default", an "" board means "never fetched"). Omitting
  // them here is what broke the uniform model — a Restore that dropped 0/"" keys
  // left stale device values instead of overwriting with the server's truth.
  if (p.game_scores) {
    const mid = _boundMemberId();
    if (mid != null) {
      const put = (lsKey: string, v: number | string | null | undefined) => {
        if (v == null) return; // key absent on server → leave device value alone
        try { localStorage.setItem(lsKey, String(v)); } catch {}
      };
      // Numeric / flag / string keys (uniform: write whatever the server says).
      put(`unguided.snake.best.${mid}.rx`, p.game_scores["snake_rx"]);
      put(`unguided.snake.best.${mid}.scaled`, p.game_scores["snake_scaled"]);
      put(`unguided.pacman.best.${mid}`, p.game_scores["pacman_best"]);
      put(`unguided.pacman.progress.${mid}`, p.game_scores["egg_progress"]);
      put(`unguided.pacman.scaled.${mid}`, p.game_scores["egg_scaled"]);
      put(`unguided.pacman.arcadeSeen.${mid}`, p.game_scores["arcade_seen"]);
      put(`unguided.snake.diff.${mid}`, p.game_scores["snake_diff"]);
      // Leaderboard cache: frozen JSON snapshots ("" = never fetched → clear key).
      put(`unguided.wwt10.${mid}.snake.rx`, p.game_scores["wwt10_snake_rx"]);
      put(`unguided.wwt10.${mid}.snake.scaled`, p.game_scores["wwt10_snake_scaled"]);
      put(`unguided.wwt10.${mid}.pacman`, p.game_scores["wwt10_pacman"]);
    }
  }
}

/** Full-adopt: wipe both tables, then insert the app's complete dataset. */
export function replace(payload: DatasetPayload): void {
  wipe();
  for (const log of payload.logs) upsertLog(log);
  for (const pr of payload.prs) upsertPr(pr);
}

/** Wipe the local dataset (both tables). */
export function wipe(): void {
  db.runSync("DELETE FROM workout_logs");
  db.runSync("DELETE FROM prs");
}

/**
 * Wipe ALL localStorage keys for a specific member: scores, saved games,
 * difficulty, egg progress, arcade-seen, leaderboard caches.
 * Used by deleteData (member-scoped delete) and sign-out (if needed).
 */
export function wipeMemberKeys(memberId: number): void {
  const prefix = `unguided.`;
  const mid = String(memberId);
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      // Match the member ID as a path segment: ".<mid>." or ".<mid>"
      const rest = k.slice(prefix.length); // e.g. "snake.best.12.rx"
      const segments = rest.split(".");
      if (segments.includes(mid)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      localStorage.removeItem(k);
    }
  } catch {}
}

function upsertLog(log: WorkoutLog): void {
  // details is an array; the shim stores raw values, so JSON-encode it the same
  // way the server does (db.json_dumps) so it round-trips as a string.
  // Assign a local id so the row is selectable for delete (HistoryScreen
  // requires log.id != null to render its checkbox), same as upsertPr.
  // Server-restored logs carry no local id, so give them a guaranteed-unique one.
  const id = log.id != null ? Number(log.id) : uniqueId();
  db.runSync(
    "INSERT INTO workout_logs (id, member_id, entry_id, wod_id, completed_at, details, notes, total_score) VALUES (?,?,?,?,?,?,?,?)",
    [
      id,
      log.member_id,
      log.entry_id ?? null,
      log.wod_id ?? null,
      log.completed_at,
      JSON.stringify(log.details ?? []),
      log.notes ?? null,
      log.total_score ?? 0,
    ],
  );
}

function upsertPr(pr: Pr): void {
  // Assign a local id so the row is selectable for delete (PRsScreen requires
  // pr.id != null to render its checkbox). Server-restored PRs carry no local
  // id, so give them a guaranteed-unique one (uniqueId(), not raw Date.now()
  // which collides across a restore loop).
  const id = pr.id != null ? Number(pr.id) : uniqueId();
  db.runSync(
    "INSERT INTO prs (id, member_id, lift, weight, time_value, achieved_at, entry_id) VALUES (?,?,?,?,?,?,?)",
    [
      id,
      pr.member_id,
      pr.lift,
      pr.weight ?? null,
      pr.time_value ?? null,
      pr.achieved_at,
      pr.entry_id ?? null,
    ],
  );
}

/** Read the complete local dataset (what /app/sync full-adopts). */
/* Wipe only ONE user's data (multi-user device). Keeps other users' rows.
 *   (wipe() above wipes ALL users — used by the double-guarded "Delete data".) */
export function wipeForUser(memberId: number): void {
  db.runSync("DELETE FROM workout_logs WHERE member_id = ?", [memberId]);
  db.runSync("DELETE FROM prs WHERE member_id = ?", [memberId]);
}

export function toSyncPayload(): SyncPayload {
  const logsRaw = db.getAllSync<Row>("SELECT * FROM workout_logs");
  const prsRaw = db.getAllSync<Row>("SELECT * FROM prs");

  const logs: WorkoutLog[] = logsRaw.map((r) => ({
    member_id: Number(r.member_id),
    entry_id: (r.entry_id as string) ?? null,
    wod_id: (r.wod_id as string) ?? null,
    completed_at: r.completed_at as string,
    details: parseDetails(r.details),
    notes: (r.notes as string) ?? null,
    total_score: Number(r.total_score ?? 0),
  }));

  const prs: Pr[] = prsRaw.map((r) => ({
    member_id: Number(r.member_id),
    lift: r.lift as string,
    weight: r.weight == null ? null : Number(r.weight),
    time_value: r.time_value == null ? null : Number(r.time_value),
    achieved_at: r.achieved_at as string,
    entry_id: (r.entry_id as string) ?? null,
  }));

  // S6.6 Data Vision (W5): emit the FULL 10-key per-member snapshot, uniformly.
  // NO >0 / non-empty guards: 0 scores, "false" flags, "rx" diff, and "" boards are
  // all VALID snapshot values the device must send so the server's backup matches
  // the device's truth exactly. (Old guards dropped them → a backup was a partial
  // snapshot → W3 had to upsert-preserve what the device omitted. Now the device
  // sends the complete 10, so the backup is the full snapshot.)
  const gs: Record<string, number | string> = {};
  try {
    const mid = _boundMemberId();
    if (mid != null) {
      const num = (lsKey: string) => parseInt(localStorage.getItem(lsKey) || "0", 10) || 0;
      const str = (lsKey: string, fallback: string) => localStorage.getItem(lsKey) ?? fallback;
      // Numeric scores.
      gs["snake_rx"] = num(`unguided.snake.best.${mid}.rx`);
      gs["snake_scaled"] = num(`unguided.snake.best.${mid}.scaled`);
      gs["pacman_best"] = num(`unguided.pacman.best.${mid}`);
      // Egg state.
      gs["egg_progress"] = num(`unguided.pacman.progress.${mid}`);
      gs["egg_scaled"] = num(`unguided.pacman.scaled.${mid}`);
      // Flags + diff (string keys, member-scoped).
      gs["arcade_seen"] = str(`unguided.pacman.arcadeSeen.${mid}`, "false");
      gs["snake_diff"] = str(`unguided.snake.diff.${mid}`, "rx");
      // Leaderboard cache: frozen JSON snapshots ("" = never fetched).
      gs["wwt10_snake_rx"] = str(`unguided.wwt10.${mid}.snake.rx`, "");
      gs["wwt10_snake_scaled"] = str(`unguided.wwt10.${mid}.snake.scaled`, "");
      gs["wwt10_pacman"] = str(`unguided.wwt10.${mid}.pacman`, "");
    }
  } catch {}

  return { logs, prs, game_scores: gs };
}

function parseDetails(raw: unknown): unknown[] {
  // The 8002 `/app/pull` path stores `details` as a JSON string, and some legacy
  // rows are DOUBLE-encoded: the column holds the string "[]" (or a JSON-encoded
  // array) wrapped in *another* JSON string, i.e. "[\"[]\"]". A single JSON.parse
  // on that yields the string "[]" (not an array), so we must keep decoding until
  // the value is no longer a string. Cap the loop at 5 to avoid any pathological
  // self-referencing input; a real `[{...}]` payload resolves in one pass.
  let v: unknown = raw;
  for (let i = 0; i < 5 && typeof v === "string"; i++) {
    const s = (v as string).trim();
    if (s === "") return [];
    try {
      v = JSON.parse(s);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

/**
 * List PRs for a member, most-recent-first (by achieved_at DESC).
 * S4 PRs screen (Phase 3.0). The shim has no WHERE on arbitrary tables,
 * so we read all and filter in JS (same pattern as toSyncPayload).
 */
export function listPrs(memberId: number): Pr[] {
  const raw = db.getAllSync<Row>("SELECT * FROM prs");
  const prs: Pr[] = raw
    .filter((r) => Number(r.member_id) === memberId)
    .map((r) => ({
      id: r.id != null ? Number(r.id) : undefined,
      member_id: Number(r.member_id),
      lift: r.lift as string,
      weight: r.weight == null ? null : Number(r.weight),
      time_value: r.time_value == null ? null : Number(r.time_value),
      achieved_at: r.achieved_at as string,
      entry_id: (r.entry_id as string) ?? null,
    }));
  prs.sort((a, b) => String(b.achieved_at).localeCompare(String(a.achieved_at)));
  return prs;
}

/**
 * Insert one PR (device is the source of truth — no server call).
 * S4 PRs screen. Assigns a local id (Date.now()) if not provided so the
 * row is selectable for delete. The server assigns its own id on adopt;
 * the app doesn't rely on id for identity (full-adopt model).
 */
export function insertPr(opts: {
  member_id: number;
  lift: string;
  weight: number | null;
  time_value: number | null;
  achieved_at: string;
  entry_id?: string | null;
}): void {
  db.runSync(
    "INSERT INTO prs (id, member_id, lift, weight, time_value, achieved_at, entry_id) VALUES (?,?,?,?,?,?,?)",
    [
      uniqueId(),
      opts.member_id,
      opts.lift,
      opts.weight ?? null,
      opts.time_value ?? null,
      opts.achieved_at,
      opts.entry_id ?? null,
    ],
  );
}

/**
 * Delete PRs by id for a member. Full-adopt pattern (the shim can't do
 * WHERE id IN (...) on arbitrary tables): read all, filter out the targets,
 * wipe, re-insert survivors. Same "deletions propagate for free" model as
 * the rest of the store.
 */
export function deletePrs(memberId: number, ids: number[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const raw = db.getAllSync<Row>("SELECT * FROM prs");
  const survivors = raw.filter(
    (r) => !(Number(r.member_id) === memberId && r.id != null && idSet.has(Number(r.id))),
  );
  // Wipe the prs table, re-insert survivors.
  db.runSync("DELETE FROM prs");
  for (const r of survivors) {
    db.runSync(
      "INSERT INTO prs (id, member_id, lift, weight, time_value, achieved_at, entry_id) VALUES (?,?,?,?,?,?,?)",
      [
        Number(r.id ?? 0),
        Number(r.member_id),
        String(r.lift ?? ""),
        r.weight != null ? Number(r.weight) : null,
        r.time_value != null ? Number(r.time_value) : null,
        String(r.achieved_at ?? ""),
        r.entry_id != null ? String(r.entry_id) : null,
      ],
    );
  }
}

/**
 * Full list of workout logs for a member, newest first (S5 History screen).
 * Unlike latestLogs(n) which slices to N, this returns every log so the screen
 * can search + render the whole history.
 */
export function listLogs(memberId: number): WorkoutLog[] {
  const raw = db.getAllSync<Row>("SELECT * FROM workout_logs");
  const logs: WorkoutLog[] = raw
    .filter((r) => Number(r.member_id) === memberId)
    .map((r) => ({
      id: r.id != null ? Number(r.id) : undefined,
      member_id: Number(r.member_id),
      entry_id: (r.entry_id as string) ?? null,
      wod_id: (r.wod_id as string) ?? null,
      completed_at: r.completed_at as string,
      details: parseDetails(r.details),
      notes: (r.notes as string) ?? null,
      total_score: r.total_score != null ? Number(r.total_score) : 0,
    }));
  logs.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return logs;
}

/**
 * Delete workout logs by id for a member (S5 History). Full-adopt pattern (the
 * shim can't do WHERE id IN (...)): read all, filter out the targets, wipe,
 * re-insert survivors. Same "deletions propagate for free" model as deletePrs.
 */
export function deleteLogs(memberId: number, ids: number[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const raw = db.getAllSync<Row>("SELECT * FROM workout_logs");
  const survivors = raw.filter(
    (r) => !(Number(r.member_id) === memberId && r.id != null && idSet.has(Number(r.id))),
  );
  db.runSync("DELETE FROM workout_logs");
  for (const r of survivors) {
    db.runSync(
      "INSERT INTO workout_logs (id, member_id, entry_id, wod_id, completed_at, details, notes, total_score) VALUES (?,?,?,?,?,?,?,?)",
      [
        Number(r.id ?? 0),
        Number(r.member_id),
        r.entry_id != null ? String(r.entry_id) : null,
        r.wod_id != null ? String(r.wod_id) : null,
        String(r.completed_at ?? ""),
        r.details != null ? JSON.stringify(r.details) : "[]",
        r.notes != null ? String(r.notes) : null,
        r.total_score != null ? Number(r.total_score) : 0,
      ],
    );
  }
}

/** Counts for UI display (e.g. Profile page: "484 logs · 22 PRs on device"). */
export function counts(): { logs: number; prs: number } {
  return {
    logs: db.getAllSync<Row>("SELECT * FROM workout_logs").length,
    prs: db.getAllSync<Row>("SELECT * FROM prs").length,
  };
}

/**
 * Latest N workout logs, most-recent-first (by completed_at, then id desc).
 * The OpenGym landing's "Last 10 sessions" card (Phase 3.0 S2).
 */
export function latestLogs(n = 10): WorkoutLog[] {
  const logs = toSyncPayload().logs;
  return [...logs]
    .sort((a, b) => {
      const t = String(b.completed_at).localeCompare(String(a.completed_at));
      return t !== 0 ? t : 0;
    })
    .slice(0, n);
}

/**
 * Insert one OpenGym "Enter Workout" log. Free-text note capture: the 3 strings
 * (lift / weight / note) are stored VERBATIM in `details` as a single-row array
 * (empty strings kept — any field may be empty). No totalization, no rounding, no
 * calculation — `total_score` is 0 (the OpenGym path never computes it). `notes`
 * mirrors the note string at the log level too (some display paths read it).
 */
export function insertLog(opts: {
  member_id: number;
  completed_at: string;
  lift: string;
  weight: string;
  note: string;
}): number {
  const { member_id, completed_at, lift, weight, note } = opts;
  const details = [{ lift, weight, note }];
  const id = uniqueId();
  db.runSync(
    "INSERT INTO workout_logs (id, member_id, entry_id, wod_id, completed_at, details, notes, total_score) VALUES (?,?,?,?,?,?,?,?)",
    [id, member_id, null, null, completed_at, JSON.stringify(details), note || null, 0],
  );
  // The web shim does not implement last_insert_rowid(); we assign a local id
  // ourselves (uniqueId()) and return it so the row is selectable for delete.
  return id;
}

export const localStore = {
  loadFromPull,
  replace,
  wipe,
  wipeForUser,
  wipeMemberKeys,
  toSyncPayload,
  counts,
  latestLogs,
  insertLog,
  upsertLog,
  listLogs,
  deleteLogs,
  listPrs,
  insertPr,
  deletePrs,
};
export default localStore;
