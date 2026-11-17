#!/usr/bin/env node
// S7 Path B codemod: rewrite hex literals in a screen's StyleSheet to theme.ts tokens.
// Usage: node tools/s7-codemod.mjs <file.tsx> [--apply]
//   (no --apply = dry-run, prints the diff; --apply = writes the file)
//
// Strategy: only replace hex inside the StyleSheet.create(...) block, and only the
// values in the MAP below. Everything else (layout numbers, fontSize, etc.) is left
// untouched. This is intentionally conservative — a hex that has no token stays.

import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file) {
  console.error("usage: node tools/s7-codemod.mjs <file.tsx> [--apply]");
  process.exit(1);
}

// hex (lowercased) -> theme.ts token reference.
// Kept 1:1 with theme.ts (our names, Grok's values). Values NOT here stay as-is
// (e.g. Timer's LCD palette, arcade neons) — those screens pull system tokens but
// keep their deliberate colors.
const MAP = {
  // background / surfaces
  "#111": "colors.bg",
  "#0e0e10": "colors.bg",
  "#1a1a1a": "colors.card",
  "#161618": "colors.card",
  "#1c1c1c": "colors.cardRaised",
  "#2a2a2a": "colors.divider", // old card-border grey -> subtle divider
  "#222": "colors.divider",
  "#333": "colors.divider",
  // borders
  "#1e2a3a": "colors.border", // old blue-grey border
  // text
  "#fff": "colors.text",
  "#f4f4f5": "colors.text",
  "#ccc": "colors.text2",
  "#a1a1aa": "colors.text2",
  "#eee": "colors.text",
  "#bbb": "colors.muted",
  "#888": "colors.muted",
  "#999": "colors.muted",
  "#777": "colors.muted",
  "#666": "colors.faint",
  "#555": "colors.faint2",
  "#444": "colors.faint2",
  // accents
  "#4af": "colors.accent",
  "#9cf": "colors.accentSoft",
  "#60a5fa": "colors.accentSoft",
  // PR value / 1RM (amber) -> Grok gold
  "#f5c98e": "colors.gold",
  // functional
  "#2a6": "colors.success",
  "#4caf50": "colors.success",
  "#5ad07a": "colors.success",
  "#7d7": "colors.success",
  "#fbb": "colors.danger",
  "#f55": "colors.danger",
  "#f56": "colors.danger",
  "#4a2020": "colors.overlay", // dark red-tinted danger well -> overlay (revisit if it should stay red)
  // calc yellow readout -> lcd
  "#ffe600": "colors.lcd",
  "#f5c542": "colors.gold",
};

const src = readFileSync(file, "utf8");

// Operate only within the StyleSheet.create(...) block so we never touch a hex
// used in logic (e.g. a color computed inline for a state).
const ssStart = src.indexOf("StyleSheet.create(");
if (ssStart === -1) {
  console.error("no StyleSheet.create( found in", file, "— nothing done");
  process.exit(0);
}
// find the matching closing "})" of StyleSheet.create — approximate by the last
// "})" before EOF is unreliable; instead scan braces from ssStart's first "(".
let i = src.indexOf("(", ssStart);
let depth = 0;
let ssEnd = -1;
for (let j = i; j < src.length; j++) {
  if (src[j] === "(") depth++;
  else if (src[j] === ")") {
    depth--;
    if (depth === 0) { ssEnd = j; break; }
  }
}
if (ssEnd === -1) {
  console.error("could not find end of StyleSheet.create(", file, "— nothing done");
  process.exit(0);
}

const head = src.slice(0, ssStart);
const block = src.slice(ssStart, ssEnd + 1);
const tail = src.slice(ssEnd + 1);

let count = 0;
// Replace quoted hex literals ("#111" or '#111') with the bare token reference
// (colors.bg) so it's a real identifier, not a string. Only inside the block.
const changed = block.replace(/(["'])(#[0-9a-fA-F]{3,8})\1/g, (m, q, hex) => {
  const tok = MAP[hex.toLowerCase()];
  if (!tok) return m; // no token for this hex — leave it (arcade/local color)
  count++;
  return tok; // bare identifier: colors.bg
});

// If we used tokens but the file doesn't import them yet, inject the import after
// the last top-level import line (RN/React imports are at the top).
let headOut = head;
if (count > 0 && !/from "\.\.\/src\/theme"/.test(head) && !/from "\.\/src\/theme"/.test(head)) {
  const lines = head.split("\n");
  let lastImport = -1;
  for (let k = 0; k < lines.length; k++) {
    if (/^import .* from "/.test(lines[k].trim())) lastImport = k;
  }
  if (lastImport === -1) {
    headOut = `import { colors, radius, type, spacing, touch, shadow } from "../src/theme";\n` + head;
  } else {
    lines.splice(lastImport + 1, 0, `import { colors, radius, type, spacing, touch, shadow } from "../src/theme";`);
    headOut = lines.join("\n");
  }
}

const out = headOut + changed + tail;
if (count === 0) {
  console.log(`no mappable hex in StyleSheet of ${file}`);
  process.exit(0);
}

if (!apply) {
  console.log(`DRY-RUN ${file}: ${count} hex -> token replacements in StyleSheet`);
  console.log("---- diff (StyleSheet block) ----");
  // crude line diff
  if (headOut !== head) {
    console.log("+ (imports) added:  import { colors, radius, type, spacing, touch, shadow } from \"../src/theme\";");
  }
  const a = block.split("\n");
  const b = changed.split("\n");
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (a[k] !== b[k]) {
      console.log(`- ${a[k] ?? ""}`);
      console.log(`+ ${b[k] ?? ""}`);
    }
  }
  console.log("---- (run with --apply to write) ----");
  process.exit(0);
}

writeFileSync(file, out, "utf8");
console.log(`APPLIED ${file}: ${count} replacements. Verify: tsc + screenshot.`);
