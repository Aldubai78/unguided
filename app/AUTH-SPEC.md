# Unguided — Device Auth Spec (AGREED 2026-10-24)

Single source of truth for the Sign-in/Register flow. Do not re-architecture; build exactly this.

## Principle
- **Sign-in is 100% LOCAL. It never touches the server (8002).** Works identically online and offline.
- **Register is the ONLY server path**, and only for first-time adoption of an existing server account onto the device.
- **Device = source of truth. Server = one-time bootstrap + backup.**

## Device vault (per user this device has ever REGISTERED)
- `username`
- **salted hash of the password** (PBKDF2-SHA256, 210k iters — NEVER plaintext)  [Allen's decision: hashed]
- the member's **pulled data** (logs, PRs) in the local store
- flag: `pulled_on_device` (has this user's data been pulled on this device?)

## Button: SIGN IN (local only — no network, ever)
1. Look up typed username in the local vault.
2. **Not in vault** → show *"not available"*. (No server call. Sign-in never asks the server.)
3. **In vault** → compare typed password to stored hash:
   - **Wrong password** → *"not available"* (online or offline — the check is purely local).
   - **Right password** → sign in from cached data. No pull, no server.

## Button: REGISTER (ALWAYS hits the server — the restore-password feature)
Register is the ONLY path that talks to 8002, and it does so **every time**.
It is also how a user RESTORES after a server-side password reset.

When Register is tapped:
1. **Is the server reachable?**
   - **NO** → show *"server not available."* Nothing changes on the device. (Register can't work offline — it must be server-confirmed.)
2. **Server reachable → verify username + password against the server:**
   - **Invalid** (e.g. still typing the old password) → error, nothing stored.
3. **Server says valid** → check if the user is known on the device:
   - **KNOWN on device** (the restore-password case) → **write the password hash ONLY.**
     **NO pull, NO data displacement** (their existing logs/PRs stay exactly as-is).
   - **NOT known** (first time on this device) → **write full credentials** (hash)
     **+ pull the member's data ONCE** (full-adopt, e.g. 484 logs / 22 PRs).
   - Now the user is "known" on the device → can sign in locally forever, including offline.

### Restore-password walkthrough (the point of this)
1. `member` forgets password → asks the **server admin** to reset it → admin gives them `newpass`.
2. On the device, type `member` / `newpass`:
   - **Sign in** → *"not available"* (device hash is still for the old `member` password; sign-in is local-only).
   - **Register** → server confirms `newpass` is valid → user already known on device →
     **writes the password hash ONLY** (no pull). Next time, **Sign in** with `newpass` works locally.

## Consequence (accepted)
- Vault starts empty → **each user must Register once (online) per device** to bootstrap (full-adopt + pull).
- After that, sign-in on that device is pure-local, forever.
- **Register always needs the server** (it's the cred-verify + restore path). Offline Register → *"server not available."*

## Holes this closes
1. **Password always required** — sign-in verifies against the cached hash; "sign in with empty cached token" is impossible.
2. **No random users** — the only way into the vault is register-against-the-server; an arbitrary typed name can never get in.

## Implementation notes (existing building blocks — reuse, don't rewrite)
- `src/pbkdf2.ts` (pure-TS PBKDF2-SHA256, 210k, 8/8 vs Node) — the hash primitive.
- `src/authLocal.ts` — local verify (hash compare).
- `src/credStore.ts` — the vault (per-user hash + flag). Add/confirm `pulled_on_device` flag.
- `src/AuthContext.tsx` — signIn (local), register (server path + first pull), signOut.
- `src/tokenStore.ts` — `hasSeenUser`/`markSeenUser` (already tracks first-ever per member).
- `src/localStore.ts` — `wipeForUser`, per-user data partition.
- `screens/SignInScreen.tsx` — two buttons (Sign in / Register) + "not available" messaging.

## Server (8002) role
- Only `/app/signin`-style cred verify + `/app/pull` (first-time) are used, by REGISTER.
- Sign-in must NOT call 8002. (Verify via logs: a local sign-in produces ZERO 8002 hits.)
