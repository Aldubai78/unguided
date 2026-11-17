// OpenGym landing hub (Phase 3.0 S2).
//
// The home screen once signed in — Unguided IS the OpenGym member surface of
// GymForge. Faithful to the 8001 reference (templates/gymforge/gymforge.html
// ogLanding + ogView): a "drop-in floor time" tag, four feature cards
// (PRs / History / Enter Workout / Percentage Calculator), and a "Last 10
// sessions" card. The feature cards navigate to their detail screens (built in
// S3–S6); the Last-10 card is wired to the live on-device dataset (S5/S2).
//
// The "grown-up" coat (better spacing, touch targets, dark-mode polish) is the
// S7 pass — this screen is structurally true first.
import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../src/AuthContext";
import type { WorkoutLog } from "../src/apiTypes";
import { consumeMantraPin, consumeFirstSignInPin } from "../src/pacmanProgress";
import { colors, radius, spacing, type } from "../src/theme";

interface Feature {
  key: string;
  icon: string;
  title: string;
  sub: string;
  /** S3–S6: the destination screen. "soon" = placeholder until that sub-step lands. */
  dest: string;
}

// OpenGym landing tag lines (Phase 3.0 S2).
//
// Verbatim port of the OG_TAGS array from the 8001 reference
// (templates/gymforge/gymforge.html, lines 1688-1722). The reference
// re-randomizes the tag on every landing render (ogRandomTag: line 1720).
// We re-roll on every FOCUS (sign-in arrival AND away→back) via
// useFocusEffect: the native stack keeps this screen mounted while a detail
// screen sits on top, so a mount-scoped useState alone would not re-roll on
// return. Focus fires on first render and on every stack pop-back.
const OG_TAGS: string[] = [
  "no shoes, no excuses, no mercy.",
  "come in sweaty, leave in a better shape.",
  "the floor is watching. act accordingly.",
  "bring your A game, we know your B.",
  "reps don't lie, but your mirror might.",
  "hot off the couch? cool down, warm up, get to work.",
  "your abs are in there. they're just... hiding.",
  "lift heavy, flirt lightly, ego appropriately.",
  "it's a free gym, not a free pass. put the weight up.",
  "nobody's coming to count your reps. not even us.",
  "leave your ego at the door. you'll need it less than you think.",
  "we don't care if you can't squat. we care if you quit.",
  "that's not a stretch, that's a cry for help. keep going.",
  "the bar doesn't know you're tired. it doesn't care.",
  "your excuses fit in a shoebox. your deadlift doesn't.",
  "look at that face. good. that's the PR face.",
  "bring it in. we've seen worse in a worse place.",
  "the rack's got your name on it. so does the trash can. pick one.",
  "you're not too sore. you're just underfed and overthinking.",
  "come for the free gym, stay because you're too proud to stop.",
  "we don't hand out participation trophies. we hand out failure positions.",
  "the box remembers everyone who quit. so does this line.",
  "you're not a guest here. you're a liability until you prove otherwise.",
  "the barbell doesn't ask if you're ready. it just lifts you.",
  "we've had funerals. we won't have a funeral for your ego.",
  "bring your A game or your body parts will pay the difference.",
  "nobody claps for a PR here. we just call the next one heavier.",
  'the whiteboard\'s full of "AMRAP 30min." so\'s your excuse pile.',
  "if it was easy you'd've done it on Monday. it's a new day. again.",
  'we don\'t do "good enough." the bar doesn\'t do "good enough."',
  "read the mantras to find the easter eggs.",
  "pause the snake at 30. the rest is up to you.",
  "where Snake is better than doom scrolling.",
];

