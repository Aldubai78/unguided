# 🦈 Unguided — by Doug Labs

**Unguided IS the OpenGym member surface** — a React Native (Expo) phone app for gym members
to log workouts, track PRs, import history, and chat with the gym. Offline-first: the phone is
the source of truth, the server is a backup.

> **Status: ✅ SHIPPED (2026-11-17).** All 9 phases complete. Stella Scenario acceptance test passed.

---

## 📱 What's in the app

- **Sign in / Register / Sign out** — PBKDF2 offline verification + SecureStore token persistence
- **PRs screen** — personal records by lift, search, delete, CSV import
- **History screen** — full workout log, date dials, search, delete, CSV import
- **Log workout** — add sets/notes to any lift, auto-PR detection
- **Percentage calculator** — 1RM (Brzycki), % of 1RM, estimated 1RM from reps
- **Timer** — workout timer with audio cues
- **Chamber of Chaos** — live chat room (WebSocket)
- **Pac-Man** — canvas game with maze, ghosts, power pellets
- **Snake** — canvas game with RX/Scaled modes
- **Profile** — member info, sign out, data export

## 🏗️ Architecture

**Phone is the true source. Server is backup.**

- Sign-in auto-pulls the full dataset (member, logs, PRs, exercises)
- Manual sync **full-adopts** the phone's complete dataset onto the server (replace, no merge)
- Deletions propagate by omission — a record not sent is dropped
- No auto-sync, no conflict resolution, no UUIDs, no soft-delete
- Sync is one direction: phone → server

**Stack:** React Native (Expo) · TypeScript · expo-secure-store · expo-document-picker ·
expo-file-system · WebSocket · Canvas (games)

## 🗺️ Repository layout

| Path | What |
|------|------|
| `app/` | **The app** — Expo React Native. Entry `app/App.tsx`. Screens in `app/screens/`, data layer in `app/src/`. |
| `app/android/` | Android project (arm64-only release APK, 30 MB). |
| `app/ios/` | iOS/Xcode project. |
| `app/assets/` | Icons, splash screens, game sounds. |
| `app/shims/` | Web shims for native modules (expo-secure-store, expo-sqlite). |
| `app/test/` | App-level tests. |
| `src/` | **Core TS package** — business logic (572/572 fixture suite). |
| `test/` | Core conformance + engine tests. |
| `fixtures/` | Golden fixtures (7 JSON files, 572 assertions). |
| `shipped/` | Build artifacts (APK, Xcode zip). **Not in git.** |
| `misc/` | Non-code stragglers. **Not in git.** |

## 🔌 Backend

The app talks to the **DougLabs Sandbox** backend (port 8002) via five endpoints:

| Endpoint | Purpose |
|----------|---------|
| `POST /app/signin` | `{username,password}` → `{token, user}` |
| `GET /app/pull` | Full dataset for the signed-in member |
| `POST /app/sync` | Full-adopt the phone's dataset onto the server |
| `GET /app/me` | Current member profile |
| `POST /app/revoke` | Revoke the token (sign out) |

All `/app/*` are gate-exempt (no entry gate) but auth-gated by `X-Gym-Token`.

Backend code lives in `../douglabs_sandbox/` (separate project, port 8002, tmux `DLsandbox`).

## 🚀 Development

### Prerequisites
- Node 22+
- Expo SDK (in `app/package.json`)
- Backend on port 8002 (see `../douglabs_sandbox/`)

### Web dev loop (browser)
```bash
cd app
npx expo start --web --port 8091 --lan
```
Open `http://localhost:8091`. Sign in with seeded member credentials.

### Android (device)
```bash
cd app
./android/gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```
APK: `app/android/app/build/outputs/apk/release/app-release.apk` (30 MB, arm64-v8a).

### iOS (device)
Xcode project in `app/ios/`. Requires Apple developer account + signing config.
See `app/README-IOS-BUILD.md`.

### Expo Go (quick iOS/iPad test)
`cd app && npx expo start` → scan QR with Expo Go. Requires Tailscale funnel URL
(`EXPO_PUBLIC_SERVER_URL`) for server connectivity.

### Tests
```bash
# Core conformance (572 fixtures)
npx tsx test/conformance.test.ts

# App tests
cd app && npx tsx test/timerEngine.test.ts
```

## 📄 Key docs

| Doc | What |
|-----|------|
| [`UNGUIDED-PLAN.md`](UNGUIDED-PLAN.md) | Phase plan (0–5) + all gates + status |
| [`app/ANDROID-BUILD.md`](app/ANDROID-BUILD.md) | Android release APK build + deploy |
| [`app/README-IOS-BUILD.md`](app/README-IOS-BUILD.md) | iOS build + Xcode setup |
| [`app/EXPO-GO-IOS.md`](app/EXPO-GO-IOS.md) | Expo Go iOS/iPad setup (Tailscale) |
| [`app/AUTH-SPEC.md`](app/AUTH-SPEC.md) | Auth model (PBKDF2, SecureStore, token lifecycle) |
| [`app/AGENTS.md`](app/AGENTS.md) | App-level agent instructions |

## 🦈 Phase history

| Phase | What | Status |
|-------|------|--------|
| 0 | 8002 sandbox copy | ✅ |
| 1 | Verify core (572 fixtures) | ✅ |
| 2.0 | Server prep (`/app/*` endpoints) | ✅ |
| 2.1 | Browser app (Expo, web) | ✅ |
| 2.8 | Logic truth on real storage | ✅ |
| 3.0 | Build the OpenGym app (14 screens) | ✅ |
| 3.8 | Device (Android APK + iOS) | ✅ |
| 4 | Stella Scenario (acceptance test) | ✅ |
| 5 | Fold back + ship (8001) | ✅ |
