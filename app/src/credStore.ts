// Device credential vault (offline-first sign-in, Phase 3.0 S7, Model B).
//
// The device keeps a LOCAL record of every user that has been registered on it:
//   { username, member_id, display_name, token, passHash, cached_at }
// `passHash` is a SALTED PBKDF2-HMAC-SHA256 hash of the user's password
// (authLocal.ts). NO plaintext is ever stored.
//
// Sign-in is 100% LOCAL: verifyLocal() checks the typed password against
// passHash and, on success, restores the cached token. It NEVER calls the
// server. Register is the ONLY server path (verifies creds against 8002 and
// does the first-ever pull, then stores the credential here).
//
// Model B (locked): NO local-only identities. A user must be registered against
// the server first (register), so they exist there. This vault is a cache of
// server-known credentials for offline sign-in, not a way to create a user.
//
// Backed by SecureStore (same layer as the session token) so it survives
// sign-out and app restarts. Keyed by username (case-insensitive).
import SecureStore from "./secureStore";
import { hashPassword, verifyPassword } from "./authLocal";
import type { User } from "./apiTypes";

const CRED_KEY = "unguided.creds";

export interface CredRecord {
  username: string;
  member_id: number | null;
  display_name: string | null;
  /** Last server-issued session token (for offline restore). */
  token: string;
  /** Salted PBKDF2-HMAC-SHA256 hash of the user's password (offline verify). */
  passHash: string;
  /** ISO timestamp the record was last refreshed (register or online refresh). */
  cached_at: string;
}

type Vault = Record<string, CredRecord>;

async function readVault(): Promise<Vault> {
  try {
    const raw = await SecureStore.getItemAsync(CRED_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Vault) : {};
  } catch {
    return {};
  }
}

async function writeVault(v: Vault): Promise<void> {
  await SecureStore.setItemAsync(CRED_KEY, JSON.stringify(v));
}

function norm(u: string): string {
  return u.trim().toLowerCase();
}

/**
 * Store (or refresh) a credential after a successful REGISTER (server-verified).
 * The password is hashed locally and never stored in plaintext.
 */
export async function saveCredential(
  user: User,
  token: string,
  password: string,
): Promise<void> {
  const key = norm(user.username);
  if (!key) return;
  const v = await readVault();
  v[key] = {
    username: user.username,
    member_id: user.member_id ?? null,
    display_name: user.display_name ?? user.username,
    token,
    passHash: hashPassword(password),
    cached_at: new Date().toISOString(),
  };
  await writeVault(v);
}

/** Look up a cached credential by username. */
export async function getCredential(username: string): Promise<CredRecord | null> {
  const v = await readVault();
  return v[norm(username)] ?? null;
}

/** True if this username has been registered on this device. */
export async function hasCredential(username: string): Promise<boolean> {
  return (await getCredential(username)) !== null;
}

/**
 * LOCAL sign-in check (the ONLY thing sign-in does). Verify the typed password
 * against the stored hash. Returns the cached credential on success (so the
 * caller can restore the session), or null on unknown username / wrong password
 * / not registered on this device. Never touches the network.
 */
export async function verifyLocal(
  username: string,
  password: string,
): Promise<CredRecord | null> {
  const cred = await getCredential(username);
  if (!cred) return null;
  const ok = verifyPassword(password, cred.passHash);
  return ok ? cred : null;
}

export const credStore = {
  saveCredential,
  getCredential,
  hasCredential,
  verifyLocal,
};
export default credStore;
