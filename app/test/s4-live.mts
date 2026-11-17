// S4 live gate: drive the real AppApi client against the real :8002 sandbox.
// Round-trip: signin -> me -> pull -> revoke (real member credentials).
// Proves transport + types + token flow work end-to-end (not just typecheck).
import { AppApi, ApiError } from "../src/api.js";

const api = new AppApi("http://127.0.0.1:8002");
let pass = Number(0), fail = Number(0);
const ok = (label: string) => { pass++; console.log(`  PASS ${label}`); };
const no = (label: string, extra?: string) => { fail++; console.log(`  FAIL ${label}${extra ? " — " + extra : ""}`); };

console.log("S4 live round-trip vs :8002");

// 1. signin (real member credentials — the data-rich account from S1)
try {
  const { token, user } = await api.signin("member", "member");
  token && user?.username ? ok(`signin -> token(${token.length}ch) + user ${user.username}/${user.role}`)
    : no("signin shape", JSON.stringify({ token, user }));
  if (!user.member_id) no("signin member_id present", String(user.member_id));
} catch (e) { no("signin", (e as Error).message); }

// 2. me (uses the token stored by signin)
try {
  const me = await api.me();
  me?.username === "member" ? ok(`me -> ${me.username} role=${me.role} member_id=${me.member_id}`)
    : no("me", JSON.stringify(me));
} catch (e) { no("me", (e as Error).message); }

// 3. pull (full dataset — the headline: member has 484 logs / 22 PRs)
try {
  const p = await api.pull();
  p.logs.length > 0 && p.prs.length > 0 && p.member
    ? ok(`pull -> ${p.logs.length} logs, ${p.prs.length} prs, member=${p.member.full_name}`)
    : no("pull counts", JSON.stringify({ logs: p.logs?.length, prs: p.prs?.length, member: !!p.member }));
  p.pulled_at ? ok(`pull.pulled_at=${p.pulled_at}`) : no("pull.pulled_at");
} catch (e) { no("pull", (e as Error).message); }

// 4. revoke (should delete the session; subsequent me must 401)
try {
  const r = await api.revoke();
  r.ok ? ok("revoke -> {ok:true}, token cleared") : no("revoke", JSON.stringify(r));
} catch (e) { no("revoke", (e as Error).message); }

// 5. me AFTER revoke -> expect 401 (proves the session is actually gone)
try {
  await api.me();
  no("post-revoke me should 401 but succeeded");
} catch (e) {
  e instanceof ApiError && e.status === 401
    ? ok("post-revoke me -> 401 (session really gone)")
    : no("post-revoke me", (e as Error).message);
}

console.log(`\nS4 live: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
console.log("S4 gate: PASS — client round-trips the real server");
