// EggToast — the easter-egg unlock popup.
//
// A single-button, colorful modal (no cancel). Used for the 🥚 Pac-Man
// easter-egg progression beats. Much lighter than FreakConfirm (no
// arm-and-shake, no two-tap) — just "here's your unlock, tap to continue."
//
// Usage:
//   const [egg, setEgg] = useState<EggToastHandle | null>(null);
//   <EggToast handle={setEgg} />
//   egg?.open({ title: "🥚 EASTER EGG", body: "1/4 unlocked!", okText: "🥚 Nice" });
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, Animated, StyleSheet } from "react-native";
import { soundOneUp, soundStageClear } from "../src/audio/sounds";

export interface EggToastHandle {
  open: (opts: {
    title?: string;
    body: string;
    emoji?: string;
    okText?: string;
    color?: string;
    /** Easter-egg stage completed (1–4). Plays the stage cue on open:
     *  1–3 → 1up, 4 → stage clear. Omit for a silent modal. */
    stage?: number;
  }) => void;
}

export default function EggToast({ handle }: { handle: (h: EggToastHandle | null) => void }) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState("🥚 EASTER EGG");
  const [body, setBody] = useState("");
  const [emoji, setEmoji] = useState("🥚");
  const [okText, setOkText] = useState("🥚 Nice");
  const [color, setColor] = useState("#ffd700");

  const scale = useRef(new Animated.Value(0.8)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const open = useCallback((opts: Parameters<EggToastHandle["open"]>[0]) => {
    setTitle(opts.title || "🥚 EASTER EGG");
    setBody(opts.body || "");
    setEmoji(opts.emoji || "🥚");
    setOkText(opts.okText || "🥚 Nice");
    setColor(opts.color || "#ffd700");
    setVisible(true);
    // Stage cue plays with the modal pop.
    if (opts.stage != null) {
      if (opts.stage >= 4) soundStageClear();
      else soundOneUp();
    }
    // Pop-in: scale 0.8→1.05→1.0 with fade.
    scale.setValue(0.8);
    opacity.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 180, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 80, useNativeDriver: true }),
      ]),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 0.85, duration: 120, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start(() => setVisible(false));
  }, [scale, opacity]);

  const ref = useMemo<EggToastHandle>(() => ({ open }), [open]);
  useEffect(() => {
    handle(ref);
    return () => handle(null);
  }, [handle, ref]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View style={[styles.card, { transform: [{ scale }], opacity, borderColor: color }]}>
          <Text style={styles.emoji}>{emoji}</Text>
          <Text style={[styles.title, { color }]}>{" "}{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: color }]} onPress={dismiss} testID="egg-toast-ok">
            <Text style={styles.btnText}>{okText}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,.72)", justifyContent: "center", alignItems: "center", padding: 28 },
  card: { width: "100%", maxWidth: 360, backgroundColor: "#1a1a2e", borderColor: "#ffd700", borderWidth: 2, borderRadius: 18, padding: 26, alignItems: "center" },
  emoji: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 10, letterSpacing: 0.5 },
  body: { color: "#c8d0dc", fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 6 },
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 14, alignItems: "center", minWidth: 180 },
  btnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "800" },
});
