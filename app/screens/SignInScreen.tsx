// Sign-in screen (Phase 2.1 S6).
// Minimal web-first form: username + password -> useAuth().signIn.
// The app is the source of truth once signed in; this screen just authenticates
// and triggers the auto-pull that seeds the on-device dataset.
import React, { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Animated, Easing, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../src/AuthContext";
import { credStore } from "../src/credStore";

export default function SignInScreen() {
  const { signIn, register, busy, error } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  // RN-idiomatic "submit" via Enter. RN Web can't be wrapped in a <form> without
  // leaking DOM, so the browser's "password field not contained in a form" warning
  // is silenced the proper way: onSubmitEditing. Enter in username → focus
  // password; Enter in password → sign in. (Also gives the expected Enter-to-
  // submit UX that a real form would provide.)
  const passwordRef = useRef<React.ComponentRef<typeof TextInput> | null>(null);

  // Offline-first: as the user types a username, tell them (softly) if this
  // device has a cached credential for them, so they know offline sign-in will
  // work. Non-blocking — a lookup failure just means no hint.
  useEffect(() => {
    let live = true;
    const u = username.trim();
    if (!u) {
      setHint(null);
      return;
    }
    void credStore
      .hasCredential(u)
      .then((has) => {
        if (!live) return;
        setHint(has ? "known on this device — works offline" : null);
      })
      .catch(() => {
        if (live) setHint(null);
      });
    return () => {
      live = false;
    };
  }, [username]);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  const submitSignIn = () => {
    if (canSubmit) void signIn(username.trim(), password);
  };
  const onSignin = submitSignIn; // button uses the same handler
  const onRegister = () => {
    if (canSubmit) void register(username.trim(), password);
  };

  // Floating-shark loop (web + native). Started once on mount; a simple
  // translateY oscillation with ease-in-out, no DOM className involved.
  const sharkAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS !== "web") return; // native: static shark
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sharkAnim, {
          toValue: -14,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(sharkAnim, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sharkAnim]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingBottom: 24 + insets.bottom }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.card}>
        {/* Floating shark — part of the main theme. Driven by RN Animated (web +
            native, no DOM className needed). On native it renders as a static
            emoji (the animation simply isn't started). */}
        {sharkAnim ? (
          <Animated.Text style={[styles.shark, { transform: [{ translateY: sharkAnim }] }]}>🦈</Animated.Text>
        ) : (
          <Text style={styles.shark}>🦈</Text>
        )}
        <Text style={[styles.title, { letterSpacing: 3 }]}>Unguided</Text>
        <Text style={styles.byline}>by Doug Labs</Text>

        <Text style={styles.label}>USERNAME</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          placeholderTextColor="#555"
          testID="signin-username"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
          returnKeyType="next"
        />

        <Text style={styles.label}>PASSWORD</Text>
        <TextInput
          ref={passwordRef}
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="password"
          placeholderTextColor="#555"
          testID="signin-password"
          onSubmitEditing={submitSignIn}
          returnKeyType="done"
        />

        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.btn, !canSubmit && styles.btnDisabled]}
          onPress={onSignin}
          disabled={!canSubmit}
          testID="signin-submit"
        >
          <Text style={styles.btnText}>{busy ? "Working…" : "Sign in"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, !canSubmit && styles.btnDisabled]}
          onPress={onRegister}
          disabled={!canSubmit}
          testID="signin-register"
        >
          <Text style={styles.btnText}>Register</Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#111", padding: 24 },
  card: { backgroundColor: "#1a1a1a", borderRadius: 14, padding: 24 },
  shark: { fontSize: 64, textAlign: "center", marginBottom: 4 },
  title: { fontSize: 52, fontWeight: "900", color: "#fff", textAlign: "center", marginBottom: 2, letterSpacing: 3 },
  byline: { fontSize: 13, color: "#888", textAlign: "right", alignSelf: "flex-end", marginTop: 2, marginBottom: 18, fontStyle: "italic" },
  label: { fontSize: 12, color: "#666", letterSpacing: 1, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    fontSize: 15,
  },
  error: { color: "#f66", marginTop: 14, fontSize: 13 },
  hint: { color: "#6c8", marginTop: 10, fontSize: 12, fontStyle: "italic" },
  btn: { marginTop: 22, backgroundColor: "#4af", borderRadius: 10, padding: 14, alignItems: "center" },
  btnSecondary: { marginTop: 10, backgroundColor: "#2a5a7a" },
  btnDisabled: { backgroundColor: "#345" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
