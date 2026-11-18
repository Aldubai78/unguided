// Text-fit presets for iOS Dynamic Type / Android font scale.
//
// React Native scales every <Text> by the phone's text-size setting
// (Settings › Display & Brightness › Text Size). Body copy should keep scaling
// with it. Display text that must stay on one line, or that sits inside a
// fixed-size box, needs one of these presets so a larger setting can't wrap
// or clip it.
//
// Usage:
//   <Text {...oneLine} style={styles.title}>Unguided</Text>
//   <Text maxFontSizeMultiplier={CHROME_MAX_SCALE} style={styles.hud}>…</Text>
//   <Text allowFontScaling={false} style={styles.ledDigit}>8</Text>  // fixed box
import type { TextProps } from "react-native";

/** Stays on one line and shrinks to fit its width instead of wrapping. */
export const oneLine = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.4,
} as const satisfies TextProps;

/** Up to two lines, shrinking only if it still doesn't fit (card titles). */
export const twoLines = {
  numberOfLines: 2,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.5,
} as const satisfies TextProps;

/**
 * Cap on text-size growth for app chrome and game HUDs: the header, footer,
 * score rows and overlays whose height is budgeted against a fixed board.
 */
export const CHROME_MAX_SCALE = 1.3;
