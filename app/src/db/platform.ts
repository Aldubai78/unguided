// Platform-conditional SQLite entry point.
//
// Web (browser dev loop) → the in-memory localStorage-backed shim
//   (shims/expo-sqlite.web.ts). The browser has no on-device SQLite, and we
//   do not want to drag the expo-sqlite wasm worker into the web bundle.
//
// Android / iOS → the real native expo-sqlite engine (SQLite file in the
//   app's data directory). Data survives app restarts, sign-out/sign-in,
//   and device reboots.
//
// localStore.ts imports openDatabaseSync from THIS file, not from the web
// shim directly, so the native build gets a real SQLite database.

import { Platform } from "react-native";
import { openDatabaseSync as openNative } from "expo-sqlite";
import { openDatabaseSync as openWeb } from "../../shims/expo-sqlite.web";

export const openDatabaseSync = Platform.OS === "web" ? openWeb : openNative;
