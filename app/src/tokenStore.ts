// Token + identity persistence (Phase 2.1 S6).
//
// Platform-split: Metro bundles this on all targets; it talks to the secure-store
// shim (shims/expo-secure-store.web.ts on web, real keystore on native). The
// token is the ONLY credential the app holds — member_id is derived on the server
// from the X-Gym-Token; the app never authoritatively stores it, it caches identity
// only so the UI can render a name without a round-trip.
import SecureStore from "./secureStore";
import type { User } from "./apiTypes";

const TOKEN_KEY = "unguided.gym_token";
const USER_KEY = "unguided.user";
// Multi-user, per-device: the set of member_ids that have EVER signed in on
// this device. Drives the "auto-pull exactly once, per user, per device" rule
// — a user whose id is in this set already has their data on-device, so a
// re-sign-in must NOT pull from the server. Persisted in SecureStore (JSON array).
const SEEN_KEY = "unguided.seen_users";

/** Read the stored X-Gym-Token, or null if signed out. */
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/** Store the token + cached user. Pass null to clear (sign out). */
export async function setSession(token: string | null, user: User | null): Promise<void> {
  if (token === null || user === null) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

/** Read the cached user (display only), or null if signed out. */
export async function getCachedUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** Clear session (sign out). */
/** True if this member has signed in on this device before (data is on-device). */
export async function hasSeenUser(memberId: number): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(memberId);
  } catch {
    return false;
  }
}

/** Record that this member has signed in on this device (first-ever seed). */
export async function markSeenUser(memberId: number): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SEEN_KEY);
    const arr: number[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) {
      // corrupt / unexpected shape — don't clobber it
      return;
    }
    if (!arr.includes(memberId)) {
      arr.push(memberId);
      await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(arr));
    }
  } catch {
    // best-effort; a failed mark just means we may re-pull once more next time
  }
}

export async function clearSession(): Promise<void> {
  await setSession(null, null);
}

export const tokenStore = {
  getToken,
  setSession,
  getCachedUser,
  clearSession,
  hasSeenUser,
  markSeenUser,
};
export default tokenStore;
