# 🦈 Unguided — by Doug Labs

**Unguided IS the OpenGym member surface** — a React Native (Expo) phone app, developed
browser-first, backed by the **DougLabs Sandbox** (a frozen dev replica of the live 8001
Storm/GymForge server). This file is the **startup + orientation source of truth**.

> Contract / phase plan: [`UNGUIDED-PLAN.md`](UNGUIDED-PLAN.md) (Phase 3.0 = the OpenGym build).
> Live status board: `../../ACTIVE-PLAN.md`. Daily investigation logs: `../../memory/YYYY-MM-DD.md`.

---

## 🗺️ Layout

| Path | What |
|------|------|
| `app/` | **The app** — Expo React Native (web + native). Entry `app/App.tsx`. Screens in `app/screens/`, data layer in `app/src/`. |
| `app/start-metro-web.sh` | Metro (web dev loop) launcher — `cd app && npx expo start --web --port 8091 --lan`. |
| `app/ANDROID-BUILD.md` | Release APK build procedure (arm64-only, 30 MB) + deploy to 8001 + shipped/. |
| `app/EXPO-GO-IOS.md` | Expo Go iOS/iPad setup (portproxy + Tailscale funnel). |
| `src/` `test/` `fixtures/` | TS core (572/572 fixture suite) — the business logic, run under Metro tsx. |
| `../douglabs_sandbox/` | **The backend** (8002). Self-contained Storm/GymForge replica + the `/app/*` Unguided API. |
| `dougs_backups/` | Pre-edit backups (one per file, `.pN` suffix). **Always back up before editing.** |

**Ports (all localhost):**

| Port | Service | Notes |
|------|---------|-------|
| **8002** | DLsandbox backend | Dev replica of 8001. Serves `/app/{signin,pull,sync,me,revoke}` — gate-exempt, auth-gated by `X-Gym-Token`. Also `/gymforge` + `/api/gymforge/*`. |
| **8091** | Metro (Expo web) | The browser dev loop for the phone app (watch mode, hot-reload). |
| 8001 | Storm / GymForge (frozen) | **Live reference — NEVER touch.** Visual source of truth for the look. |
| 8081 | Qwen archivist LLM | Memory/compaction. **Never touch.** |

**Key architecture decision (10-23):** *Phone is the true source, server is backup.* Sign-in
auto-pulls the full dataset; manual sync **full-adopts** the phone's complete dataset onto the
server (replace, no merge/cursor/uuid/soft-delete/conflict-resolution). A record not sent = dropped.
Sync is one direction.

---

## 🔁 Startup / Relaunch (copy-paste, proven 10-24)

_Use when 8002/8091 are down (WSL2 sleep/restart kills them). Verify at the bottom._

### 1. Backend — 8002 (DLsandbox)
```bash
cd ~/.openclaw/workspace/projects/douglabs_sandbox
source venv/bin/activate
python3 web_server.py
```
**tmux (preferred — survives shell close; `tmux ls`, `tmux kill-session -t DLsandbox`):**
```bash
cd ~/.openclaw/workspace/projects/douglabs_sandbox
tmux new-session -d -s DLsandbox -x 200 -y 50 'venv/bin/python web_server.py 2>&1 | tee /tmp/dlsandbox-8002.log; tail -f /dev/null'
```
- **Logs:** `/tmp/dlsandbox-8002.log`. Startup is good when you see
  `GymForge routes registered (/gymforge + /api/gymforge/* + /app/*)`.
- **DB:** `douglabs_sandbox/gymforge/gymforge.db` (self-contained).
- ⚠ **`.env` has a duplicate `STORM_DIR`** — dotenv uses the **last** one, which is
  `douglabs_sandbox` (so it points at its own DB, not the frozen 8001). **Do not "fix" this** —
  it's load-bearing.

### 2. Frontend — 8091 (Metro / Expo web)
```bash
cd ~/.openclaw/workspace/projects/unguided/app
bash start-metro-web.sh          # == npx expo start --web --port 8091 --lan
```
**Quick one-liner (nohup) — fine for a check, but dies with the shell:**
```bash
cd ~/.openclaw/workspace/projects/unguided/app
nohup npx expo start --web --port 8091 --clear >metro-8091.log 2>&1 & echo "metro pid $!"
```
**tmux (preferred — killable/restartable):**
```bash
cd ~/.openclaw/workspace/projects/unguided/app
tmux new-session -d -s metro -x 200 -y 50 'bash start-metro-web.sh 2>&1 | tee /tmp/metro-8091.log; tail -f /dev/null'
```
- **Logs:** `/tmp/metro-8091.log` (tmux) or `app/metro-8091.log` (nohup).
- Open in browser: **http://localhost:8091** → sign in `member` / `member` (seeded member #7,
  484 logs / 22 PRs).
- ⚠ **NEVER `pkill -f "expo start"` inside the same `exec` that also launches Metro** — the
  pattern matches the exec's own shell → SIGTERM aborts the whole command (hit 10-24). To stop
  Metro, kill the tmux session: `tmux kill-session -t metro`.

### 3. Verify both are up
```bash
curl -s -o /dev/null -w "8002 signin: %{http_code}\n" -X POST http://127.0.0.1:8002/app/signin \
  -H 'Content-Type: application/json' -d '{"username":"member","password":"member"}'   # 401 = alive (auth responding); 200 only on valid creds
curl -s -o /dev/null -w "8091 metro:  %{http_code}\n" http://localhost:8091/                  # 200 = serving
```

---

## 🧩 The `/app/*` API (8002 → app)

| Endpoint | Purpose |
|----------|---------|
| `POST /app/signin` | `{username,password}` → `{token, user}`. Start every session here. |
| `GET /app/pull` | Full dataset for the signed-in member (`X-Gym-Token`): `{member, logs, prs, pulled_at}`. |
| `POST /app/sync` | **Full-adopt** the phone's dataset onto the server (replace). |
| `GET /app/me` | Current member profile. |
| `POST /app/revoke` | Revoke the token (Sign out). |

All `/app/*` are **gate-exempt** (no Storm entry gate) but **auth-gated** by the `X-Gym-Token`
header from `/app/signin`.

---

## ⚠️ Known data caveat (S3 will fix)

484/485 member logs store `details` as a **double-encoded corrupt string** `'"[]"'` (decodes to
an *empty* array) — a server-side serialization bug that predates this project. `8002 /app/pull`
returns the raw mangled value. Only 1 log has real sets. The app's `parseDetails`
(`app/src/localStore.ts`) JSON-parses once → gets a string → returns `[]`, so set-less logs show
"—". **Fix is bundled into Phase 3.0 S3 (Enter Workout)** since that screen writes the real values.
Detail: `../../memory/2026-10-23.md` (21:16) + `UNGUIDED-PLAN.md` §Phase 3.0 (S3-note row).

---

## 📚 Pointers
- **Phase 3.0 step plan (S1–S7) + gates:** `UNGUIDED-PLAN.md` §Phase 3.0.
- **What's done / next:** `../../ACTIVE-PLAN.md` (Unguided workstream).
- **Setup-specifics (browser tool, messaging, install protocol):** `../../TOOLS.md`.
- **Backups:** `dougs_backups/<file>.pN` — back up before every edit.
