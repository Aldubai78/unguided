// Auth context (Phase 2.1 S6).
//
// The App owns the signedIn state and renders SignIn vs. Profile based on it
// (reference pattern: screens call signIn/signOut; the App re-flows). On sign-in
// we: authenticate -> store token -> AUTO-PULL (phone starts from the server's
// backup) -> loadFromPull into the local store. Per the locked model the phone
// is the source of truth after this; the auto-pull just seeds the on-device copy.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { config } from "../config/app-config";
import { AppApi } from "./api";
import type { User } from "./apiTypes";
import { localStore, counts as storeCounts, latestLogs } from "./localStore";
import { getBoundMemberId } from "./pacmanProgress";
import { tokenStore, hasSeenUser, markSeenUser } from "./tokenStore";
import { setFirstSignInPinned, bindMember } from "./pacmanProgress";
import { credStore } from "./credStore";
import { clearMember as clearLeaderboardCache } from "./leaderboardCache";
import { isNetworkFailure, ApiError } from "./api";

/**
 * Remap a dead-session 401 to an actionable message. When an online call
 * (pull/sync) fails with 401, the cached server token is stale/expired —
 * the user can't fix that from this button, but they CAN tap Register (the
 * one server path that mints a fresh token). So instead of "invalid
 * session" we tell them exactly what to do.
 */
function relinkMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.status === 401) {
    return "Server session expired — tap Register to re-link, then try again.";
  }
  if (isNetworkFailure(e)) return "Server not available.";
  return e instanceof Error ? e.message : fallback;
}
import type { WorkoutLog } from "./apiTypes";

