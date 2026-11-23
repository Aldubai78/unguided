// OpenGym — app configuration
// The server URL lives HERE, never hardcoded in app code.
// Change this file (not a rebuild) to point the app at a different server.

export interface AppConfig {
  /** Base URL of the Storm server (no trailing slash). */
  serverUrl: string;
  /** App version sent in the sync handshake (server rejects too-old clients). */
  appVersion: string;
  /** Schema version sent in the sync handshake. Bump when on-device tables change. */
  schemaVersion: number;
  /**
   * Storm chamber passphrase — dev-only seed for the SecureStore.
   *
   * This is the value the app uses to mint a gate token via POST /api/gate.
   * It matches the server's STORM_PASSPHRASE (in .env / .storm.env). For a
   * local single-user setup the passphrase is a dev secret; it is never sent
   * anywhere except the one POST /api/gate call, and it is cached in
   * SecureStore (not this file) after first seed.
   *
   * If null, the app falls back to a one-time password entry (FreakConfirm)
   * so it's never hard-bricked on a fresh install.
   *
   * ⚠️ NEVER commit a real passphrase to a public surface. For production,
   * set this to null and let the user enter it manually.
   */
  stormPassphrase: string | null;
}

// ---------------------------------------------------------------------------
// API server target — environment-aware.
//
// DEV (Metro / web / PC): derive from window.location. The browser calls the
// SAME HOST it loaded the app from, but on the API port (8001), NOT the Metro
// port (8091):
//
//   PC dev:  page http://localhost:8091      -> API http://localhost:8001
//   phone:   page http://192.168.1.122:8091  -> API http://192.168.1.122:8001
//
// RELEASE (APK / native): hardcoded Tailscale Funnel URL. The phone is often
// off the local WiFi (cellular, different network), so a LAN-derived URL
// would break. The funnel URL is stable and works anywhere the phone has
// internet access.
// ---------------------------------------------------------------------------
const API_PORT = 8001;
const RELEASE_SERVER_URL = "https://hofserver.tailcf3f27.ts.net:8443";

function resolveServerUrl(): string {
  // Explicit override wins everywhere (dev + release). Inlined at bundle time
  // by Expo (EXPO_PUBLIC_*), so it works on native dev (Expo Go) where there's
  // no window.location to derive from. Example:
  //   EXPO_PUBLIC_SERVER_URL=https://hofserver.tailcf3f27.ts.net:8443 npx expo start
  const envOverride = process.env.EXPO_PUBLIC_SERVER_URL;
  if (envOverride && envOverride.trim().length > 0) {
    return envOverride.trim().replace(/\/+$/, "");
  }
  // Release builds (APK, native) always use the funnel URL.
  if (!__DEV__) {
    return RELEASE_SERVER_URL;
  }
  // Dev builds: derive from the page origin (PC dev, phone-on-LAN via Metro).
  if (typeof window !== "undefined" && window.location && window.location.host) {
    const host = window.location.hostname; // strip :8091 from the page origin
    return `http://${host}:${API_PORT}`;
  }
  // Node / tsx gate context (no DOM origin).
  return `http://localhost:${API_PORT}`;
}

export const config: AppConfig = {
  serverUrl: resolveServerUrl(),
  appVersion: "0.1.0",
  schemaVersion: 1,
  // Dev seed — matches the server's STORM_PASSPHRASE. In a fresh install the
  // app writes this to SecureStore once, then never reads it from here again.
  // Set to null in production to force manual entry.
  stormPassphrase: "dougisapsychopath",
};

export default config;
