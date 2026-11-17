// Web-only shim for expo-secure-store.
//
// On web the real package ships an EMPTY stub (export default {}), so calling
// SecureStore.getItemAsync would crash. This module provides the same API
// backed by localStorage — enough for the token/identity store in dev.
//
// This is NOT a security boundary: browsers have no keystore. On Android/iOS
// the REAL expo-secure-store (EncryptedSharedPreferences / Keychain) is used.
// We only use this shim on the web dev target.

const PREFIX = "opengym.secure.";

// Keychain-style constant (unused on web, kept for API parity).
export const AFTER_FIRST_UNLOCK = "ACCESSIBLE_AFTER_FIRST_UNLOCK";
export const ALWAYS = "ACCESSIBLE_ALWAYS";
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = "ACCESSIBLE_AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY";

type Options = { keychainAccessible?: string };

function safeGet(key: string): string | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* no-op in web dev */
  }
}

function safeDel(key: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* no-op in web dev */
  }
}

export function getItemAsync(key: string): Promise<string | null> {
  return Promise.resolve(safeGet(key));
}

export function setItemAsync(key: string, value: string, _options?: Options): Promise<void> {
  safeSet(key, value);
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  safeDel(key);
  return Promise.resolve();
}

export function getKeysAsync(): Promise<string[]> {
  try {
    if (typeof window === "undefined" || !window.localStorage) return Promise.resolve([]);
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return Promise.resolve(out);
  } catch {
    return Promise.resolve([]);
  }
}

export default {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  getKeysAsync,
  AFTER_FIRST_UNLOCK,
  ALWAYS,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