// 2-column grid, row-major: top-left / bottom-left = items 0 / 1.
// Order: Enter Workout (top-left), PRs (bottom-left), History, Percentage
// Calculator, then Timer & Snake. Six cards → a 2×3 grid above the Last 10 card.
const FEATURES: Feature[] = [
  { key: "workout", icon: "✍️", title: "Enter Workout", sub: "Lift, Weight, Notes, Date", dest: "Workout" },
  { key: "prs", icon: "🏆", title: "PRs", sub: "Your best lives here", dest: "PRs" },
  { key: "history", icon: "📜", title: "History", sub: "Past workouts & notes", dest: "History" },
  { key: "calc", icon: "🧮", title: "Percentage Calculator", sub: "Because math is hard", dest: "Calc" },
  { key: "timer", icon: "⏱️", title: "Timer", sub: "Up, Down, Emom", dest: "Timer" },
  { key: "snake", icon: "🐍", title: "Snake", sub: "You're welcome", dest: "Snake" },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * A single line for the Last-10 card: date + the workout's 3 free-text strings.
 * Manual rows: `lift · weight · note`. Imported rows: `c1 · c2 · c3`.
 * Any part may be empty; only non-empty parts are shown, joined by " · ".
 * A log with nothing at all shows the date only, "—".
 *
 * Same detection as HistoryScreen's histStrings: if the first detail row has a
 * `c1` key, it's an imported row (4-col CSV: date, c1, c2, c3).
 */
function sessionLine(log: WorkoutLog): { date: string; body: string } {
  const date = fmtDate(log.completed_at);
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const details = Array.isArray(log.details) ? (log.details as any[]) : [];
  const row = details[0] ?? {};
  const imp = row.c1 !== undefined;
  const parts = imp
    ? [s(row.c1), s(row.c2), s(row.c3)]
    : [s(row.lift), s(row.weight), s(row.note) || s(log.notes)];
  const body = parts.filter(Boolean).join(" · ") || "—";
  return { date, body };
}

export default function OpenGymLanding({ navigation }: any) {
  const { lastSessions } = useAuth();
  // Fresh random tag on every focus (sign-in arrival AND away→back).
  // The native stack keeps this screen mounted while a detail screen sits on
  // top, so a mount-scoped useState alone would NOT re-roll on return — the
  // tag is re-picked each time the screen gains focus (useFocusEffect), which
  // fires on both first render and every stack pop-back.
  const pickTag = useCallback(
    () => OG_TAGS[Math.floor(Math.random() * OG_TAGS.length)],
    []
  );
  const [tag, setTag] = React.useState(pickTag);
  useFocusEffect(
    React.useCallback(() => {
      // S6.3: after returning from Snake, ALWAYS show the egg mantra.
      if (consumeMantraPin()) {
        setTag("pause the snake at 30. the rest is up to you.");
      } else if (consumeFirstSignInPin()) {
        setTag("read the mantras to find the easter eggs.");
      } else {
        setTag(pickTag());
      }
    }, [pickTag])
  );

  const onFeature = (f: Feature) => {
    // S3–S6 land the detail screens. Until then, PRs/History/Workout/Calc are
    // real destinations; we guard the nav so a missing route is a no-op, not a crash.
    try {
      navigation.navigate(f.dest);
    } catch {
      // route not registered yet (S3–S6 in progress) — ignore.
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.tag}>Open Gym — {tag}</Text>

      <View style={styles.grid}>
        {FEATURES.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={styles.featureCard}
            onPress={() => onFeature(f)}
            activeOpacity={0.8}
            testID={`og-feature-${f.key}`}
          >
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={styles.featureTitle}>{f.title}</Text>
            <Text style={styles.featureSub}>{f.sub}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.last10Card}>
        <Text style={styles.last10Label}>Last 10 sessions</Text>
        {lastSessions.length === 0 ? (
          <Text style={styles.empty}>—</Text>
        ) : (
          lastSessions.map((log, i) => {
            const { date, body } = sessionLine(log);
            return (
              <View key={i} style={styles.sessionRow}>
                <Text style={styles.sessionDate}>{date}</Text>
                <Text style={styles.sessionBody} numberOfLines={2}>
                  {body}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {/* Profile / Back up / Restore is now reachable from the persistent
          AppHeader (tap the member name); the old bottom link is removed. */}
    </ScrollView>
  );
}

// S7: values now route through src/theme.ts. Every number resolves to the exact
// pre-S7 value (pixel-identical drop). Color changes later = one line in theme.ts.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, paddingBottom: spacing.xl + spacing.lg }, // 24 / 40
  tag: { color: colors.accentSoft, fontSize: type.body.fontSize, letterSpacing: 0.3, marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.md }, // 12
  featureCard: {
    width: "48%",
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.xl - spacing.xs, // 20
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "flex-start",
  },
  featureIcon: { fontSize: 28, marginBottom: spacing.sm + 2 }, // 10
  featureTitle: { color: colors.text, ...type.title, letterSpacing: -0.2 }, // 17 / 700 (Grok 5a: tighter)
  featureSub: { color: colors.muted, fontSize: type.label.fontSize, marginTop: spacing.xs, lineHeight: 16 }, // 12 / no weight (held)
  last10Card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.lg + 2, // 18
    marginTop: spacing.lg, // 16
    borderWidth: 1,
    borderColor: colors.border,
  },
  last10Label: { color: colors.faint, fontSize: type.label.fontSize, letterSpacing: 1, marginBottom: spacing.md }, // 12 / ls:1 / mb:12
  empty: { color: colors.faint2, fontSize: type.body.fontSize }, // 14
  sessionRow: { flexDirection: "row", paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }, // 8 / #222
  sessionDate: { color: colors.accent, fontSize: 13, fontWeight: "700", width: 70, flexShrink: 0 },
  sessionBody: { color: colors.text2, fontSize: 13, flex: 1, marginLeft: spacing.sm + 2 }, // 10
});
