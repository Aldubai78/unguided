// Chamber gate token layer (Phase 3, W1).
//
// The chamber socket is gated by the Storm gate token, NOT the gym token.
// The app mints a gate token by exchanging the Storm passphrase (from
// SecureStore) via POST /api/gate. The token is cached in-memory for the
// lifetime of the server process; on server restart the token rotates, so
// a connect_error / 401 clears the cache and the next call re-mints.
//
// Passphrase delivery (W0): seeded from config.stormPassphrase into
// SecureStore on first run. After that, SecureStore is the source of
// truth (survives app restarts). If the seed is null and SecureStore is
// empty, the caller must prompt for manual entry (FreakConfirm fallback).
//
// No new deps — plain fetch, mirrors api.ts error style.

import { config } from "../config/app-config";
import SecureStore from "./secureStore";
import { ApiError, isNetworkFailure } from "./api";

const PASS_KEY = "unguided.storm_passphrase";

let cachedToken: string | null = null;
let mintInFlight: Promise<string> | null = null;

/**
 * Read the Storm passphrase from SecureStore. If absent, seed it from
 * config.stormPassphrase (dev-only). Returns null if both are empty —
 * the caller must prompt for manual entry.
 */
async function getPassphrase(): Promise<string | null> {
  let pp = await SecureStore.getItemAsync(PASS_KEY);
  if (!pp && config.stormPassphrase) {
    // First run: seed from config.
    await SecureStore.setItemAsync(PASS_KEY, config.stormPassphrase);
    pp = config.stormPassphrase;
  }
  return pp;
}

/**
 * Store a manually-entered passphrase (FreakConfirm fallback).
 * Call this when the config seed is null and the user types it in.
 */
export async function setPassphrase(passphrase: string): Promise<void> {
  await SecureStore.setItemAsync(PASS_KEY, passphrase);
  // Clear the cached token — the new passphrase may mint a different one.
  cachedToken = null;
}

/**
 * Clear the cached gate token. Call on connect_error / 401 so the next
 * getGateToken() re-mints (server restart rotated the token).
 */
export function clearGateToken(): void {
  cachedToken = null;
}

/**
 * Get a valid gate token. Returns the cached token if present; otherwise
 * mints one via POST /api/gate using the passphrase from SecureStore.
 *
 * Throws:
 *   - ApiError(0, "No storm passphrase stored", networkFailure=false)
 *     when SecureStore is empty and config.stormPassphrase is null.
 *   - ApiError(401, "wrong passphrase") when the server rejects.
 *   - ApiError(0, <detail>, networkFailure=true) on transport failure.
 *
 * Safe to call concurrently — the in-flight mint is deduplicated.
 */
export async function getGateToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  // Deduplicate concurrent mints.
  if (mintInFlight) return mintInFlight;

  mintInFlight = (async () => {
    try {
      const passphrase = await getPassphrase();
      if (!passphrase) {
        throw new ApiError(0, "No storm passphrase stored", false);
      }
      const base = config.serverUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/api/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.status === 401) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(401, body.detail || "wrong passphrase", false);
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body.detail || `gate mint failed (${res.status})`, false);
      }
      const data = await res.json();
      if (!data.ok || !data.token) {
        throw new ApiError(res.status, "gate mint returned no token", false);
      }
      cachedToken = data.token as string;
      return cachedToken;
    } finally {
      mintInFlight = null;
    }
  })();

  return mintInFlight;
}

/**
 * Mint a fresh gate token, bypassing the in-memory cache.
 * Use after a connect_error (server restart rotated the token).
 */
export async function mintGateToken(): Promise<string> {
  cachedToken = null;
  return getGateToken();
}

export const chamberGate = {
  getGateToken,
  mintGateToken,
  clearGateToken,
  setPassphrase,
};
export default chamberGate;
