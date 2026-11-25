/**
 * DebugPanel.tsx — Debug build only: floating panel showing the live server
 * URL + every fetch call (method, path, status, ms). Tap to toggle.
 *
 * Renders nothing in release builds (guarded by __DEV__).
 */
import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { config } from "../config/app-config";
import { getDebugEntries, subscribeDebug, clearDebug, DebugEntry } from "./debugLog";

export function DebugPanel(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<DebugEntry[]>(getDebugEntries());

  useEffect(() => {
    const unsub = subscribeDebug((e) => {
      if (e) setEntries([...getDebugEntries()]);
    });
    return unsub;
  }, []);

  if (!__DEV__) return null;

  return (
    <View style={styles.root}>
      <TouchableOpacity
        style={[styles.fab, open && styles.fabOpen]}
        onPress={() => {
          if (open) clearDebug();
          setOpen(!open);
        }}
        accessibilityLabel="Toggle debug panel"
      >
        <Text style={styles.fabText}>{open ? "✕" : "🐛"}</Text>
      </TouchableOpacity>

      {open && (
        <View style={styles.panel}>
          <Text style={styles.title}>DEBUG — server: {config.serverUrl}</Text>
          <Text style={styles.sub}>
            __DEV__={String(__DEV__)} · {entries.length} calls · tap ✕ to clear
          </Text>
          <FlatList
            style={styles.list}
            data={entries.slice().reverse()}
            keyExtractor={(item, i) => `${i}-${item.ts}`}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.ts}>{item.ts}</Text>
                <Text style={[styles.label, item.label.includes("err") && styles.errLabel]}>
                  {item.label}
                </Text>
                <Text style={styles.detail}>{item.detail}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>No calls yet. Try signing in.</Text>}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", bottom: 24, right: 16, zIndex: 9999 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#1a1a2e",
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  fabOpen: { backgroundColor: "#e94560" },
  fabText: { color: "#fff", fontSize: 22 },
  panel: {
    position: "absolute" as const,
    bottom: 80,
    right: 0,
    width: "92%" as const,
    maxHeight: "55%" as const,
    backgroundColor: "#0f0f1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
    padding: 12,
  },
  title: { color: "#4ecdc4", fontSize: 13, fontWeight: "600" as const, marginBottom: 2 },
  sub: { color: "#888", fontSize: 11, marginBottom: 8 },
  list: { flex: 1 },
  empty: { color: "#666", fontSize: 12, textAlign: "center" as const, paddingVertical: 16 },
  row: { flexDirection: "row" as const, alignItems: "flex-start" as const, marginBottom: 6 },
  ts: { color: "#666", fontSize: 10, width: 62, fontFamily: "monospace" as const },
  label: { color: "#f0c040", fontSize: 10, width: 70, fontFamily: "monospace" as const },
  errLabel: { color: "#e94560" },
  detail: { color: "#ccc", fontSize: 10, flex: 1, fontFamily: "monospace" as const },
});
