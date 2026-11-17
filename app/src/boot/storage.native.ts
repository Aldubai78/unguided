// Native-only: install expo-sqlite's SQLite-backed localStorage.
// Must be imported BEFORE any module that reads localStorage at load time.
import "expo-sqlite/localStorage/install";
