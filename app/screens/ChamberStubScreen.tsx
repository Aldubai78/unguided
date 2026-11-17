// ChamberStubScreen — Phase 2 stub destination for the "🚀 Chamber" button.
//
// This is NOT the room. Phase 2 only proves the *entry ritual* (tap -> ping ->
// password -> reauth -> navigate here) is correct BEFORE the room exists. The
// real room (landing -> persona -> chat) is Phase 3, which swaps this screen's
// CONTENT without touching the route (the route name is reused).
//
// The header (AppHeader) is always present, so there's always a way out — and
// the "🚀 Chamber" button is right there if you want to re-enter.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../src/theme";
import { useAuth } from "../src/AuthContext";

export default function ChamberStubScreen() {
  const { user } = useAuth();
  const name = user?.display_name || user?.username || "Member";

  return (
    <View style={styles.root}>
      <View style={styles.card} testID="chamber-stub-card">
        <Text style={styles.emoji}>🚀</Text>
        <Text style={styles.title}>Chamber of Chaos</Text>
        <Text style={styles.subtitle}>stub — the live room lands in Phase 3</Text>

        <View style={styles.divider} />

        <Text style={styles.note}>
          This is the door, not the room. The ritual that got you here —
          tap → ping the server → re-enter your password → a fresh chamber
          token — is exactly what Phase 3 will hand to the live socket.
        </Text>

        <View style={styles.divider} />

        {/* Proof of the token exchange (the bridge to Phase 3's socket auth). */}
        <Text style={styles.status}>✓ signed in as {name}</Text>
        <Text style={styles.status}>✓ chamber token minted</Text>

        <View style={styles.divider} />

        <Text style={styles.footer}>
          Phase 3: landing → choose persona → live chat (persona-only, no
          history). The header above is always here, so you can always get out.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    backgroundColor: colors.cardRaised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: "center",
  },
  emoji: { fontSize: 40, marginBottom: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.accentSoft, fontSize: 14, fontWeight: "600", marginTop: 4 },
  divider: { width: "100%", height: 1, backgroundColor: colors.border, marginVertical: 18 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  status: { color: colors.success, fontSize: 13, fontWeight: "600", lineHeight: 22 },
  footer: { color: colors.faint, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
