// SavedModal — the reusable "✓ done" confirmation overlay.
//
// One look, many uses:
//   - Enter Workout (S3):  "Saved locally"  -> button "Back to home" -> goBack()
//   - Profile (S7):        "Done"           -> button "OK"           -> stay on Profile
//
// It is a SUCCESS beat only. It must be dismissed by tapping the button
// (no auto-dismiss, no backdrop-tap-close) — the caller decides what onOK does
// (navigate away, or just close). Pass check="error" to render a red ✕ instead
// of a green ✓ when the same layout needs to surface a failure.
import React from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";

interface SavedModalProps {
  visible: boolean;
  title: string;
  sub?: string;
  buttonLabel?: string;
  check?: "ok" | "error";
  onOK: () => void;
}

export default function SavedModal({
  visible,
  title,
  sub,
  buttonLabel = "OK",
  check = "ok",
  onOK,
}: SavedModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={[styles.check, check === "error" && styles.checkErr]}>
            {check === "error" ? "✕" : "✓"}
          </Text>
          <Text style={styles.title}>{title}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
          <TouchableOpacity style={styles.btn} onPress={onOK}>
            <Text style={styles.btnText}>{buttonLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#1a1a1a",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  check: { color: "#5ad07a", fontSize: 52, lineHeight: 56, marginBottom: 6 },
  checkErr: { color: "#f56" },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  sub: { color: "#888", fontSize: 13, marginBottom: 22, textAlign: "center" },
  btn: {
    alignSelf: "stretch",
    backgroundColor: "#4af",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnText: { color: "#04121f", fontSize: 16, fontWeight: "700" },
});
