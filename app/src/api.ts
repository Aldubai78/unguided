// App API client — fetch layer for the 5 /app/* endpoints against :8002.
// S4 scope: transport + typed methods. The token is held here (S6 adds the
// persistence/auth flow on top; S5 adds the local store the sync methods feed).
//
// Contract source: douglabs_sandbox/gymforge/sync_routes.py.
//   POST /app/signin  {username,password}  -> {token,user}
//   GET  /app/me      (X-Gym-Token)        -> user
//   GET  /app/pull    (X-Gym-Token)        -> {member,logs,prs,pulled_at}
//   POST /app/sync    (X-Gym-Token) {logs,prs} -> {logs,prs,replaced,synced_at}
//   POST /app/revoke  (X-Gym-Token)        -> {ok}
import { config } from "../config/app-config";
import { tokenStore } from "./tokenStore";
import type {
  SigninResult,
  PullResult,
  SyncPayload,
  SyncResult,
  User,
  LeaderboardResult,
  SubmitScorePayload,
  PacmanScorePayload,
  SnakeDifficulty,
} from "./apiTypes";

export class ApiError extends Error {
  status: number;
  detail: string;
  /**
   * True when the request never got a real HTTP response back — a network
   * failure (connection refused, offline, CORS block, DNS), NOT an auth or
   * server error. signIn() uses this to decide whether to fall back to the
   * local credential vault (offline sign-in). An ApiError with status 401/403
   * is a real server response and must NOT trigger the offline fallback.
   */
  networkFailure: boolean;
  constructor(status: number, detail: string, networkFailure = false) {
    super(status === 0 ? detail : `API ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.networkFailure = networkFailure;
  }
}

/**
 * True if `e` is a transport-level failure (the fetch never completed). A raw
 * TypeError/"Failed to fetch"/"NetworkError" from fetch means the network is
 * down — that's the only case where offline sign-in is appropriate. A real
 * HTTP error (401, 404, 500) is NOT a network failure.
 */
export function isNetworkFailure(e: unknown): boolean {
  if (e instanceof ApiError) return e.networkFailure;
  if (e instanceof TypeError) return true; // fetch rejects with TypeError on network error
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("unreachable")
  );
}

export class AppApi {
  /** Session token from /app/signin; sent as X-Gym-Token on every call. */
  token: string | null = null;

  /** Public POST helper (for change-password and other non-/app/* endpoints). */
  async post<T>(path: string, body: unknown): Promise<{ res: Response; data: T }> {
    const { res, data } = await this.doFetch("POST", path, body);
    return { res, data: data as T };
  }

  constructor(private base: string = config.serverUrl) {}

  /** Point the client at a different server at runtime (no rebuild). */
  setServerUrl(url: string): void {
    this.base = url.replace(/\/+$/, "");
  }

  get serverUrl(): string {
    return this.base;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.token) h["X-Gym-Token"] = this.token;
    return h;
  }

  private async doFetch(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ res: Response; data: unknown }> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // The fetch itself failed (no response at all) -> network failure.
      // Re-throw as an ApiError with status 0 + networkFailure so callers can
      // distinguish "no server" from "server said no".
      throw new ApiError(0, "network error — server unreachable", true, );
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* 204 / empty body */
    }
    return { res, data };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const first = await this.doFetch(method, path, body);
    if (first.res.ok) return first.data as T;

    // 401 recovery (2026-10-24): the sandbox server intermittently rejects a
    // *valid* token with 401 (stale/corrupted auth state — see
    // douglabs_sandbox/8002-CHANGES.md), and the client can also lose its
    // in-memory token across a delete/restore transition while the server
    // session is still alive. On any 401, re-hydrate the token from the
    // secure store and retry exactly once before surfacing the error. This
    // keeps the app usable across both the server flake and a stale client
    // token until the server-side root cause is fixed and folded into 8001.
    if (first.res.status === 401) {
      const stored = await tokenStore.getToken().catch(() => null);
      if (stored && stored !== this.token) {
        this.token = stored;
        const retry = await this.doFetch(method, path, body);
        if (retry.res.ok) return retry.data as T;
        const detail =
          (retry.data as { detail?: string })?.detail ??
          (retry.res.statusText || "error");
        throw new ApiError(retry.res.status, detail);
      }
      // stored token is null/empty or identical to what we already sent ->
      // nothing to re-hydrate; fall through to surface the original 401.
    }

    const detail =
      (first.data as { detail?: string })?.detail ??
      (first.res.statusText || "error");
    throw new ApiError(first.res.status, detail);
  }

  /**
   * Ping the Chamber of Chaos server (Phase 2, the in-app CoC button).
   *
   * A single, TOKENLESS `GET /api/chamber/state` probe with a hard 10s timeout
   * (locked). Used by the header's "🚀 Chamber" button to decide the entry
   * ritual: online -> re-enter password -> stub screen; offline -> toast + stay
   * put (no dimming, no polling — the app is offline-first).
   *
   * Deliberately NOT routed through `request()`/`doFetch()`: the ping fires
   * with no session token (the chamber is passphrase-gated server-side, and the
   * button must work before re-auth). A plain `fetch` + AbortController keeps it
   * dumb: returns `{online, reason}` so the caller toasts on the reason.
   */
  async pingChamber(
    timeoutMs = 10_000,
  ): Promise<{ online: boolean; reason: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}/api/chamber/state`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return { online: false, reason: `server responded ${res.status}` };
      }
      return { online: true, reason: "ok" };
    } catch (e) {
      if (ctrl.signal.aborted) {
        return { online: false, reason: "no response within 10s" };
      }
      return {
        online: false,
        reason: e instanceof Error ? e.message : "unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sign in. Stores the returned token on the client for subsequent calls. */
  async signin(username: string, password: string): Promise<SigninResult> {
    const r = await this.request<SigninResult>("POST", "/app/signin", {
      username,
      password,
    });
    // Defensive: the server should always return {token,user} on 200, but a
    // malformed/empty 200 (or a proxy eating the body) yields null/undefined.
    // Throw a clean ApiError here so the caller shows a message instead of
    // crashing on a null .token/.user deref (the "reading 'token'" error).
    if (!r || !r.token || !r.user) {
      throw new ApiError(
        0,
        "unexpected sign-in response (server returned no token/user)",
      );
    }
    this.token = r.token;
    return r;
  }

  /** Current user from the session. Throws 401 if token is missing/stale. */
  async me(): Promise<User> {
    return this.request<User>("GET", "/app/me");
  }

  /** Pull the full dataset (auto-run after a successful signin). */
  async pull(): Promise<PullResult> {
    return this.request<PullResult>("GET", "/app/pull");
  }

  /** Full-adopt: the app's COMPLETE dataset replaces the server's copy. */
  async sync(payload: SyncPayload): Promise<SyncResult> {
    return this.request<SyncResult>("POST", "/app/sync", payload);
  }

  /** Revoke this session on the server, then clear the local token. */
  async revoke(): Promise<{ ok: boolean }> {
    const r = await this.request<{ ok: boolean }>("POST", "/app/revoke");
    this.token = null;
    return r;
  }

  /** Top 10 Snake scores for a difficulty + the caller's rank. */
  async getLeaderboard(diff: SnakeDifficulty): Promise<LeaderboardResult> {
    return this.request<LeaderboardResult>(
      "GET",
      `/app/leaderboard/snake?diff=${diff}`,
    );
  }

  /** Submit (or update) a Snake score. Returns the new ranking. */
  async submitScore(payload: SubmitScorePayload): Promise<LeaderboardResult> {
    return this.request<LeaderboardResult>("POST", "/app/leaderboard/snake", payload);
  }

  /** Top 10 Pac-Man scores (single board) + the caller's rank. (W6) */
  async getLeaderboardPacman(): Promise<LeaderboardResult> {
    return this.request<LeaderboardResult>("GET", "/app/leaderboard/pacman");
  }

  /** Submit (or update) a Pac-Man score. Returns the new ranking. (W6) */
  async submitPacmanScore(payload: PacmanScorePayload): Promise<LeaderboardResult> {
    return this.request<LeaderboardResult>("POST", "/app/leaderboard/pacman", payload);
  }
}

/** Module-level singleton the app code imports. */
export const api = new AppApi();
export default api;
