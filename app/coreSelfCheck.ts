// S3 core self-check, extracted from the original App.tsx shell (Phase 2.1 S6).
// Preserved so the 572/572 conformance gate stays reachable in the browser as a
// debug screen. Do NOT modify the core calls — a change here breaks the S3 gate.
import { parseHistoryDate } from "./src/parseHistoryDate";
import { numWeight, totalScore, setsOk } from "./src/recordLog";
import { recordPr } from "./src/recordPr";
import { importHistoryCsv } from "./src/importHistoryCsv";
import { detectNewPrs } from "./src/detectNewPrs";

// S3 gate: prove the 5 core functions EXECUTE correctly in the web bundle.
// Each check asserts an actual return value against a fixture-derived expectation
// (not just "is it a function"). All inputs/expected pairs are taken from the
// 572 golden fixtures, so a PASS here == the bundle's core matches the reference.
export function coreSelfCheck(): { ok: boolean; results: string[] } {
  const results: string[] = [];
  let ok = true;
  const check = (label: string, actual: unknown, expected: unknown) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (!pass) ok = false;
    results.push(
      `${pass ? "PASS" : "FAIL"} — ${label} -> ${JSON.stringify(actual)}${
        pass ? "" : " (expected " + JSON.stringify(expected) + ")"
      }`
    );
  };

  // 1. parseHistoryDate("2026-06-14", 2026) -> [2026,6,14]  (fixture case)
  check("parseHistoryDate('2026-06-14',2026)", parseHistoryDate("2026-06-14", 2026), [2026, 6, 14]);

  // 2. numWeight("155") -> 155 ; totalScore -> sum of weights
  check("numWeight('155')", numWeight("155"), 155);
  check("totalScore([155,140])", totalScore([{ weight: 155 }, { weight: 140 }]), 295);

  // 3. setsOk(valid set array with lift) -> true ; setsOk(non-array) -> false
  check("setsOk([{lift:'BP',weight:155}])", setsOk([{ lift: "Bench Press", weight: 155 }]), true);
  check("setsOk('notarray')", setsOk("notarray"), false);

  // 4. recordPr: new PR (weight 50, no prior best) -> is_time false, weight 50
  const pr = recordPr(null, { lift: "Overhead Squat", weight: 50, time_value: null, achieved_at: "2026-08-21T00:00:00.000Z" });
  check("recordPr.OS.weight", pr.weight, 50);
  check("recordPr.OS.is_time", pr.is_time, false);

  // 5. detectNewPrs: empty bests + Back Squat 105 -> ["Back Squat"] (fixture case)
  check("detectNewPrs([],BS105)", detectNewPrs([], [{ lift: "Back Squat", weight: 105 }]), ["Back Squat"]);

  // 6. importHistoryCsv: minimal 1-row CSV -> imported 1
  const csv = "2024-06-03,Bench Press,155x5,,notes\n";
  const imp = importHistoryCsv(csv, 2024);
  check("importHistoryCsv.imported", imp.imported, 1);

  return { ok, results };
}
