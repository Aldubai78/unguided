// App root (Phase 2.1 S6).
//
// AuthProvider (S6) owns signedIn; this renders the SignIn screen when signed
// out and the Profile screen when signed in. Navigation is a single native-stack
// (SignIn <-> Profile); the auth swap is driven by useAuth, not by a nav push —
// the App re-flows when `signedIn` changes (reference pattern).
//
// The S3 core self-check is preserved as a debug route (S3Debug) so the 572/572
// conformance gate stays reachable in the browser, but it is no longer the home.
import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, useWindowDimensions } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/AuthContext";
import SignInScreen from "./screens/SignInScreen";
import ProfileScreen from "./screens/ProfileScreen";
import SnakeScreen from "./screens/SnakeScreen";
import EnterWorkoutScreen from "./screens/EnterWorkoutScreen";
import PRsScreen from "./screens/PRsScreen";
import HistoryScreen from "./screens/HistoryScreen";
import OpenGymLanding from "./screens/OpenGymLanding";
import TimerScreen from "./screens/TimerScreen";
import CalculatorScreen from "./screens/CalculatorScreen";
import PacManScreen from "./screens/PacManScreen";
import AppHeader from "./components/AppHeader";
import ChamberLanding from "./screens/ChamberLanding";
import ChamberChat from "./screens/ChamberChat";
import { TimerProvider, useTimer } from "./src/TimerContext";
import { TimerFooter } from "./components/TimerFooter";

// Re-exported from the S3 shell so the gate stays verifiable in the browser.
import { coreSelfCheck } from "./coreSelfCheck";

const Stack = createNativeStackNavigator();

type RootParamList = {
  SignIn: undefined;
  OpenGym: undefined;
  Profile: undefined;
  // S3–S6 detail routes (registered as no-op placeholders now so S2's feature
  // cards can navigate without crashing; replaced by the real screens in S3–S6).
  PRs: undefined;
  History: undefined;
  Workout: undefined;
  Calc: undefined;
  Timer: undefined;
  Snake: undefined;
  PacMan: undefined;
  // CoC Phase 3: the lobby (persona picker + occupancy + Summon/Dismiss Doug).
  // Phase 4 (W4) will add the chat room as a sub-screen within the Chamber route.
  Chamber: undefined;
  S3Debug: undefined;
};

// Export for screens that need the navigation type.
export type { RootParamList };

// S3–S6 placeholders: a centered label so the S2 feature cards have a live, non-crashing
// destination. Replaced by the real OpenGym detail screens in their sub-step.
// Each route gets a no-arg component (React Navigation requires a prop-less screen).
function comingSoonScreen(label: string) {
  return function ComingSoonScreen() {
    return (
      <View style={{ flex: 1, backgroundColor: "#111", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#666", fontSize: 16 }}>{label} — building in S3–S6</Text>
      </View>
    );
  };
}
// All S3–S6 placeholders replaced by real screens.

// Phase 3 W4 wrapper: the Chamber route is a state machine — lobby (W3)
// transitions to chat (W4) when the user picks a persona. One route, two
// internal screens. The lobby is the entry; chat is internal state, not a
// separate nav route (keeps the header ritual intact).
function ChamberRoom() {
  const [activePersona, setActivePersona] = React.useState<string | null>(null);

  const handleEnter = React.useCallback((persona: string) => {
    setActivePersona(persona);
  }, []);

  const handleLeave = React.useCallback(() => {
    setActivePersona(null);
  }, []);

  if (activePersona) {
    return <ChamberChat persona={activePersona} onLeave={handleLeave} />;
  }
  return <ChamberLanding onEnter={handleEnter} />;
}

function S3DebugScreen() {
  const selfCheck = coreSelfCheck();
  return (
    <View style={styles.debugRoot}>
      <Text style={styles.debugTitle}>S3 core self-check</Text>
      <Text style={selfCheck.ok ? styles.pass : styles.fail}>
        {selfCheck.ok ? "PASS" : "FAIL"}
      </Text>
      {selfCheck.results.map((r, i) => (
        <Text key={i} style={styles.detail}>{r}</Text>
      ))}
    </View>
  );
}

// Kills the running timer on ANY member switch — keyed on member_id so an
// A -> B sign switch fires even when `signedIn` never dips to false (both
// users are members). TimerProvider lives above AuthProvider in the tree, so
// its state outlives the auth swap; this is the single reset point.
function TimerResetOnMemberChange() {
  const { user } = useAuth();
  const { clear } = useTimer();
  useEffect(() => {
    clear(); // also cancels the in-flight windup + scheduled beeps
  }, [user?.member_id, clear]);
  return null;
}

function Authed() {
  const { signedIn } = useAuth();
  const insets = useSafeAreaInsets();

  const navigator = (
    <View style={{ flex: 1 }}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#111" },
          headerTintColor: "#fff",
          header: (props) => <AppHeader {...props} />,
        }}
      >
      {signedIn ? (
        <>
          <Stack.Screen name="OpenGym" component={OpenGymLanding} options={{ title: "Open Gym" }} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="PRs" component={PRsScreen} options={{ title: "Your PRs" }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: "Workout History" }} />
          <Stack.Screen name="Workout" component={EnterWorkoutScreen} options={{ title: "Enter Workout" }} />
          <Stack.Screen name="Calc" component={CalculatorScreen} options={{ title: "Percentage Calculator" }} />
          <Stack.Screen name="Timer" component={TimerScreen} options={{ title: "Timer" }} />
          <Stack.Screen name="Snake" component={SnakeScreen} />
          <Stack.Screen name="PacMan" component={PacManScreen} options={{ title: "Pac-Man" }} />
          <Stack.Screen name="Chamber" component={ChamberRoom} options={{ title: "Chamber" }} />
          <Stack.Screen name="S3Debug" component={S3DebugScreen} options={{ title: "S3 core" }} />
        </>
      ) : (
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
      )}
      </Stack.Navigator>
    </View>
  );

  // Keyboard handling: root-level KAV on BOTH platforms.
  // Android edge-to-edge (Expo SDK 57, edgeToEdgeEnabled=true) makes
  // adjustResize a no-op — KAV is the reliable fix.
  // TimerFooter is a NORMAL-FLOW sibling below the navigator (not absolute) —
  // screens shrink to make room, nothing overlaps the gesture nav bar.
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#111" }} behavior="padding" keyboardVerticalOffset={-insets.bottom}>
      <View style={{ flex: 1, backgroundColor: "#111", paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flex: 1 }}>{navigator}</View>
        <TimerFooter />
      </View>
    </KeyboardAvoidingView>
  );
}

// TimerProvider is ABOVE AuthProvider so the timer survives navigation — this
// reset hook (inside the timer tree, below auth) is what ends a run when the
// member changes. Sign out / A->B switch = timer dead, nothing saved.
function AuthedWithTimerReset() {
  return (
    <TimerProvider>
      <TimerResetOnMemberChange />
      <Authed />
    </TimerProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <AuthedWithTimerReset />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  debugRoot: { flex: 1, backgroundColor: "#111", padding: 24 },
  debugTitle: { fontSize: 24, fontWeight: "800", color: "#fff", marginBottom: 16 },
  pass: { fontSize: 20, fontWeight: "700", color: "#4f8" },
  fail: { fontSize: 20, fontWeight: "700", color: "#f66" },
  detail: { fontSize: 12, color: "#aaa", fontFamily: "monospace", marginTop: 6 },
});
