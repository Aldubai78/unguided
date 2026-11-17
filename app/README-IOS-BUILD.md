# Unguided — iOS Build Guide (for your friend)

This is the full Unguided app: your JS/TS source + the generated iOS native
project (`ios/`). Open it in Xcode, sign it with your Apple team, and run it
on your iPad.

## What you need (on your Mac)

| Requirement | Version | Install if missing |
|-------------|---------|--------------------|
| **macOS** | 14+ | (you have a Mac) |
| **Xcode** | 16+ | [Mac App Store](https://apps.apple.com/us/app/xcode/id497799835) (free, ~12 GB download) |
| **Node.js** | 20+ | `brew install node` (or [nodejs.org](https://nodejs.org)) |
| **CocoaPods** | latest | `sudo gem install cocoapods` |
| **An Apple ID** | — | Your personal Apple ID, or a paid Apple Developer account if you want a signed build that lasts |

> First Xcode launch: accept the license, install command-line tools when
> prompted (`xcode-select --install` if it asks).

## Build steps (run in Terminal)

```bash
# 1. Get into the app folder
cd unguided-app

# 2. Install JS dependencies
cd app
npm install

# 3. Install native (CocoaPods) dependencies
cd ios
pod install
cd ..

# 4. Open the project in Xcode
#    ⚠️ Open the .xcworkspace, NOT the .xcodeproj — CocoaPods needs the workspace.
open ios/Unguided.xcworkspace
```

## Signing (the important part)

1. In Xcode, select the **Unguided** project (blue icon, left sidebar)
2. Select the **Unguided** target → **Signing & Capabilities** tab
3. Check **Automatically manage signing**
4. **Team:** pick your Apple ID from the dropdown
   - If you're a **paid** Apple Developer ($99/yr), you'll see your team name
   - If you're a **free** Apple ID, you'll see your name — free tier works for
     7-day expiry builds on up to 3 devices
5. **Bundle ID:** the default is `com.aldubai.opengym`.
   - ⚠️ **If your Apple ID is NOT the owner of that bundle ID**, Xcode will
     fail to sign. Change it to something under your control, e.g.
     `com.YOURNAME.opengym` (replace YOURNAME). This makes it a *different*
     app from the owner's — fine for testing.
   - If you ARE the owner (or have been added as a developer on that account),
     leave it as-is.

## Run it

**Option A — On your iPad (USB):**
1. Plug your iPad in via USB
2. In Xcode, top toolbar: pick your iPad as the destination (not the simulator)
3. First time: unlock the iPad, tap **Trust This Computer**
4. Press **Run** (⌘R)
5. Xcode builds → signs → installs → launches. App appears on your iPad home screen.

**Option B — On the iOS Simulator (no iPad needed):**
1. In Xcode, pick a simulator (e.g. "iPad Pro (13-inch) (6th generation)")
2. Press **Run** (⌘R)
3. App launches in the simulator window.
   - ⚠️ The simulator won't have your real server connection by default. The
     app's server URL is baked in at build time. If it can't reach the server,
     see "Server URL" below.

## Server URL (if the app can't reach the backend)

The app reads `EXPO_PUBLIC_SERVER_URL` at build time. If it's not set, it
defaults to a LAN address that won't work on your network. To point it at the
right server:

1. Before `npm install`, create a file called `.env` in the `app/` folder:
   ```
   EXPO_PUBLIC_SERVER_URL=https://als-gigaaitop-1.tailcf3f27.ts.net
   ```
   (or whatever URL your server is actually at)
2. Then run `npm install` and build as normal.

> The Tailscale funnel URL above works from any device on the internet, as
> long as the Tailscale funnel is active on the server side.

## Rebuilding after code changes

If you edit any JS/TS file:
1. In Xcode, just press **Run** again (⌘R) — it re-bundles the JS
2. For native changes (adding an iOS-only module): re-run `pod install`, then
   close and reopen the `.xcworkspace`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pod install` fails | `sudo gem install cocoapods` then retry. If still failing, `cd ios && rm -rf Pods Podfile.lock && pod install` |
| Xcode says "Signing for Unguided requires a development team" | Pick a Team in Signing & Capabilities (step above) |
| "Bundle ID is not available" / "Provisioning profile not found" | Change the Bundle ID to something unique to you (see Signing step 5) |
| App builds but can't reach server | Set `EXPO_PUBLIC_SERVER_URL` in `.env` (see Server URL section) |
| `open ios/Unguided.xcworkspace` says file not found | Run `pod install` first — the `.xcworkspace` is created by CocoaPods |
| Xcode is very slow on first build | Normal — it's compiling React Native from source. Subsequent builds are fast. |
| "Unable to install app... unsupported" on iPad | Make sure your Xcode version is new enough for your iPad's iOS version. Update Xcode or the iPad. |

## What's in this zip

```
unguided-app/
├── README-IOS-BUILD.md   # ← this file
├── app/                  # your JS/TS source (no node_modules — run npm install)
│   ├── package.json
│   ├── app.json
│   ├── src/  screens/  components/  assets/  ...
│   └── index.ts
├── ios/                  # generated native iOS project
│   ├── Unguided.xcodeproj
│   ├── Unguided/         # Swift app code, Info.plist, assets
│   ├── Podfile
│   └── ...
```

> `node_modules/` is intentionally NOT included (it's huge and machine-specific).
> Run `npm install` to regenerate it.
