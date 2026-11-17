import { readFileSync } from "node:fs";
import { importHistoryCsv } from "../src/importHistoryCsv.js";

const csv = readFileSync("/home/allen/.openclaw/workspace/projects/the-storm/gymforge/workout_history.csv", "utf8");
const res = importHistoryCsv(csv, 2024);
console.log("TS:", res.imported, "imported /", res.skipped, "skipped /", res.errors.length, "errors");

// TS stored rows -> normalized key
const tsKeys = new Set<string>();
const tsRows = new Map<string, string>();
for (const r of res.rows) {
  const k = `${r.date_iso}|${r.c1.trim().toLowerCase()}|${r.c2.trim().toLowerCase()}|${r.c3.trim().toLowerCase()}`;
  tsKeys.add(k);
  tsRows.set(k, `${r.date_iso}|${r.c1}|${r.c2}|${r.c3}`);
}

// Python stored rows from fixture
const fx = JSON.parse(readFileSync("/home/allen/.openclaw/workspace/projects/gymforgeapp/fixtures/import_history_csv.json", "utf8"))[0];
const pyKeys = new Set<string>();
for (const r of fx.expected.stored_rows) {
  const d = JSON.parse(r.details)[0];
  pyKeys.add(`${r.completed_at.slice(0, 10)}|${d.c1.trim().toLowerCase()}|${d.c2.trim().toLowerCase()}|${d.c3.trim().toLowerCase()}`);
}

const extra = [...tsKeys].filter((k) => !pyKeys.has(k));
const missing = [...pyKeys].filter((k) => !tsKeys.has(k));
console.log("\nTS-extra (in TS, not Python):", extra.length);
extra.slice(0, 12).forEach((k) => console.log("  +", k));
console.log("\nTS-missing (in Python, not TS):", missing.length);
missing.slice(0, 12).forEach((k) => console.log("  -", k));
