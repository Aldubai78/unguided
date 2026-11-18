// AppHeader — the persistent "Unguided" banner (Phase 3.0 S2).
//
// Rendered as the navigation `header` on every signed-in screen so it stays
// pinned on top while each screen's body scrolls underneath. Two rows:
//   Row 1: 🦈 + "Unguided" wordmark (spans). On sub-screens (anything other
//          than the OpenGym landing) a back chevron precedes the shark.
//   Row 2: member display_name (tap -> Profile)  ·  "Sign out" (right).
//
// signOut() wipes the on-device session (server revoke + tokenStore + localStore)
// and returns the App to the SignIn screen via the auth re-flow.
import React, { useRef, useCallback, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { useAuth } from "../src/AuthContext";
import { colors } from "../src/theme"; // Grok S7: header chevron+title -> mantra blue (accentSoft)
import { api } from "../src/api";
import { getProgress, showEggIndicator, reset as resetEgg } from "../src/pacmanProgress";
import FreakConfirm, { FreakConfirmHandle } from "./FreakConfirm";
import EggToast, { EggToastHandle } from "./EggToast";

import { oneLine, CHROME_MAX_SCALE } from "../src/textFit";
const HOME_ROUTE = "OpenGym";

// Page titles for the header bar. Home (OpenGym) is blank (self-evident).
// Each entry: { icon, label } — icon matches the nav card on the landing.
const PAGE_TITLES: Record<string, { icon: string; label: string }> = {
  Workout: { icon: "✍️", label: "Enter Workout" },
  PRs: { icon: "🏆", label: "PRs" },
  History: { icon: "📜", label: "History" },
  Calc: { icon: "🧮", label: "Calculator" },
  Timer: { icon: "⏱️", label: "Timer" },
  Snake: { icon: "🐍", label: "Snake" },
  Profile: { icon: "👤", label: "Profile" },
  Chamber: { icon: "🚀", label: "Chamber" },
};

export default function AppHeader({ navigation, route }: NativeStackHeaderProps) {
  const { user, signOut, reauth } = useAuth();
  // CoC Phase 2: the entry-ritual modals, mounted here so every screen's header
  // can trigger them (FreakConfirm = password re-entry, EggToast = offline notice).
  // Both are <Modal>-based, so they render above the current screen regardless
  // of which route is active.
  const [freak, setFreak] = useState<FreakConfirmHandle | null>(null);
  const [toast, setToast] = useState<EggToastHandle | null>(null);
  const [chamberBusy, setChamberBusy] = useState(false);
  const name = user?.display_name || user?.username || "Member";
  const isHome = route.name === HOME_ROUTE;
  const chamberActive = isHome; // 🚀 Chamber only tappable on the hub
  const pageTitleEntry = PAGE_TITLES[route.name as string];
  // S6.3: Easter egg counter. Replaces the page title in the centered slot
  // while the player is mid-progression (0/4 through 3/4). Hidden at 4/4.
  const eggVisible = showEggIndicator();
  const eggCount = getProgress();

  // S6.3: 2 taps within 2s on the shark resets the egg progress (dev/debug).
  const sharkTaps = useRef<number[]>([]);
  const onSharkTap = useCallback(() => {
    const now = Date.now();
    sharkTaps.current = sharkTaps.current.filter((t) => now - t < 2000);
    sharkTaps.current.push(now);
    if (sharkTaps.current.length >= 2) {
      sharkTaps.current = [];
      Alert.alert("🦈", "Easter egg progress reset.", [
        { text: "OK", style: "cancel" },
      ]);
      resetEgg();
    }
  }, []);

  const onName = () => {
    // Tap the name to open Profile (keeps the Back up / Restore access).
    // On the Profile screen itself, a tap is a harmless no-op.
    if (route.name !== "Profile") {
      try {
        navigation.navigate("Profile");
      } catch {
        /* Profile route not registered — ignore */
      }
    }
  };

  const onBack = () => {
    try {
      // Always reset to hub — goBack() can land on an unexpected screen
      // if the user navigated Profile → PRs → back.
      if (navigation.canGoBack()) {
        navigation.reset({ index: 0, routes: [{ name: HOME_ROUTE }] });
      } else {
        navigation.navigate(HOME_ROUTE);
      }
    } catch {
      /* no-op */
    }
  };

  const onHome = () => {
    try {
      // Reset (not navigate) so screens above Home are fully unmounted.
      // navigate() only blurs them in a stack, leaving Chamber's socket
      // alive and the persona ghosting in the room.
      if (navigation.canGoBack()) {
        navigation.reset({ index: 0, routes: [{ name: HOME_ROUTE }] });
      } else {
        navigation.navigate(HOME_ROUTE);
      }
    } catch {
      /* no-op */
    }
  };

  // CoC Phase 2 — the entry ritual (no new auth; reuses reauth() -> /app/signin).
  //   tap -> ping (10s) -> offline? toast + stay  : password prompt -> reauth ->
  //   navigate to the stub Chamber screen. Single probe per tap (offline-first).
  const onChamberTap = useCallback(async () => {
    if (chamberBusy) return; // one ritual at a time (no double-tap spam)
    setChamberBusy(true);
    try {
      // 1) Ping the chamber server (tokenless, 10s hard timeout).
      const ping = await api.pingChamber();
      if (!ping.online) {
        // 2a) Not available -> stay put. Toast the reason, no dim/retry/nav.
        toast?.open({
          title: "🚀 Chamber of Chaos",
          body: `Chamber's offline. (${ping.reason})`,
          emoji: "🚀",
          okText: "OK",
          color: colors.accentSoft,
        });
        return;
      }
      // 2b) Available -> re-enter password (re-identify before entering the room).
      if (!freak || !user) return;
      const res = await freak.open({
        title: "🚀 Chamber of Chaos",
        body: "Enter your password to enter the chamber.",
        okText: "🚀 Enter",
        password: { label: `Password for ${user.username}`, placeholder: "your password" },
      });
      if (!res.ok || !res.password) return; // cancelled -> stay put
      // 3) Mint a fresh chamber token (the same exchange Phase 3 hands to the socket).
      const ok = await reauth(user.username, res.password);
      if (!ok) return; // wrong password / offline -> reauth already surfaced it
      // 4) In. Navigate to the stub screen (Phase 3 swaps its content, not the route).
      try {
        navigation.navigate("Chamber");
      } catch {
        /* route not registered — ignore */
      }
    } finally {
      setChamberBusy(false);
    }
  }, [chamberBusy, freak, user, reauth, navigation, toast]);

  return (
    <View style={styles.root}>
      {/* Row 1: wordmark. The back slot is ALWAYS rendered (tappable only on
          sub-screens) so the row width is identical on every screen — the chevron
          appearing never shifts the banner. The group is centered so the reserved
          space balances on the landing. */}
      <View style={styles.row1}>
        {isHome ? (
          <View style={styles.back}>
            <Text allowFontScaling={false} style={styles.backChevron} />
          </View>
        ) : (
          <TouchableOpacity style={styles.back} onPress={onBack} hitSlop={8} testID="header-back">
            <Text allowFontScaling={false} style={styles.backChevron}>‹</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onSharkTap} hitSlop={4} testID="header-shark">
          <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.shark}>🦈</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.wordmarkBtn} onPress={onHome} hitSlop={4} testID="header-home">
          <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.wordmark}>Unguided</Text>
        </TouchableOpacity>
        <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.byline}>by Doug Labs</Text>
      </View>

      {/* Row 2: 👤 [Name] (tap->Profile) · [icon+title] centered · Sign out */}
      <View style={styles.row2}>
        <TouchableOpacity style={styles.nameWrap} onPress={onName} hitSlop={4} testID="header-name">
          <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.profileIcon}>👤</Text>
          <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </TouchableOpacity>
        <View style={styles.titleSlot}>
          {isHome && eggVisible ? (
            <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.eggCounter}>
              🥚 {eggCount}/4
            </Text>
          ) : pageTitleEntry ? (
            <Text {...oneLine} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.pageTitle}>
              {pageTitleEntry.icon} {pageTitleEntry.label}
            </Text>
          ) : null}
        </View>
        {/* CoC Phase 2: the "🚀 Chamber" button. Sign-out is NOT removed — it
            already lives on the Profile page (locked decision). Tapping runs the
            entry ritual: ping -> offline? toast+stay : password -> reauth -> stub. */}
        <TouchableOpacity
          style={[styles.chamber, (chamberBusy || !chamberActive) && styles.chamberBusy]}
          onPress={() => chamberActive && void onChamberTap()}
          disabled={chamberBusy || !chamberActive}
          hitSlop={4}
          testID="header-chamber"
        >
          <Text numberOfLines={1} maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.chamberText}>{chamberBusy ? "…" : "🚀 Chamber"}</Text>
        </TouchableOpacity>
      </View>

      {/* CoC Phase 2 entry-ritual modals (render above the current screen). */}
      <FreakConfirm handle={setFreak} />
      <EggToast handle={setToast} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  row1: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  // Fixed height = the chevron's lineHeight (34). The landing's EMPTY chevron
  // collapses to 0px tall, so without this the row height (and the centered
  // wordmark group) would jump a few px when the glyph appears. A fixed
  // slot height makes the banner pixel-identical on every screen.
  back: { width: 28, height: 34, alignItems: "center", justifyContent: "center", marginRight: 4 },
  backChevron: { color: colors.accentSoft, fontSize: 30, lineHeight: 34, fontWeight: "300" }, // Grok S7: mantra blue
  shark: { fontSize: 26, marginRight: 8 },
  // flexShrink lets the wordmark and byline shrink-to-fit (oneLine) on narrow
  // phones or large text sizes instead of pushing the row off-screen.
  wordmarkBtn: { flexDirection: "row", flexShrink: 1 },
  wordmark: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: 0.5, flexShrink: 1 },
  byline: { color: "#556", fontSize: 12, fontWeight: "400", fontStyle: "italic", marginLeft: 8, flexShrink: 1 },
  row2: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  // maxWidth keeps a long display name from squeezing the page title out.
  nameWrap: { flexDirection: "row", alignItems: "center", flexShrink: 1, maxWidth: "38%" },
  profileIcon: { fontSize: 14, marginRight: 5 },
  name: { color: "#ddd", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  titleSlot: { flex: 1, alignItems: "center" },
  pageTitle: { color: colors.accentSoft, fontSize: 13, fontWeight: "600" }, // Grok S7: mantra blue
  eggCounter: { color: "#f5d442", fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  // CoC Phase 2: the 🚀 Chamber button. Neutral pill (matches the old Sign-out
  // geometry) — no new color; the 🚀 + accentSoft text carry the identity.
  chamber: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardRaised,
  },
  chamberBusy: { opacity: 0.35 },
  chamberText: { color: colors.accentSoft, fontSize: 13, fontWeight: "600" },
  // (sign-out button retired from the header — lives on ProfileScreen instead.)
  signOut: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "#1a1a1a",
  },
  signOutText: { color: "#f66", fontSize: 13, fontWeight: "600" },
});
