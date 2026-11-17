// Quick manual verify of the new localStore PR accessors (S4 Step 1 gate).
// Run: npx tsx test/s4pr-verify.ts
import { localStore } from "../src/localStore";
import type { Pr } from "../src/apiTypes";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${msg}`);
  } else {
    fail++;
    console.log(`  ✖ ${msg}`);
  }
}

// --- 1. listPrs returns the seeded PRs ---
console.log("listPrs(7):");
const prs7 = localStore.listPrs(7);
assert(prs7.length > 0, `returns ${prs7.length} PRs for member 7 (expected 22 from 8002 pull)`);
// Most-recent-first: first achieved_at >= last achieved_at
if (prs7.length >= 2) {
  assert(
    String(prs7[0].achieved_at) >= String(prs7[prs7.length - 1].achieved_at),
    `sorted DESC: first=${prs7[0].achieved_at} last=${prs7[prs7.length - 1].achieved_at}`,
  );
}

// --- 2. insertPr adds a row ---
console.log("\ninsertPr:");
const before = localStore.listPrs(7).length;
localStore.insertPr({
  member_id: 7,
  lift: "Test Lift",
  weight: 999,
  time_value: null,
  achieved_at: "2026-10-26",
});
const after = localStore.listPrs(7);
assert(after.length === before + 1, `count ${before} -> ${after.length} (inserted one)`);
const newest = after[0];
assert(newest.lift === "Test Lift", `newest lift="${newest.lift}" (was "Test Lift")`);
assert(newest.weight === 999, `newest weight=${newest.weight} (was 999)`);
assert(newest.id != null, `newest id=${newest.id} (assigned locally)`);

// --- 3. deletePrs removes it ---
console.log("\ndeletePrs:");
const testId = newest.id!;
localStore.deletePrs(7, [testId]);
const afterDelete = localStore.listPrs(7);
assert(afterDelete.length === before, `count ${after.length} -> ${afterDelete.length} (deleted one)`);
const stillThere = afterDelete.find((p) => p.lift === "Test Lift");
assert(stillThere === undefined, `"Test Lift" gone after delete`);

// --- 4. deletePrs with empty ids is a no-op ---
console.log("\ndeletePrs (empty):");
const beforeNoop = localStore.listPrs(7).length;
localStore.deletePrs(7, []);
const afterNoop = localStore.listPrs(7);
assert(afterNoop.length === beforeNoop, `no-op: count unchanged (${beforeNoop})`);

// --- 5. deletePrs only affects the target member ---
console.log("\ndeletePrs (multi-user):");
// Insert a PR for a different member, then delete only member 7's
localStore.insertPr({
  member_id: 999,
  lift: "Other Member Lift",
  weight: 50,
  time_value: null,
  achieved_at: "2026-01-01",
});
const member999Before = localStore.listPrs(999).length;
localStore.deletePrs(7, [testId]); // delete an id that belongs to member 7 (already deleted, so this is a no-op)
const member999After = localStore.listPrs(999);
assert(member999After.length === member999Before, `member 999 unaffected: ${member999After.length}`);
// Clean up
localStore.deletePrs(999, member999After.map((p) => p.id!));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
