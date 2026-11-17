// S6.3 — Pac-Man Easter Egg State Machine.
//
// 4-step hidden progression scattered across 4 screens. Complete all 4 →
// the PAC-MAN pill appears on Snake.
//
// Progress: 0 = not started, 1–4 = eggs collected.
// Scaled flag: paused at 30 on Scaled (egg counter appears at 0/4, but
// the real egg 1 requires an RX pause at 30).
//
// localStorage keys (member-scoped via bindMember()):
//   "unguided.pacman.progress.<memberId>"  → "0" | "1" | "2" | "3" | "4"
//   "unguided.pacman.scaled.<memberId>"    → "0" | "1"
//   "unguided.pacman.test"                 → "0" | "1" | "2" | "3" | "4"  (device-global test override)
//
// Test mode: set "unguided.pacman.test" to a progress value (0–4) to
// override the real progress. Read via getTestOverride(). Set to "0" to
// disable. This lets Allen jump to any egg state without replaying the
// snake/workout/PR/calculator flow. Device-global (not member-scoped) —
// it's a dev tool.

const TEST_KEY = "unguided.pacman.test";

// ── Member binding ──────────────────────────────────────────────────────────
// All egg state is member-scoped. bindMember() is called on sign-in with
// the member_id, and on sign-out with null. When null, all reads return
// defaults (0 / false) and all writes are no-ops.
let _memberId: number | null = null;

const OLD_PROGRESS_KEY = "unguided.pacman.progress";
const OLD_SCALED_KEY = "unguided.pacman.scaled";

/** Called by AuthContext on sign-in (member_id) and sign-out (null). */
export function bindMember(id: number | null): void {
  _memberId = id;
  if (id != null) migrateToMemberKeys(id);
}

/** One-time migration: copy old unscoped keys to member-scoped keys. */
function migrateToMemberKeys(mid: number): void {
  const newProgressKey = `unguided.pacman.progress.${mid}`;
  const newScaledKey = `unguided.pacman.scaled.${mid}`;
  try {
    if (!localStorage.getItem(newProgressKey)) {
      const old = localStorage.getItem(OLD_PROGRESS_KEY);
      if (old != null) {
        localStorage.setItem(newProgressKey, old);
        localStorage.removeItem(OLD_PROGRESS_KEY);
      }
    }
    if (!localStorage.getItem(newScaledKey)) {
      const old = localStorage.getItem(OLD_SCALED_KEY);
      if (old != null) {
        localStorage.setItem(newScaledKey, old);
        localStorage.removeItem(OLD_SCALED_KEY);
      }
    }
  } catch {
    /* storage unavailable — ignore */
  }
}

/** The currently bound member_id (null when signed out). */
export function getBoundMemberId(): number | null {
  return _memberId;
}

function progressKey(): string {
  return `unguided.pacman.progress.${_memberId}`;
}

function scaledKey(): string {
  return `unguided.pacman.scaled.${_memberId}`;
}

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Read member-scoped progress (0–4). Returns 0 when not signed in. */
function readProgress(): number {
  if (_memberId == null) return 0;
  const p = parseInt(read(progressKey(), "0"), 10);
  return isNaN(p) ? 0 : Math.max(0, Math.min(4, p));
}

/** Read member-scoped scaled flag. Returns false when not signed in. */
function readScaledFlag(): boolean {
  if (_memberId == null) return false;
  return read(scaledKey(), "0") === "1";
}

/** Write member-scoped progress. No-op when not signed in. */
function writeProgress(n: number): void {
  if (_memberId == null) return;
  write(progressKey(), String(Math.max(0, Math.min(4, n))));
}

/** Write member-scoped scaled flag. No-op when not signed in. */
function writeScaledFlag(v: boolean): void {
  if (_memberId == null) return;
  write(scaledKey(), v ? "1" : "0");
}

/** Current progress (0–4). Test override takes precedence. */
export function getProgress(): number {
  const test = read(TEST_KEY, "0");
  if (test !== "0") {
    const t = parseInt(test, 10);
    if (!isNaN(t) && t >= 0 && t <= 4) return t;
  }
  return readProgress();
}

/** Did the player pause at 30 on Scaled? (Triggers the 0/4 counter.) */
export function getScaledFlag(): boolean {
  return readScaledFlag();
}

/** Mark that a Scaled pause at 30 happened. Idempotent. */
export function setScaledFlag(): void {
  writeScaledFlag(true);
}

/**
 * Advance the egg counter from `from` to `from + 1`.
 * Only succeeds if the current real progress (ignoring test override)
 * is exactly `from`. Returns the new progress, or -1 if the guard failed.
 *
 * localStorage only — server persistence happens via the backup flow
 * (toSyncPayload → /app/sync). No server call here.
 */
export function advance(from: number): number {
  const real = readProgress();
  if (real !== from) return -1;
  const next = from + 1;
  writeProgress(next);
  return next;
}

/** Is the Pac-Man pill visible? (progress >= 4 OR test override >= 4) */
export function isUnlocked(): boolean {
  return getProgress() >= 4;
}

/**
 * Should the 🥚 counter appear in the AppHeader?
 * True when: scaled flag is set, OR progress > 0 (and not yet unlocked).
 * Hidden when: progress === 4 (unlocked, back to normal) or nothing happened.
 */
export function showEggIndicator(): boolean {
  const p = getProgress();
  return p > 0 || getScaledFlag();
}

/** Set the test override. Pass 0–4. Device-global (not member-scoped). */
export function setTestOverride(n: number): void {
  write(TEST_KEY, String(Math.max(0, Math.min(4, n))));
}

/** Reset all egg state (real + test) for the bound member. For testing. */
export function reset(): void {
  if (_memberId != null) {
    writeProgress(0);
    writeScaledFlag(false);
  }
  write(TEST_KEY, "0");
}

// ── Mantra pin signal ────────────────────────────────────────────────────────
// After returning from the Snake screen, OpenGymLanding should ALWAYS show
// the "pause at 30" mantra. This in-memory flag is set by SnakeScreen on
// focus and consumed (cleared) by OpenGymLanding on its next focus.
let _mantraPinned = false;
export function setMantraPinned(v: boolean): void {
  _mantraPinned = v;
}
/** Returns true exactly once, then clears. OpenGymLanding calls this on focus. */
export function consumeMantraPin(): boolean {
  const v = _mantraPinned;
  _mantraPinned = false;
  return v;
}

// ── First-sign-in mantra pin ──────────────────────────────────────────────────
// On the very first sign-in on this device, OpenGymLanding shows the
// "read the mantras" mantra instead of a random one.
let _firstSignInPinned = false;
export function setFirstSignInPinned(v: boolean): void {
  _firstSignInPinned = v;
}
/** Returns true exactly once, then clears. OpenGymLanding calls this on focus. */
export function consumeFirstSignInPin(): boolean {
  const v = _firstSignInPinned;
  _firstSignInPinned = false;
  return v;
}
