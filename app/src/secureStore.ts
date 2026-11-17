// Platform-aware SecureStore wrapper.
//
// - Native (Android/iOS): uses the real `expo-secure-store` package
//   (EncryptedSharedPreferences on Android, Keychain on iOS).
// - Web (Metro dev): falls back to the localStorage-backed shim.
//
// This is the ONLY module that should import expo-secure-store.
// All app code imports from here.
import { Platform } from "react-native";

type SecureStoreAPI = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: { keychainAccessible?: string }) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
  getKeysAsync?: () => Promise<string[]>;
  AFTER_FIRST_UNLOCK?: string;
  ALWAYS?: string;
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: string;
};

let api: SecureStoreAPI;

if (Platform.OS === "web") {
  // Web dev: localStorage-backed shim. The shim has a default export.
  // @ts-ignore
  const shim = require("../shims/expo-secure-store.web");
  api = (shim.default ?? shim) as SecureStoreAPI;
} else {
  // Native: real expo-secure-store (named exports).
  // @ts-ignore
  const real = require("expo-secure-store");
  api = (real.default ?? real) as SecureStoreAPI;
}

// Debug wrapper to trace key validation failures.
const wrapped: SecureStoreAPI = {
  getItemAsync: (key: string) => {
    console.log("[secureStore] getItemAsync key:", JSON.stringify(key), "type:", typeof key);
    return api.getItemAsync(key);
  },
  setItemAsync: (key: string, value: string, options?) => {
    console.log("[secureStore] setItemAsync key:", JSON.stringify(key), "type:", typeof key, "len:", key?.length);
    return api.setItemAsync(key, value, options);
  },
  deleteItemAsync: (key: string) => {
    console.log("[secureStore] deleteItemAsync key:", JSON.stringify(key));
    return api.deleteItemAsync(key);
  },
  getKeysAsync: api.getKeysAsync ? () => api.getKeysAsync!() : undefined,
  AFTER_FIRST_UNLOCK: api.AFTER_FIRST_UNLOCK,
  ALWAYS: api.ALWAYS,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: api.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export default wrapped;
export { wrapped as SecureStore };
