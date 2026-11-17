// S5 live gate: local store + API client together, full-adopt round-trip vs :8002.
// Flow: snapshot -> pull -> loadFromPull -> toSyncPayload -> sync -> re-pull (confirm
// server adopted) -> verify counts -> RESTORE snapshot.
import { AppApi } from "../src/api.js";
import { localStore } from "../src/localStore.js";
import type { PullResult } from "../src/apiTypes.js";

const api = new AppApi("http://127.0.0.1:8002");
const tally = { p: 0, f: 0 };
const ok = (l: string) => { tally.p = tally.p + 1; console.log("  PASS " + l); };
const no = (l: string, x?: string) => { tally.f = tally.f + 1; console.log("  FAIL " + l + (x ? " — " + x : "")); };

console.log("S5 live: store + client full-adopt round-trip vs :8002");

// 0. signin + snapshot member 7's REAL dataset (so we can restore)
const { user } = await api.signin("member", "member");
const before = await api.pull();
const snapshot: PullResult = JSON.parse(JSON.stringify(before));
console.log(`  [snapshot] member ${user.member_id}: ${before.logs.length} logs, ${before.prs.length} prs (will restore at end)`);

// 1. loadFromPull: server dataset -> local store
localStore.loadFromPull(before);
const c1 = localStore.counts();
c1.logs === before.logs.length && c1.prs === before.prs.length
  ? ok(`loadFromPull -> store has ${c1.logs} logs, ${c1.prs} prs (matches pull)`)
  : no("loadFromPull counts", JSON.stringify(c1));

// 2. toSyncPayload: store -> complete dataset (what sync sends)
const payload = localStore.toSyncPayload();
payload.logs.length === before.logs.length && payload.prs.length === before.prs.length
  ? ok(`toSyncPayload -> ${payload.logs.length} logs, ${payload.prs.length} prs (complete)`)
  : no("toSyncPayload counts");
// round-trip integrity: a sample log's details must survive store->payload
const sample = payload.logs[0];
Array.isArray(sample?.details)
  ? ok(`toSyncPayload details round-trips (sample.details is array, len=${sample.details.length})`)
  : no("toSyncPayload details", typeof sample?.details);

// 3. sync (full-adopt): send the store's complete dataset to the server
const syncRes = await api.sync(payload);
ok(`sync -> adopted ${syncRes.logs} logs / ${syncRes.prs} prs (replaced ${syncRes.replaced.logs}/${syncRes.replaced.prs})`);

// 4. re-pull: server now reflects the adopted dataset (counts must match)
const after = await api.pull();
after.logs.length === before.logs.length && after.prs.length === before.prs.length
  ? ok(`re-pull -> server has ${after.logs.length} logs / ${after.prs.length} prs (full-adopt held)`)
  : no("re-pull counts", `${after.logs.length}/${after.prs.length}`);

// 5. full-adopt SEMANTICS: mutate the store (drop 1 log), sync, confirm server drops it
const pruned = localStore.toSyncPayload();
pruned.logs = pruned.logs.slice(0, pruned.logs.length - 1); // delete last log locally
const sync2 = await api.sync(pruned);
const after2 = await api.pull();
after2.logs.length === before.logs.length - 1
  ? ok(`deletion-by-omission -> server now ${after2.logs.length} logs (1 dropped, as expected)`)
  : no("deletion-by-omission", `server ${after2.logs.length}, expected ${before.logs.length - 1}`);

// 6. RESTORE the real dataset (full-adopt the snapshot back)
const restored = await api.sync({ logs: snapshot.logs, prs: snapshot.prs, game_scores: snapshot.game_scores });
const final = await api.pull();
final.logs.length === before.logs.length && final.prs.length === before.prs.length
  ? ok(`RESTORED -> server back to ${final.logs.length} logs / ${final.prs.length} prs (snapshot adopted, ${restored.synced_at})`)
  : no("restore", `${final.logs.length}/${final.prs.length}`);

await api.revoke();
console.log(`\nS5 live: ${tally.p} pass, ${tally.f} fail`);
if (tally.f > 0) process.exit(1);
console.log("S5 gate: PASS — store + client full-adopt round-trip verified, data restored");
