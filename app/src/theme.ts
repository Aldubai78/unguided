// theme.ts — Unguided "Open Gym" design tokens (S7 design pass).
//
// Single source of truth for the shared (non-arcade) visual language: the hub,
// forms, lists, and timer. Screens that keep a LOCAL palette (Snake, Pac-Man —
// deliberate arcade-neon design choices) still own their colors but should pull
// their *system* values (radius, spacing, type, touch, borders) from here.
//
// Palette = the GROK design system (adopted in full, 2026-11-01). Grok's token
// names are mapped onto the ones the screens already use, so downstream code
// (colors.card / colors.accent / colors.text2 / …) needs no changes:
//   surface        -> card          surfaceRaised   -> cardRaised
//   border         -> border        text            -> text
//   textSecondary  -> text2         textMuted       -> muted
//   textFaint      -> faint         textFaint2      -> faint2
//   accent         -> accent        accentSoft      -> accentSoft
// Functional colors (success/danger/warning/lcd) are NEW — the PR / timer / calc
// screens will use them in their own S7 steps; adding them here is free structure.
//
// NOTE: values are `as const` so RN's typed style props (e.g. fontWeight) stay
// happy. `fontVariant`/`tabular-nums` are intentionally NOT in the tokens yet —
// that's part of the later "micro-polish" pass.

export const colors = {
  bg: "#0E0E10",
  card: "#161618",
  cardRaised: "#1C1C1F",
  border: "rgba(255,255,255,0.08)", // #FFFFFF14 — translucent, sits cards on the surface
  divider: "#26262B",
  text: "#F4F4F5",
  text2: "#A1A1AA",
  muted: "#71717A",
  faint: "#52525B",
  faint2: "#3F3F46",
  accent: "#3B82F6",
  accentSoft: "#60A5FA",
  // — functional (new, for PR / timer / calc screens) —
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  // Grok additions (full spec, Path B):
  red: "#FF6B6B",
  redGlow: "rgba(255,107,107,0.25)",
  gold: "#FACC15",
  goldMuted: "rgba(250,204,21,0.15)",
  overlay: "rgba(0,0,0,0.72)",
  lcd: "#FACC15", // Timer keeps its own LCD look; alias kept so nothing breaks
  lcdBg: "#0A0A0A",
  lcdWell: "#030303",
} as const;

export type TypeToken = {
  fontSize: number;
  fontWeight: "400" | "500" | "600" | "700" | "800";
  letterSpacing?: number;
};

export const type = {
  h1: { fontSize: 24, fontWeight: "800" },
  title: { fontSize: 17, fontWeight: "700" }, // titleLg
  body: { fontSize: 14, fontWeight: "500" }, // titleSm
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 1 }, // caption (ls:1, proven on hub)
  small: { fontSize: 11, fontWeight: "600", letterSpacing: 0.5 }, // tiny
  display: { fontSize: 64, fontWeight: "900" }, // Grok display
  clock: { fontSize: 48, fontWeight: "700" }, // Grok clock
} as const;

export const radius = {
  sm: 8, // Grok sm
  card: 12, // Grok md
  button: 16, // Grok lg
  xl: 20, // Grok xl
  pill: 999, // Grok full
} as const;

// touch.min = 44pt HIG minimum tap target.
export const touch = {
  min: 44,
  button: 52,
  buttonSm: 40,
  input: 48,
  cardMin: 60,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

// Grok S7 (#3): list row rhythm + badge consistency — single source of truth
// so PRs / History rows stop drifting. Screens import these, never re-literal.
//  rowPadY  = vertical breathing room inside a list row (was 7 PRs / ~8 Hist).
//  listPill = weight / % value pill (was 13/700 PRs vs 12/700 Hist -> 13/700).
//  btn      = primary + secondary action button geometry (Grok #2: 52-56 tall / 16 radius).
// NOTE: gold 1RM/% pill COLOR + Timer arcade glow stay gold (Allen decision 2026-11-01).
export const list = {
  rowPadY: 9, // held at 9 (Allen 2026-11-01: dense scan for gym, overrode Grok's 14)
  listPill: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0 }, // Grok R2 #5: 13 -> 12
  btn: { height: 52, borderRadius: 16 },
  btnSm: { height: 40, borderRadius: 12 },
} as const;

export const shadow = {
  glow: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 12 },
  soft: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
} as const;
