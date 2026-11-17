// S6.3 — Pac-Man stub screen.
//
// Shown when the PAC-MAN pill is tapped (unlocked or test mode).
// "INSERT COIN" blinks for 5s, then "PAC-MAN COMING SOON".
// S6.4 replaces this with the real game.
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";

export default function PacManStub() {
  const [phase, setPhase] = useState<"coin" | "soon">("coin");
  const [visible, setVisible] = useState(true);

  // 5s of INSERT COIN, then flip to COMING SOON.
  useEffect(() => {
    const t = setTimeout(() => setPhase("soon"), 5000);
    return () => clearTimeout(t);
  }, []);

  // Blink: 1s on, 1s off (classic arcade).
  useEffect(() => {
    if (phase !== "coin") return;
    const id = setInterval(() => setVisible((v) => !v), 1000);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <View style={styles.root}>
      {phase === "coin" ? (
        visible ? (
          <Text style={styles.coin}>INSERT COIN</Text>
        ) : null
      ) : (
        <View style={styles.soonBox}>
          <Text style={styles.soonTitle}>🟡 PAC-MAN</Text>
          <Text style={styles.soonText}>COMING SOON</Text>
          <Text style={styles.soonSub}>The arcade is warming up...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  coin: {
    color: "#f5d442",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
  },
  soonBox: { alignItems: "center" },
  soonTitle: {
    color: "#f5d442",
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 12,
  },
  soonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 3,
    marginBottom: 8,
  },
  soonSub: {
    color: "#666",
    fontSize: 14,
  },
});
