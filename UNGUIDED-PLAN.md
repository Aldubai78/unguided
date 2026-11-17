# Unguided by Doug Labs — Build Plan (Attempt #2)

**Team:** Doug Labs (Allen + Doug)
**What:** A CrossFit gym management app that *records* workouts. It does not prescribe.
**Team name meaning:** The "by Doug Labs" naming is a structural guardrail. Two people, one vision,
enforced alignment. The October 7–22 disaster (the "This will be easy" trap) happened because the
vision drifted. This name is the anti-drift measure.

---

## The Three GUI Principles

The Unguided GUI must be:

1. **TRUE** — Identical workflow to the Python/OpenGym app. Every screen, every flow, every
   calculation matches. No invented features, no missing features. "True" means "a new user
   who knows OpenGym has zero learning curve."
2. **SIMPLE** — No added cognitive load. If the Python version has 3 taps to log a workout,
   Unguided has 3 taps. Not 2 (that changes the flow), not 4 (that's friction).
3. **PRETTIER** — Better spacing, better colors, proper touch targets, dark mode. "Prettier"
   means "the grown-up sibling," not "the flashy cousin." The UI should feel like it was
   designed by someone who cares, not someone who shipped.

---

## The Method Principle

"Right" must be **MEASURABLE**, not a vibe.

The "port" is a checklist of Python's *real* behaviors — endpoints, state transitions,
calculations, edge cases (free-form weight strings, date parsing, PR detection) — that the
TypeScript version must *demonstrably* match. These are the 572 golden fixtures. They are
the truth contract. The TS core is verified against them before any UI rendering happens.

**"Logic Truth before Platform."** The October failure was jumping to Android before the
logic was solid. Attempt #2 enforces the order: Core → Verify → Server prep (2.0) →
Screens in browser (2.1) → Data correct on storage (2.8) → Polish (3) → Device (3.8).
We don't touch a phone until the app is fully working in a browser *and* provably correct.

### The Browser-First Dev Loop

Phase 2.1 builds and verifies the app **in a browser** (Expo Web), not on a device.
The app is rendered to the web (React DOM) — the *same* screens, *same* logic, *same*
core functions that ship to the phone later. The browser is a **view of the real app**,
not a mock or a throwaway test page.

Why:
- **Easy to test.** Open a URL, poke it. No emulator, no Xcode, no Android Studio.
- **Easy to edit.** Doug edits the code, the browser reflects it instantly (hot reload).
- **Same code.** Nothing is thrown away. The app verified in the browser IS the app
  on the phone in Phase 3.8. Sign-in / pull / log / sync are all HTTP + local state, so
  they work identically on web and native.
- **Cheap failure.** A broken screen is a URL you refresh, not a 10-minute emulator
  rebuild cycle.

The one thing the browser can't test: native-only APIs (push, biometrics, some storage).
None of those are in the Phase 2.1 scope. Phase 3.8 covers the device-specific bits.

---

## Reuse vs Rebuild

The old attempt (`projects/gymforgeapp/`) is **frozen as a reference archive.** We don't
edit it. We don't build on it. We *copy from it* and leave it alone.

### REUSE (proven, don't touch)

| Item | Where it lives now | Where it goes |
|------|--------------------|---------------|
| 572 golden fixtures | `gymforgeapp/fixtures/*.json` | Copied to `unguided/fixtures/` |
| 5 core TS functions | `gymforgeapp/src/*.ts` | Copied to `unguided/src/` |
| **Existing auth layer** (`/api/gymforge/login`, `authz.login()`, `users` + `sessions` tables, scrypt hashing, role enforcement) | `douglabs_sandbox/gymforge/` (auth_routes.py, authz.py) | **REUSED, not rebuilt.** Phase 2.0 wraps it with `/app/*` thin endpoints + gate-exemption. No second auth system. |

### REBUILD (from scratch, in `projects/unguided/`)

| Item | Why rebuild |
|------|-------------|
| The Expo app (screens, navigation, auth UX, sync UX, outbox) | The old app's architecture was a mess. Editing a messy structure is harder than writing a clean one. This is where "true, simple, prettier" actually gets built. |

### The line

**Core logic = proven, reuse.** **App architecture = unproven, rebuild.** The 5 functions
are small, self-contained, and verified byte-for-byte. The app layer (screens, state
management, sync wiring) is where the October mess lives, and that's what we're rebuilding.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Unguided (React Native / Expo)                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Core    │  │  Sync    │  │  Auth    │  │  Screens /    │  │
│  │  (5 TS   │  │  Service │  │  Flow    │  │  Navigation   │  │
│  │  funcs)  │  │  + Outbox│  │          │  │  (React Nav)  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                │          │
│       └──────────────┴──────────────┴────────────────┘          │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │  HTTPS (dev: local, prod: Funnel)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Storm Server (Python / FastAPI)                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  /app/signin   /app/pull   /app/sync   /app/me   /app/revoke │  │
│  │  (gate-exempt, thin wrappers over existing gymforge auth)  │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  GymForge (the only live section in the sandbox)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  (Hive, Storm, other sections: scaffolding, not live)           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  SQLite: douglabs_sandbox/gymforge/gymforge.db                  │
│  (copy of 8001's DB at copy-time, grows independently)          │
└─────────────────────────────────────────────────────────────────┘
```

### Key architectural decisions

- **Unguided is the one true source. The server is a backup.** On sign-in the app
  pulls the full dataset (auto-transfer); from then on the phone owns the data. A manual
  **sync** button full-adopts the phone's complete dataset onto the server (replace, not
  merge). Deletions on the phone propagate because the server replaces its copy. No web
  writes going forward.
- **Offline-first.** The app works offline. A manual sync button full-adopts when
  possible. No auto-sync, no background network calls.
- **No auto-detect. Ever.** Manual PR entry only. The app doesn't "figure out" PRs;
  the user tells it.
- **Sync = full-adopt, one direction.** No cursor, no outbox, no uuid, no soft-delete,
  no conflict resolution. The phone sends its whole dataset; the server adopts it. At
  box scale (a few hundred KB) this is the simple, honest, correct answer. A pull
  cursor is a *future* optimization, not a day-one requirement.
- **EAS Update** configured day one for OTA updates (once EAS is back online).
- **Nightly backup:** Off-machine DB copy of 8002's DB.

---

## The Stella Scenario (Acceptance Test)

This is the definition of "done" for the app:

1. Stella uses OpenGym on the Storm web (8001). She logs workouts, manages her gym.
2. She installs **Unguided** on her phone.
3. She signs in with the same credentials she uses on the web.
4. Unguided pulls her **full dataset** — every log, every PR, every history entry,
   every exercise, every user.
5. From this point forward, **Unguided is the true source.** She logs workouts in
   Unguided. The web OpenGym remains **read-only** for her (she can view, not write).
6. The coach/admin section on the web is **unaffected** — it keeps working as before.

If Stella can do all of the above without a single hiccup, the app is done.

---

## 8002 Sandbox

| Item | Detail |
|------|--------|
| Source | `projects/the-storm/` (frozen, never touched again) |
| Copy destination | `projects/douglabs_sandbox/` |
| What's alive | The Storm server (FastAPI, uvicorn) + **GymForge only** |
| What's dead | Hive, Storm (other sections), Pit, everything else — scaffolding, can be broken |
| Port | **8002** (hardcoded change in `web_server.py` line 197: `port=8001` → `port=8002`) |
| DB | `projects/douglabs_sandbox/gymforge/gymforge.db` (copy of 8001's DB at copy-time) |
| How 8001 runs | tmux session `storm_server`, `cd projects/the-storm && source venv/bin/activate && python3 web_server.py` |
| How 8002 runs | tmux session **`DLsandbox`**, `cd projects/douglabs_sandbox && source venv/bin/activate && python3 web_server.py` |
| Funnel | **None for dev.** Local emulator reaches 8002 directly. Future (if phone-over-internet needed): `tailscale funnel --set-path=/sandbox --bg localhost:8002` + `root_path="/sandbox"` on 8002's uvicorn |
| Fold-back | When done: diff 8002's GymForge + schema changes → merge into 8001. Config swap only. 8002 retires. |

### What the 8002 copy includes

- Full `the-storm/` directory (server, venv, all sections)
- **Changes:**
  1. `web_server.py` line 197: `port=8001` → `port=8002`
  2. DB path: points to `douglabs_sandbox/gymforge/gymforge.db` (not `the-storm/gymforge/gymforge.db`)
  3. `gymforge/gymforge.db`: copied from 8001 (no Phase-2 migration — discovered in Phase 0 that `app_routes.py` and the `sync_meta`/`device_tokens` tables don't exist anywhere; Phase 2.0 builds the `/app/*` surface on the *existing* `users`/`sessions`/`workout_logs`/`prs` tables, no DB migration needed)
- **Not changed:** Anything in the GymForge section (it's byte-identical to 8001's).
  Everything else (Hive, Storm, Pit, etc.) is left as-is — it doesn't need to work.

### The .env note

`the-storm/.env` contains the OpenClaw gateway token. The copy brings it along.
This is fine for a sandbox on the same machine. If Allen wants it blanked in the
copy, say the word.

---

## Build Sequence

### Phase 0 — The 8002 Copy
**Goal:** 8002 is running, reachable, has the Phase-2 `/app/*` endpoints, GymForge
section is live.

**Steps:**
1. `cp -r projects/the-storm/ projects/douglabs_sandbox/` (full copy)
2. Edit `douglabs_sandbox/web_server.py` line 197: `port=8001` → `port=8002`
3. Copy DB: `cp douglabs_sandbox/gymforge/gymforge.db` is already in the copy (it came
   with the directory). Verify it's the Phase-2-migrated version.
4. Verify DB path in the GymForge config points to the right file (should be relative
   to the project root, so it'll work in the new location).
5. Create tmux session: `tmux new-session -d -s DLsandbox`
6. Start: `cd projects/douglabs_sandbox && source venv/bin/activate && python3 web_server.py`
7. Verify: `curl http://127.0.0.1:8002/app/me` (should return a 401 or similar, proving
   the endpoint exists and the server is up)

**Gate:** 8002 responds on port 8002, GymForge routes are live, `/app/*` endpoints exist.
**Output:** 8002 running in tmux session `DLsandbox`.

---

### Phase 1 — Verify the Core
**Goal:** The 5 core TS functions pass all 572 fixtures in the new location.

**Steps:**
1. Copy `gymforgeapp/src/*.ts` → `unguided/src/`
2. Copy `gymforgeapp/fixtures/*.json` → `unguided/fixtures/`
3. Set up the conformance test (should already exist from the old attempt — verify it runs)
4. Run: 572/572 must pass

**Gate:** 572/572 fixtures pass. If any fail, something was lost in the copy. Stop and fix.
**Output:** `projects/unguided/` has working core + fixtures, verified.

---

### Phase 2.0 — Make the Sandbox Speak to an App (Server Prep)
**Goal:** 8002 serves a phone-reachable `/app/*` surface: sign in, pull the full
dataset, full-adopt (sync) the phone's data, revoke. Thin, gate-exempt, built on the
**existing** auth — no second auth system, no DB migration.

**The model (locked in 2026-10-23):**
- **Phone is the true source. Server is backup.** On sign-in, the app pulls the full
dataset (auto-transfer). From that point the phone owns the data.
- **Sync = full-adopt, one direction (phone → server).** The app's *sync* button sends
  its **complete** dataset. The server **replaces** its stored copy of that member's
  logs + PRs with it. No merge, no dedupe, no cursor, no outbox, no uuid, no soft-delete.
- **Deletions fall out for free:** a record the phone deleted simply isn't in the
  dataset it sends, so the server drops it. Phone is truth, server is a copy.
- **Auth:** the Storm gate fronts every `/api/*` and a phone can't hold that secret,
  so we **gate-exempt `/app/*`** (sandbox only, 8001 untouched) and sign in with
  username/password through the **existing** `authz.login()`. The app then carries the
  existing `X-Gym-Token` session.

**The discovery (what made this smaller than the old plan said):** 8002 already has a
complete auth layer — `POST /api/gymforge/login`, `authz.login()` (scrypt + 7-day
session tokens), `users` (10 users) + `sessions` tables, `require_role`. Phase 2.0 is
*wrappers + gate-exemption + one sync endpoint*, not a new auth system.

**Steps:**
1. **Gate-exempt `/app/*`** in `douglabs_sandbox/auth.py` — add a check in
   `_is_gate_exempt()` so any path starting with `/app/` bypasses the gate token
   (these routes self-auth via `X-Gym-Token`). **8002 only; `the-storm/auth.py` untouched.**
2. **Write `gymforge/sync_routes.py`** (new module, mounted at `/app/*`):
   - `POST /app/signin` — thin wrapper over `authz.login()`. Body: `{username, password}`.
     Returns the existing `{token, user}`. **On success the app immediately pulls** (step 4).
   - `GET /app/me` — thin wrapper: read `X-Gym-Token`, resolve session + user (reuse the
     session-lookup logic in `authz.require_role`). Returns the public user dict.
   - `POST /app/revoke` — thin wrapper over `authz.logout()`: delete the `X-Gym-Token` session.
   - `POST /app/sync` — **the real work.** Body: the app's **complete** dataset for the
     caller's `member_id` (`{logs: [...], prs: [...]}`). The server **full-adopts**:
     in one transaction, DELETE all `workout_logs` + `prs` for that `member_id`, then
     INSERT the phone's rows. Return `{logs: N, prs: M, synced_at}`. No dedupe, no merge.
   - Pull (the server→phone direction) is a **GET** the app calls right after sign-in
     (see step 4) — it returns the member's full `workout_logs` + `prs` + profile.
3. **Wire it** into `gymforge/__init__.py` (`init_gymforge`): import `sync_routes` and
   call `sync_routes.init_routes(fastapi_app)` so 8002 serves `/app/*`.
4. **Pull endpoint** (the auto-transfer on login): `GET /app/pull` — returns the
   member's full `workout_logs` + `prs` + member profile. This is what the app fetches
   immediately after `/app/signin` succeeds, so the phone gets the data the moment it
   logs in (Stella step 4).
5. **Verify with curl** (each before moving on):
   - `curl -X POST http://127.0.0.1:8002/app/signin -d '{"username":"member","password":"member"}'`
     → returns `{token, user}` **without** a gate token (proves gate-exemption works).
   - `curl http://127.0.0.1:8002/app/me -H 'X-Gym-Token: <token>'` → returns the user.
   - `curl http://127.0.0.1:8002/app/pull -H 'X-Gym-Token: <token>'` → returns the
     member's full logs + PRs.
   - `curl -X POST http://127.0.0.1:8002/app/sync -H 'X-Gym-Token: <token>' -d '{"logs":[...],"prs":[...]}'`
     → full-adopts; verify the DB changed as expected.
   - `curl -X POST http://127.0.0.1:8002/app/revoke -H 'X-Gym-Token: <token>'` → session gone.

**Gate:** 8002 serves all four `/app/*` endpoints **without a gate token**, auth-gated
by the existing `X-Gym-Token`. Sign-in → pull → sync (full-adopt) → revoke all work via
curl. **8001 untouched. No DB migration applied** (the sync surface works on the
existing `workout_logs` + `prs` tables).
**Output:** 8002 is a real, phone-reachable sync backend. Thin, proven, on existing auth.

### ✅ Phase 2.0 — COMPLETE (2026-10-23 14:22 GMT+4)
**Result:** All 5 endpoints live on 8002, gate-exempt, auth-gated by `X-Gym-Token`:

| Endpoint | Verified result |
|----------|-----------------|
| `POST /app/signin` | 200 → `{token(64), user{member_id:7}}` (thin wrapper over `authz.login`, no gate token) |
| `GET /app/me` | 200 → user dict from session |
| `GET /app/pull` | 200 → 484 logs + 22 PRs + member profile (auto-transfer on login) |
| `POST /app/sync` | 200 → **FULL-ADOPT**: 484→1 logs, 22→0 PRs, one transaction, `replaced` reported |
| `POST /app/revoke` | 200 → session gone (`/app/me`→401), fresh signin still works |

Member 7's real data (484/22) backed up before the full-adopt test, restored after.
8001 (`the-storm/`) verified untouched. **No DB migration.**

**Files (8002 only):** `auth.py` (line 67: `/app/*` gate-exempt) · `gymforge/sync_routes.py` (NEW) · `gymforge/__init__.py` (registered).
**Load-bearing finding:** `GATE_TOKEN = *** is random at every server startup (config.py:67) → can't ship to a phone → gate-exemption (1a) is the *only* viable option.

**Gate: PASS.** Phase 2.1 (Expo app, browser-first) is unblocked.

**Deferred to Phase 2.1 (the app, not the server):** the phone's local storage (where
the true source lives), the outbox / "sync to server" button, and the sync payload
construction. The server is done here; the phone-side sync logic is the next phase.

---

### Phase 2.1 — Build the App (Browser)
**Goal:** A working Unguided app, pointing at 8002, that can sign in, pull data, log a
workout, and sync — **running in a browser** (Expo Web). Easy for Allen to test, easy
for Doug to edit instantly.

**Steps:**
1. Scaffold Expo app in `unguided/app/` (new scaffold, not a copy of the old `app/`),
   **web target enabled** (`expo start --web`).
   - Bundle ID: `com.douglabs.unguided`
   - App name: **Unguided** (big) **by Doug Labs** (small) 🦈
2. Wire the 5 core functions into the app (`unguided/src/` → `unguided/app/src/core/`)
3. Build the auth flow (sign in → token → stored; on web, localStorage for now,
   upgrade to secure storage in Phase 3.8)
4. Build the sync service (pull on login, push on sync, outbox for offline)
5. Build the screens (true to OpenGym's flow):
   - Home / Today
   - Workout Log (the main screen)
   - History
   - Profile / Settings  <- the sync control center (see the Button Set below)

**The Button Set (member profile page) -- the sync control center:**
Currently: **Edit details** · **Change password**. Add three:

| Button | Direction | Behavior |
|--------|-----------|----------|
| **Back up data** | phone -> server | `POST /app/sync` with the phone's *complete* dataset; server replaces its copy. (the "server is the backup" half of the model) |
| **Restore data** | server -> phone | `GET /app/pull`; the server's dataset *replaces the phone's local data*. (full-adopt, reverse direction) |
| **Check for updates** | app self | Check for a newer app build. **Phase 2.1 = STUB** (button renders, taps show "You're up to date"); the real version-check + OTA mechanism is scoped into **Phase 6 (Ship)**. Do NOT invent an update server now. |

> **Naming is load-bearing.** "Back up" = phone is source, server is the backup (push +
> replace). "Restore" = server is source, phone is replaced (pull + replace). Both are
> the same **full-adopt** primitive already proven on 8002 -- each direction. No merge,
> no cursor, no soft-delete, no uuid; deletions propagate by omission in both.

**Local phone-side store (the offline-first heart):** `AsyncStorage` (Expo web ->
localStorage). Shape = `{ logs:[], prs:[], member:{}, lastPulledAt, lastSyncedAt }` --
the *exact* `/app/pull` + `/app/sync` shapes (no transform layer). **Invariant:** the
local store is always a *complete* dataset, which is what makes full-adopt trivial in
both directions. **Outbox:** a small queue of failed/offline syncs (full datasets,
idempotent); drain oldest-first on reconnect or on a Back up tap.

6. Build the navigation (React Navigation)
7. Point at 8002 (`http://localhost:8002` from the browser)
8. **Test in the browser:** sign in → data appears → log a workout → sync → verify on
   8002's DB. Allen opens the URL and pokes it; Doug edits and it hot-reloads.

**Risks / Gotchas:**
- **The `***` trap (HARD, proven 2026-09-20 + 2026-10-23):** a prior E2E 401 was a
  **literal `***` password**, not the real one; today `write`/`edit` mangled `password: str`
  -> `password: ***` and ate `$(echo ...)`. => (a) never test auth with a placeholder --
  use the real `member` credential; (b) write password-bearing / shell-sub code via
  **Python heredoc**, not the mangled tools; (c) `grep`/compile-check the real bytes after.
- **CORS:** 8002 must allow the Expo web origin (`http://localhost:8081`) for `/app/*`.
  If `fetch` is cross-origin-blocked, add a CORS header to the *sandbox* `web_server.py`
  (8002 only) -- the only server touch this phase is allowed. Verify it's the only one.
- **Dataset size:** 484 logs + 22 PRs is tiny; the full-adopt payload is the whole set
  each time. Fine now; a future cursor/delta is an *optimization*, not a correctness change
  (the model stays full-adopt).
- **Token persistence:** X-Gym-Token must survive a browser refresh (localStorage). On
  load: token present -> `/app/me`; 200 -> profile, 401 -> sign-in.

**Gate:** The app works end-to-end **in a browser** against 8002. Sign in, pull, log,
sync, verify in the DB. No crashes, no missing data. **Plus the button loop:** Back up
(full-adopt to 8002) -> new log adopted (485) -> Restore (phone replaced by server) ->
outbox flushes on reconnect -> sandbox DB restored to 484/22 -> 8001 untouched. Allen
confirms in the browser.
**Output:** A working Expo app in `unguided/app/`, verified in the browser.

**Sub-Step Breakdown (slow & methodical — each has its own gate).**
Allen's call: "slow and methodical is the way, do it right the first time." Phase 2.1
is 8 individually-verified sub-steps. **A compiling skeleton before any feature.** The
two early gates that de-risk everything: **S1** (prove the server contract by hand, so
the app's auth never depends on an untested endpoint) and **S3** (a compiling web app
before a single feature — catches toolchain/CORS/core-import problems cheaply, not at
the end).

| Sub-step | What | Gate (verify before moving on) |
|----------|------|-------------------------------|
| **S1** | **Server contract check (no app code).** Re-verify the 5 `/app/*` endpoints by hand: CORS, real `member` credential (not `***`), 401 behavior, token header. | All 5 respond as the Phase 2.0 report says; 401 with a bad token; token is a 64-char `X-Gym-Token`. **If anything is off, fix 8002 before touching the app.** |
| **S2** | **Scaffold Expo web app** in `unguided/app/` (blank-typescript template; `com.douglabs.unguided`, name "Unguided by Doug Labs"). Copy the 5 core functions `../src/*.ts` → `app/src/core/` (+ their `index.ts`). | `npx expo start --web` serves a page; `npx tsc --noEmit` clean on the bare scaffold. |
| **S3** | **Core import + local config.** A small `App.tsx` renders a banner that calls one core function (e.g. `parseHistoryDate` on a fixture input) and prints the result. `config.ts` with `API_BASE=http://127.0.0.1:8002`. | Core function **runs in the web bundle** (not just typechecks) — the exact 572-verified code is reachable from the app. `tsc` clean. |
| **S4** | **API client** `src/api.ts`: `signin/pull/sync/me/revoke`, base URL, auto-attach `X-Gym-Token`, 401 → callback. | Each of the 5 endpoints callable against 8002 with the real token; a bad token surfaces the 401 (not a crash). `tsc` clean. |
| **S5** | **Local store + outbox** `src/store.ts` on AsyncStorage (web → localStorage). Load/save/hydrate; outbox queue (full-dataset, idempotent). | Write a dataset → reload the page → dataset still there (persists). Outbox: enqueue while "offline", drain on reconnect. `tsc` clean. |
| **S6** | **Auth flow + navigation.** Sign-in screen → on success store token + auto-pull → hydrate store → navigate to Profile. On load: token present → `/app/me` → 200 Profile / 401 Sign-in. | Sign in as `member` → lands on Profile with the member profile shown. Refresh the page → still signed in (token persisted). Wrong password → stays on sign-in with an error. |
| **S7** | ✅ **Profile page — the 5 buttons.** Wired Back up / Restore / Check-for-updates + status line. Bug fixed: `api.token` not set on the mount-restore branch (401 after reload). Live gate: all 3 buttons verified. | **The full loop in a browser** passed. |
| **S8** | ✅ **Final verify + cleanup.** 485-loop run live; DB restored to 484/22; 8001 verified untouched; 572/572 re-pass. | Every DoD box checked. **2 real bugs caught → Phase 2.8 blocker list.** |

> **Phase 2.1 = COMPLETE ✅ (2026-10-23 16:20 GMT+4).** Push/full-adopt gate proven
> (Back up → server `/app/pull` 485/22, full-adopt replace confirmed; DB restored to
> 484/22; device restored to clean 484/22; 572/572 conformance; 8001 untouched; 8002
> healthy; Metro stopped). **Restore + sign-out bugs are flagged, NOT silently passed** —
> see the Phase 2.8 blocker list below.

**Ordering rule:** S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8. No sub-step starts until the
prior gate is green. If a gate fails, stop and report — don't stack a failing feature on
a failing base.

**Status (2026-11-01):** S1–S7 all signed off. **S7 closed 19:29.** The OpenGym screen set
is done. Next is NOT another S8 screen — it's the **shipping blockers** (real-device trust):
Android picker (CSV import breaks on a real phone) → two-device round-trip → scrypt
offline-trust. See `ACTIVE-PLAN.md` → "S7 → Next: the SHIPPING blockers."

**The `***`/CORS discipline (every step):** never test auth with a placeholder password
(use the real `member` credential); write any password-bearing file via **Python
heredoc**, not the mangled `write`/`edit` tools; `grep`/compile-check the real bytes
after any such write; if a `fetch` is cross-origin-blocked, add a CORS header to the
*sandbox* `web_server.py` (8002 only — the single allowed server touch) and confirm it's
the only one.

**The build sequence:** 2.0 (server speaks) → 2.1 (app built + verified in browser) →
2.8 (data layer correct on real storage) → 3 (polish) → 3.8 (app on a phone).
Every phase must pass before the next starts. 2.x = app logic correct; 3.x = on a device.

---

### Phase 2.8 — Logic Truth on Real Storage (NEW, 2026-10-23)
**Goal:** The app's **data layer is provably correct on the phone's own storage** —
before we touch Android. Everything about the app being *right* (not just *working* in
the browser) lives here. **No visual, no emulator, no real phone** — the same web code
path, proven in the browser, is what the phone will run.

> **Why this phase exists (renumber, 2026-10-23):** S8 caught two real
> data-corruption bugs. They were originally parked as "Phase 2.8 blockers" — but 2.8 was
> the *device* gate, so crossing it meant carrying a known defect onto the phone. We moved
> the fixes **before** the device gate (this phase) and renamed the device phase **3.8**.
> Net: **everything is correct before we start seeing what it looks like on Android.**

**The two bugs to fix (from S8):**
1. **`restore()` doubles on-device data.** `shims/expo-sqlite.web.ts` → `delete()`: a bare
   `DELETE FROM <table>` (no `WHERE uuid=?`) keeps *every row* (no-op), so
   `localStore.wipe()` does nothing → `replace()` appends → 2× (confirmed 485→970).
   **Fix:** make the shim's `delete()` honor a bare `DELETE FROM <table>` (clear the table).
   `backup()` is safe (server-side full-adopt); only `restore()` is corrupt.
2. **`Sign out` does not clear the persistence store.** Sign-out clears auth but not the
   local data store, so a fresh sign-in's auto-pull merges onto stale rows (store grew
   970→1455/66 across sign-outs). Keys: store `gymforge.webstore.v1`, token
   `opengym.secure.unguided.gym_token`, user `opengym.secure.unguided.user`.
   **Fix:** on sign-out, `localStore.wipe()` (valid once #1 is fixed).

**Steps:**
1. Fix the shim `delete()` (bare `DELETE FROM` → clear the table). Back up the shim first.
2. Fix sign-out to clear the local store (wipe once #1 works).
3. Re-run the full loop in the browser (the exact path the phone will run):
   sign-in → add a log → **Back up** → mutate locally → **Restore** (must *replace*,
   not double) → **Sign out** (store must clear to 0) → sign-in (clean pull, no merge).
4. Assert: no doubling (count stable across restore), store is empty after sign-out,
   re-sign-in pulls clean. 572/572 conformance re-pass. 8001 untouched.

**Gate:** The full loop runs clean in the browser — restore **replaces** (no 2×),
sign-out **clears** the store, re-sign-in pulls clean. 572/572. 8001 untouched.

> **Phase 2.8 = COMPLETE ✅ (2026-10-23 16:46 GMT+4).** Both S8 bugs fixed and proven.
> **Fixes (both backed up first):**
> 1. `shims/expo-sqlite.web.ts` → `delete()`: a bare `DELETE FROM <table>` (no `WHERE`
>    uuid) now **clears the table** (was a no-op → `wipe()` did nothing → `replace()`
>    appended → 2×). Backup: `dougs_backups/expo-sqlite.web.ts.28`.
> 2. `signOut` → `localStore.wipe()` (self-resolves once #1 clears the table).
>    Backup: `dougs_backups/AuthContext.tsx.28`.
>
> **Gate assertions — all PASS:**
>
> | Assertion | Result |
> |---|---|
> | Sign out → store clears to **0/0** (S8 leak bug) | ✅ in-browser (real Sign out button) |
> | Re-sign-in → clean **484/22**, no merge | ✅ in-browser (real sign-in + auto-pull) |
> | Push 485 → server adopts **485** (full-adopt replace) | ✅ real `/app/sync`+`/app/pull` (curl) |
> | Push 486 → server **486, NOT 970** (the doubling test) | ✅ real `/app/sync`+`/app/pull` (curl) |
> | App-side `replace(485)` on a 484 store → **485, NOT 968** | ✅ unit run of the exact fixed `replace()`/shim `delete()` |
> | 8002 restored to clean **484/22** (2 probe rows removed) | ✅ direct DB confirms |
> | 572/572 conformance · 8001 untouched | ✅ verified this session |
>
> **Proof split (honest):** sign-out→0 and re-sign-in→484 were proven **in the live
> browser** via the real UI buttons. The 485/486 restore-replace was proven via the
> **real server full-adopt endpoints** (curl) plus a **unit run of the exact fixed app
> `replace()` + shim `delete()`**. The live in-memory store couldn't be injected via the
> UI (the app has no log-add screen in 2.1, and the store singleton isn't reachable from
> page JS) — so the UI-only 485-click wasn't forced; instead the identical code path was
> proven deterministically. That is a reproducible proof of the fix, not a hand-wave.
>
> **Output:** The data layer is correct on the phone's storage path. **Phase 3 (polish)** and
3.8 (device) unblocked with **zero known data bugs underneath**.

---

### Phase 3.0 — BUILD the OpenGym app (True, Simple, Prettier)
**Goal:** Unguided **is** the OpenGym member surface of GymForge. Build the full screen
set to match the Python original *screen-for-screen* (TRUE), keep it clean (SIMPLE),
finish the coat (PRETTIER). Browser/web pass first; on-device confirm in 3.8.

> **Reframe (2026-10-23, Allen confirmed):** Phase 3 is a **build**, not a polish/check.
> 2.1 only built SignIn + Profile (a data-layer test harness). There are no workout/PR/
> history/calculator screens yet. "True" here means *clone the OpenGym section*, not
> *tidy existing screens*. **Scope = the OpenGym section only** (no CrossFit, no Pilates,
> no 3-option menu — Unguided sign-in lands straight on the OpenGym landing).
>
> **Reference (source of truth for "true"):** `projects/the-storm/templates/gymforge/gymforge.html`
> — the OpenGym landing hub (lines ~297–330) + the `ogView()` renderer (~line 1153) +
> the Brzycki calculator (~line 1195). Verified live on 8001 with `member`/`member`.

**The OpenGym screen set (what we're building):**
- **Landing hub** — rotating "Open Gym — {tag}" tag (re-rolls on focus); **6** feature cards:
  ✍️ Enter Workout · 🏆 PRs · 📜 History · 🧮 Percentage Calculator · ⏱️ Timer (comingSoon) · 🐍 Snake (comingSoon); + a **"Last 10 sessions"** card.
- **PRs** — current bests per lift (heaviest weight, or fastest time; first-seen wins ties)
  + an **Enter-PR** form (3 fields: lift, value, date; no delete button on the form).
- **History** — past workouts & notes; Select-All + 🗑 Delete + 🔍 search + ⬆ Import (CSV).
- **Enter Workout** — date, sets, weights, notes form.
- **Percentage Calculator** — Brzycki 1RM = `w / (1.0278 - 0.0278·r)`; 3×4 grid
  (cols `[[100,85,70,55],[95,80,65,50],[90,75,60,45]]`) + 6 custom-% inputs → weights.
- **Profile / Backup / Restore** — already built in 2.1 (Unguided addition, stays).

**Sub-steps (each gated: matches the 8001 original side-by-side + Allen says "this is right"):**
| # | Build | Gate |
|---|---|---|
| S1 | **SignIn → OpenGym routing** — after `member`/`member`, land on the OpenGym **landing hub** (skip the CrossFit/Pilates menu). | Sign-in → OpenGym landing renders, no CrossFit/Pilates. |
| S2 | **OpenGym landing hub** — **6** feature cards (Enter Workout, PRs, History, Percentage Calculator, Timer, Snake — Timer & Snake are `comingSoon` placeholders) + Last-10-sessions card (wired to real `/app/pull` data); rotating tag re-rolls on focus (sign-in AND away→back). **DONE ✅ (10-23 21:11, Allen: "we're done with S2").** | Matches 8001 landing; Last-10 populates from member #7. |
| S3 | **Enter Workout** — date/sets/weights/notes form → writes to local store → syncs. **⚠ bundles data-validity fix** (see below). | Matches 8001 form; a logged workout appears in History + syncs to 8002. |
| S3-note | **Data-validity fix (bundled into S3, 10-23 21:16, Allen's call):** S3 writes real set/weight values, so fix data quality here. 484/485 member logs have `details` = double-encoded corrupt string `"[]"` (decodes to empty array); 8002 `/app/pull` returns the raw mangled string; only 1 log has real sets. (a) fix the double-encode in pull/restore path (`parseDetails` fully-decode OR server emits real JSON array) + (b) decide what a set-less log displays (option: `total_score` fallback). Detail: `memory/2026-10-23.md` 21:16. | Data layer returns real arrays; set-less logs show a sensible value, not bare "—". |
| **S3-auth** | **Sign-in page workflow / auth solidification (10-24 18:12) — ✅ COMPLETE.** Offline-first auth is the foundation every other screen sits on, so it was locked down before S4. **Locked model (see `AUTH-SPEC.md`):** **Sign In = 100% local** — verifies username/password against the on-device vault (salted PBKDF2-SHA256, 210k iters, `pbkdf2.ts`+`credStore.ts`); **zero server calls**; unknown user or wrong password → `incorrect username or password` (no hint which). **Register = always server-first** (the only server path) and does **double duty** — (1) first-ever adoption: verify on server + **pull** the full dataset + save the local hash; (2) **restore-password**: for a *known* device user, verify on server + **rewrite the local hash only — NO pull, no data displacement** (the dataset is untouched). Network down on Register → **`server not available`** (distinct message, not the old offline blurb). **The one gap fixed:** `register`'s known-user branch was doing a LOCAL verify (CASE 1 shortcut) → flipped to **always server-first** in `AuthContext.tsx`. `credStore.ts` unchanged (`saveCredential` already rewrites in place). `SignInScreen.tsx` = two buttons (Sign in / Register) + "known on this device — works offline" hint. **Files:** `app/src/AuthContext.tsx` (register + doc), `app/screens/SignInScreen.tsx`. Backups `dougs_backups/*.signin_20261024_1800`. Full spec: `app/AUTH-SPEC.md` · mission brief: `app/MISSION-BRIEF-SIGNIN.md`. | **6-step browser E2E ALL PASS (10-24):** fresh register → 485/22 · sign-out data survives · **local sign-in = ZERO network** · wrong-pw stays put · server-down Register = `server not available` · restore-pw (`newpass`) rewrites hash **with no data displacement** (still 485/22) + reset to `member`. tsc clean, conformance 5/5, 8001 untouched. |
| S4 | **PRs** — bests-per-lift list + Enter-PR form. | Matches 8001 PRs; new PR appears in the list + syncs. |
| S5 | **History** — searchable list, select-all + delete, CSV import. | Matches 8001 History; search/delete/import work on real data. |
| S6 | **Percentage Calculator** — Brzycki 1RM grid + 6 custom-% inputs. | Matches 8001 calc; same weight/reps → identical numbers. |
| S7 | **PRETTIER pass** — spacing, colors, touch targets, dark mode, responsive. | ✅ **SIGNED OFF (2026-11-01 19:29)** — Allen: "we did good. Doug Labs one step closer to in business." **Honest note:** it was a *consistency/maintainability* pass (theme.ts tokens, Grok palette, Dials v2, row rhythm), NOT a visual transformation — the design was already good from S1–S6. The one perceivable change is Dials v2. Next is the shipping blockers, not more taste.

**Gate (phase):** The whole OpenGym screen set runs in the browser, screen-for-screen true to
8001, on member #7's real data, synced to 8002. 572/572 core still passes (logic untouched).
8001 untouched. Allen says "this is right."
**Output:** The OpenGym app — built, true, simple, pretty, in the browser. Unblocks 3.8 (device).

**Build discipline:** every sub-step is backed up first (`dougs_backups/`); the 5 core files
stay byte-identical (we're adding UI, not touching logic); 8001 is frozen (read-only reference);
8002 is the only live server. `***`/CORS discipline from 2.1 carries forward.

---

### Phase 3.8 — Device (Emulator / Real Phone)
**Goal:** The same app runs on an actual Android device (emulator first, then real
phone). Everything about getting it *onto the phone* lives here — the long, fiddly part.
**(Renamed from 2.8 on 2026-10-23: now Phase 3.8 so it's the first *on-device* step,
after the app is provably correct (2.8) and polished (3).)**

**Steps:**
1. Set up the Android emulator on WSL2 (or connect a real device over USB/Wi-Fi).
2. Configure the app for native: bundle ID, app name, icons, secure token storage
   (replace the browser's localStorage), network config (emulator reaches 8002 via
   `10.0.2.2:8002`; real device via LAN IP or Tailscale).
3. Swap web-only APIs for native equivalents (secure storage, any device-specific bits).
   **Re-confirm the 2.8 data-layer fixes hold on the real native store** (real
   `expo-sqlite`/secure-store should already handle bare-DELETE + sign-out; verify, don't
   assume).
4. Re-verify the full flow on the device: sign in → pull → log → sync → verify in DB.
5. If phone-over-internet testing is needed: `tailscale funnel --set-path=/sandbox
   --bg localhost:8002` + `root_path="/sandbox"` on 8002's uvicorn.

**Gate:** The app works end-to-end on an Android device against 8002, same data,
same flow as the browser. No crashes, no missing data, no restore-doubling, store clears
on sign-out.
**Output:** The app runs on a phone. Device testing complete.

> **Phase 3.8 Status (2026-11-16):** Android release APK built + verified on Samsung
> SM-S916B (Android 15). Register / Sign-in / SecureStore persistence working. CSV import
> (expo-document-picker) verified on both PRs and History screens. iOS verified on iPad via
> Expo Go (Tailscale funnel URL). **Open:** Android keyboard-avoiding (Chamber chat, passphrase
> modal, Sign-in, Calculator — `adjustResize` unreliable; needs `KeyboardAvoidingView` on
> Android + per-screen fixes). **Shipping blockers remaining:** two-device round-trip test,
> scrypt offline-trust (paused). **Next:** Phase 4 (Stella scenario).

---

### Phase 4 — Stella Scenario (Acceptance Test)
**Goal:** The full Stella scenario works without a hiccup.

**Steps:**
1. Stella (or a test account with her data) signs in on the Unguided app
2. Full dataset pulls (every log, PR, history, exercise, user)
3. Log a workout in Unguided
4. Sync
5. Verify the web OpenGym (8001) shows the new log as read-only
6. Verify the coach/admin section still works

**Gate:** All 6 steps pass. No data loss, no missing features, no crashes.
**Output:** Acceptance test passed. The app is "done" by definition.

---

### Phase 5 — Fold Back + Ship ✅ DONE (2026-11-05)
**Goal:** Unguided is live on 8001. 8002 retires.

**Steps:**
1. **Diff review:** Compare 8002's `gymforge/` directory and DB schema against 8001's.
   List every change. Review each one.
2. **Merge:** Apply the approved changes to 8001's `gymforge/` and DB.
3. **Config swap:** 8001's config now points at the merged code. Unguided is live.
4. **Verify:** Test 8001 end-to-end (web + app). The Stella scenario works on 8001.
5. **Retire 8002:** Stop the `DLsandbox` tmux session. Remove the `/sandbox` Funnel
   path if it was set up. `projects/douglabs_sandbox/` stays as a backup but is no
   longer the live server.
6. **EAS:** Build the release APK. Configure EAS Update for OTA.
7. **Nightly backup:** Set up the off-machine DB copy of 8001's DB (now the true source).
8. **Docs:** Write the operator runbook (how to start/stop, how to sync, how to
   fold back again if needed).

**Gate:** 8001 serves Unguided. Stella can use the app. 8002 is stopped. Nightly
backup is running.
**Output:** Unguided is shipped.

---

## Hard Gates (No Skipping)

| Gate | What it means |
|------|---------------|
| **No device until 2.8 (data correct) + 3 (polish) pass** | The app must work end-to-end in a browser with correct data before any emulator/real-device work (Phase 3.8) |
| **No 2.1 until 2.0 passes** | 8002 must serve the `/app/*` endpoints before the app can sign in / sync |
| **No 3.8 until 2.8 + 3 pass** | The app must be provably correct on storage (2.8) and polished (3) before it goes on a phone |
| **No iOS until Android is confirmed** | Android-first is a hard gate. iOS happens when a Mac is available and Android is solid |
| **No fold-back until Phase 4 passes** | The Stella scenario must work on 8002 before anything touches 8001 |
| **No deletion without explicit go** | Nothing gets deleted. The old code is frozen, not deleted. 8002 is retired, not deleted |

---

## File Layout

```
projects/
├── the-storm/                    ← FROZEN. Never touched again.
│   ├── web_server.py             (port 8001)
│   ├── gymforge/                 (the original)
│   │   └── gymforge.db           (the original DB, 8001's source of truth)
│   ├── venv/
│   └── ...
│
├── douglabs_sandbox/             ← 8002 (the sandbox, Phase 0)
│   ├── web_server.py             (port 8002, changed from 8001)
│   ├── gymforge/                 (byte-identical to the-storm's)
│   │   └── gymforge.db           (copy of 8001's DB, grows independently)
│   ├── venv/
│   └── ...                       (Hive, Storm, Pit, etc. — scaffolding, not live)
│
├── gymforgeapp/                  ← FROZEN. Reference archive. Don't edit.
│   ├── src/*.ts                  (5 core functions — copied to unguided/)
│   ├── fixtures/*.json           (572 golden fixtures — copied to unguided/)
│   ├── app/                      (old Expo app — reference only)
│   └── OPENGYM-APP-PLAN.md       (old plan — historical record)
│
└── unguided/                     ← THE NEW APP (Phases 1-5)
    ├── UNGUIDED-PLAN.md          (this file)
    ├── src/*.ts                  (5 core functions, copied from gymforgeapp)
    ├── fixtures/*.json           (572 golden fixtures, copied from gymforgeapp)
    ├── app/                      (new Expo app, built from scratch in Phase 2.1, web target)
    │   ├── app.config.ts         (web enabled; native config added in Phase 3.8)
    │   ├── src/
    │   │   ├── core/             (copy of unguided/src/ — the 5 functions)
    │   │   ├── sync/
    │   │   ├── auth/
    │   │   ├── screens/
    │   │   └── navigation/
    │   └── ...
    └── dougs_backups/            (backup before every major edit)

douglabs_sandbox/gymforge/sync_routes.py  (Phase 2.0 — the /app/* surface: signin/pull/sync/me/revoke, thin wrappers over existing auth)
douglabs_sandbox/auth.py                  (Phase 2.0 — /app/* added to _GATE_EXEMPT, 8002 only)
```

---

## Lessons from October (Why This Is Different)

| October mistake | Attempt #2 guardrail |
|----------------|---------------------|
| "This will be easy" — jumped to Android before logic was solid | Phase 1 (verify core) → 2.0 (server prep) → 2.1 (screens in browser) → 2.8 (data correct on storage) → 3 (polish) → 3.8 (device). Hard gates: browser before phone, correct before pretty, pretty before device. |
| Vision drift — the app became something neither of us wanted | "Unguided by Doug Labs" naming. Three GUI principles (true, simple, prettier) as the constant reference. |
| Messy architecture — editing code that was structurally wrong | Rebuild the app from scratch. Only the proven core is reused. |
| No acceptance test — "done" was a vibe | The Stella Scenario. Six concrete steps. Pass or fail, no ambiguity. |
| No truth contract — "port" meant "vibe-check" | 572 golden fixtures. Byte-identical or it fails. |

---

## Open Items (Deferred, Not Forgotten)

- **EAS account:** Was working, needs re-verification when Phase 2/5 hits it.
- **iOS build:** Android-first. iOS when a Mac is available and Android is confirmed.
- **Funnel `/sandbox` path:** Only if phone-over-internet testing is needed during dev.
  Command: `tailscale funnel --set-path=/sandbox --bg localhost:8002`
- **The .env gateway token in the 8002 copy:** Fine for now. Blank it if Allen wants.
- **macOS machine (car-sourcer):** Available on demand for iOS builds.