export interface AuthState {
  signedIn: boolean;
  /** True while a sign-in / sign-out / restore-in-flight transition is running. */
  busy: boolean;
  user: User | null;
  /** Live on-device dataset counts (S5 localStore). */
  counts: { logs: number; prs: number };
  /** Latest on-device workout logs (most-recent-first) — OpenGym landing Last-10 (S2). */
  lastSessions: WorkoutLog[];
  /** Last sign-in error message (cleared on a fresh attempt). */
  error: string | null;
  /**
   * LOCAL sign-in (100% offline-capable, NEVER touches the server). Checks the
   * username+password against the on-device credential vault (salted PBKDF2
   * hash). On success restores the cached session + token. On unknown username
   * or wrong password returns false with "incorrect username or password".
   * The user must have been registered on this device first (via register).
   */
  signIn: (username: string, password: string) => Promise<boolean>;
  /**
   * REGISTER — the ONLY server path, and ALWAYS server-first (locked spec).
   * There is no local shortcut, even for a user already on the device:
   *   1. Verify username+password against the SERVER (the one network call).
   *      - server unreachable  -> false, "server not available".
   *      - server 401/403      -> false, "incorrect username or password".
   *   2. On success, rewrite the local credential (hash only, no data change).
   *   3. Data policy:
   *      - NEW to device      -> FIRST-EVER pull (seed the dataset).
   *      - KNOWN on device    -> NO pull (restore-password path; the on-device
   *        data is the source of truth and is never displaced).
   *   4. Sign in.
   *   This is what makes Register the password-RESTORE flow: after a
   *   server-side reset the local hash is stale, so only the server can
   *   validate the new password; Register rewrites the local hash so the next
   *   (100% local) Sign-in works.
   */
  register: (username: string, password: string) => Promise<boolean>;
  /**
   * Re-establish the server session (the "server login"). Used only when an
   * online Backup/Restore 401s because the cached token expired. The UI asks
   * for the password in-line, calls this to mint + persist a fresh token, then
   * retries the action. Distinct from register: NO data pull (the on-device
   * data is the source of truth) — it only re-links the credential/token.
   */
  reauth: (username: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Re-read on-device counts (call after a sync so the UI refreshes). */
  refreshCounts: () => void;
  /** Re-read on-device Last-10 (call after logging a workout, S3). */
  refreshSessions: () => void;
  /**
   * S7 action status line (Backup / Restore / Check-for-updates).
   * `null` = nothing to show. Auto-clears after ~4s. Green on ok, red on err.
   */
  status: { kind: "ok" | "err"; text: string } | null;
  /** Set the status line directly (e.g. change-password validation errors). */
  setStatus: (s: { kind: "ok" | "err"; text: string } | null) => void;
  /** The API client (for direct endpoint calls like change-password). */
  api: AppApi;
  /** Incremented on backup/restore/delete to notify WWT10Overlay to re-read cache. */
  dataVersion: number;
  /** S7: push — send the COMPLETE on-device dataset; server full-adopts it.
   *  Returns the success message (e.g. "Backed up N logs · N PRs to server")
   *  for the caller's confirmation modal, or null when it failed (error
   *  already surfaced as a status line). */
  backup: () => Promise<string | null>;
  /** S7: pull — replace the on-device dataset with the server's copy.
   *  Returns the success message or null on failure (see backup). */
  restore: () => Promise<string | null>;
  /**
   * Delete ALL on-device data (every user). DOUBLE-GUARDED at the UI layer
   * (two-step confirm in ProfileScreen); this method is the single destructive
   * action and the only code path that wipes the device. Full-adopt: the
   * device becomes empty; a later first-ever sign-in or Restore re-seeds it.
   */
  deleteData: () => Promise<string | null>;
  /** S7: stub — no update channel yet (honest placeholder). */
  checkUpdates: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ logs: 0, prs: 0 });
  const [lastSessions, setLastSessions] = useState<WorkoutLog[]>([]);
  const refreshSessions = useCallback(() => setLastSessions(latestLogs(10)), []);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const statusTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incremented on backup/restore/delete to notify WWT10Overlay to re-read cache.
  const [dataVersion, setDataVersion] = useState(0);

  const api = useMemo(() => new AppApi(config.serverUrl), []);
  const refreshCounts = useCallback(() => setCounts(storeCounts()), []);

  /** Show a status line; auto-clears after `ms`. */
  const flashStatus = useCallback((kind: "ok" | "err", text: string, ms = 4000) => {
    setStatus({ kind, text });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), ms);
  }, []);
  React.useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    [],
  );

  // On mount: if a token is cached, restore the session (no re-auth). We do NOT
  // re-pull here — the on-device dataset (localStorage) already holds the source
  // of truth from the last session. The user re-pulls via "Restore data" (S7).
  useEffect(() => {
    (async () => {
      const t = await tokenStore.getToken();
      if (!t) return;
      const u = await tokenStore.getCachedUser();
      if (u) {
        // CRITICAL: restore the token on the api client so backup/restore/pull
        // send X-Gym-Token. Without this a reload restores the *view* (user +
        // counts) but every /app call 401s ("gym login required").
        api.token = t;
        // CRITICAL: bind the member so all member-scoped localStorage keys
        // (snake bests, Pac-Man progress, saved games) resolve to the right
        // user instead of "anon". Without this a cold reboot reads 0 for
        // every per-member key even though the user is signed in.
        if (u.member_id != null) bindMember(u.member_id);
        setUser(u);
        setCounts(storeCounts());
        refreshSessions();
      }
    })();
  }, [api]);

  // ---- internal: commit a successful sign-in (user, token) into the app ----
  // Used by BOTH the local sign-in (register, known user) and the register
  // (adopt + first-ever pull). No pull happens here — callers decide.
  const commitSignIn = useCallback(
    async (userIn: User, token: string) => {
      await tokenStore.setSession(token, userIn);
      api.token = token;
      if (userIn.member_id != null) {
        const first = !(await hasSeenUser(userIn.member_id));
        if (first) setFirstSignInPinned(true);
        await markSeenUser(userIn.member_id);
        // bindMember is called by the caller BEFORE any pull so that
        // loadFromPull writes member-scoped keys to the right member.
        // It is safe to call twice (idempotent), but the caller must
        // ensure it happens before the pull, not here.
      }
      setUser(userIn);
      setCounts(storeCounts());
      refreshSessions();
    },
    [api, refreshSessions],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        // LOCAL ONLY — never touches the server. Check the typed password
        // against this device's credential vault (salted PBKDF2 hash).
        const cred = await credStore.verifyLocal(username, password);
        if (!cred) {
          throw new Error("incorrect username or password");
        }
        const userIn: User = {
          id: 0,
          username: cred.username,
          role: "member",
          member_id: cred.member_id,
          display_name: cred.display_name ?? cred.username,
        };

        // 100% LOCAL: the local verify above is the whole gate. Restore the
        // cached token exactly as stored — NO server call at sign-in. A stale or
        // expired cached token is NOT a sign-in problem; it's handled at the point
        // of the first ONLINE action (Backup/Restore) via reauth(), which mints a
        // fresh token. That keeps sign-in genuinely offline-capable.
        if (userIn.member_id != null) bindMember(userIn.member_id);
        await commitSignIn(userIn, cred.token);
        setBusy(false);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "sign-in failed");
        setBusy(false);
        return false;
      }
    },
    [commitSignIn],
  );

  const register = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      setError(null);
      try {
        // REGISTER is ALWAYS server-first (locked spec). There is NO local
        // shortcut here, even for a user already on the device — this is what
        // makes Register the RESTORE-PASSWORD path: after a server-side
        // password reset the local hash is stale, so only the server can
        // validate the new password.
        const knownOnDevice = await credStore.hasCredential(username);

        // 1. Verify credentials against the server (the one network call).
        let res;
        try {
          res = await api.signin(username, password);
        } catch (e) {
          // Server unreachable -> distinct "server not available" message
          // (Register cannot work offline; there are no local-only identities).
          if (isNetworkFailure(e)) {
            throw new Error("server not available");
          }
          // Server 401/403 = wrong credentials (or unknown user). No leak.
          throw new Error("incorrect username or password");
        }
        if (!res || !res.token || !res.user) {
          throw new Error("server returned no session — try again");
        }

        // 2. Persist the (possibly new) credential. saveCredential rewrites the
        //    record in place (salted PBKDF2 hash — no plaintext); it does NOT
        //    touch the on-device dataset, so this never displaces data.
        await credStore.saveCredential(res.user, res.token, password);

        // 3. Data policy:
        //    - NEW to device -> FIRST-EVER pull (seed the dataset).
        //    - KNOWN on device -> NO pull. The on-device data is the source of
        //      truth and a re-register is a credential event, not a data event.
        if (!knownOnDevice) {
          // Bind the member BEFORE the pull so loadFromPull can write
          // member-scoped egg state to the correct localStorage keys.
          if (res.user.member_id != null) bindMember(res.user.member_id);
          try {
            const pull = await api.pull();
            localStore.loadFromPull(pull);
          } catch {
            // best-effort seed: sign-in still succeeds; "Restore data" later.
          }
        }

        await commitSignIn(res.user, res.token);
        setBusy(false);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "register failed");
        setBusy(false);
        return false;
      }
    },
    [api, commitSignIn],
  );

  // RE-AUTH (the server login). Called from the Backup/Restore flow ONLY when
  // a live online call 401s because the cached token expired. The user has
  // already tapped into the action; we ask for their password in-line and use
  // it to mint a FRESH token (api.signin) + persist it (saveCredential, in
  // place — no data change). This is the one legitimate "send credentials to
  // the server" path outside first-time register, and it only fires because
  // the server session is genuinely dead. Returns true on success.
  const reauth = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      try {
        const res = await api.signin(username, password);
        if (!res || !res.token || !res.user) {
          throw new Error("server returned no session — try again");
        }
        await credStore.saveCredential(res.user, res.token, password);
        if (res.user.member_id != null) bindMember(res.user.member_id);
        await commitSignIn(res.user, res.token);
        setBusy(false);
        return true;
      } catch (e) {
        setBusy(false);
        if (isNetworkFailure(e)) {
          throw new Error("server not available");
        }
        throw new Error("incorrect username or password");
      }
    },
    [api, commitSignIn],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await api.revoke().catch(() => {}); // best-effort server-side revoke
    } finally {
      await tokenStore.clearSession();
      // MULTI-USER, PER-DEVICE: do NOT wipe the on-device dataset on sign-out.
      // The user's data is the source of truth and must SURVIVE sign-out so a
      // re-sign-in finds it already on-device (no pull). Multiple users can
      // each have their data on the same device; a manual "Delete data"
      // (Profile, double-guarded) or a fresh first-ever sign-in is the only way
      // to clear it. Clearing the view (below) is cosmetic only.
      // NOTE: Leaderboard caches (unguided.wwt10.<mid>.* ) are member-scoped
      // and also survive sign-out — they are the on-device snapshot for offline
      // display. WWT10Overlay re-reads them on sign-in via the dataVersion
      // effect, so no explicit load is needed here.
      bindMember(null);
      setUser(null);
      setCounts({ logs: 0, prs: 0 });
      setLastSessions([]);
      setError(null);
      setBusy(false);
    }
  }, [api]);

  // S7: push — the COMPLETE on-device dataset replaces the server copy.
  const backup = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      // S6.6 Data Vision: no pre-flight. Boards are FROZEN SNAPSHOTs, refreshed
      // ONLY by the explicit "Update" button (which fetches + caches). Backup just
      // snapshots whatever the device currently holds — the 10 game_scores keys
      // from toSyncPayload(). (Old pre-flight re-fetched boards here; removed in W4.)
      const payload = localStore.toSyncPayload();
      const res = await api.sync(payload);
      refreshCounts();
      refreshSessions();
      setDataVersion((v) => v + 1);
      const msg = `Backed up ${res.logs} logs · ${res.prs} PRs to server`;
      flashStatus("ok", msg);
      return msg;
    } catch (e) {
      // A 401 = dead cached token. Re-throw it so the UI can flip the
      // confirm dialog into a password re-entry (reauth) and retry. Other
      // errors surface as a status line. (finally below always clears busy.)
      if (e instanceof ApiError && e.status === 401) throw e;
      flashStatus("err", relinkMessage(e, "backup failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, refreshCounts, refreshSessions, flashStatus]);

  // S7: pull — the server's copy replaces the on-device dataset.
  const restore = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      const pull = await api.pull();
      localStore.loadFromPull(pull);
      refreshCounts();
      refreshSessions();
      setDataVersion((v) => v + 1);
      const msg = `Restored ${pull.logs.length} logs · ${pull.prs.length} PRs from server`;
      flashStatus("ok", msg);
      return msg;
    } catch (e) {
      // A 401 = dead cached token. Re-throw it so the UI can flip the
      // confirm dialog into a password re-entry (reauth) and retry.
      // (finally below always clears busy.)
      if (e instanceof ApiError && e.status === 401) throw e;
      flashStatus("err", relinkMessage(e, "restore failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [api, refreshCounts, refreshSessions, flashStatus]);

  // S7: stub — no update channel yet. Honest placeholder so the button is live.
  const checkUpdates = useCallback(async () => {
    flashStatus("ok", "No update channel yet (stub)");
  }, [flashStatus]);

  // Delete ALL on-device data (every user). The UI double-guards this
  // (ProfileScreen two-step confirm); this is the single destructive action.
  const deleteData = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      const mid = getBoundMemberId();
      if (mid == null) {
        flashStatus("err", "no user bound");
        return null;
      }
      // Wipe only the CURRENT user's data (logs, PRs, localStorage keys,
      // leaderboard caches). Other users on this device are untouched.
      localStore.wipeForUser(mid);
      localStore.wipeMemberKeys(mid);
      clearLeaderboardCache(mid);
      refreshCounts();
      refreshSessions();
      setDataVersion((v) => v + 1);
      const msg = `All on-device data deleted for ${user?.display_name ?? "this user"}`;
      flashStatus("ok", msg);
      return msg;
    } catch (e) {
      flashStatus("err", e instanceof Error ? e.message : "delete failed");
      return null;
    } finally {
      setBusy(false);
    }
  }, [refreshCounts, refreshSessions, flashStatus, user]);

  const value = useMemo<AuthState>(
    () => ({
      signedIn: user !== null,
      busy,
      user,
      counts,
      lastSessions,
      error,
      signIn,
      register,
      reauth,
      signOut,
      deleteData,
      refreshCounts,
      refreshSessions,
      status,
      setStatus,
      api,
      dataVersion,
      backup,
      restore,
      checkUpdates,
    }),
    [user, busy, counts, lastSessions, error, signIn, register, reauth, signOut, deleteData, refreshCounts, refreshSessions, status, setStatus, api, dataVersion, backup, restore, checkUpdates],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
