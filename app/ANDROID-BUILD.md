# Android Release APK Build

**When to use:** Rebuild the release APK for distribution.
**Output:** `android/app/build/outputs/apk/release/app-release.apk`

## Quick Build

```bash
cd ~/.openclaw/workspace/projects/unguided/app
npm run apk
```

`package.json` script:
```json
"apk": "cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a"
```

**Result:** ~30 MB APK, arm64-v8a only (Samsung S24 and most modern Android phones).

## Verify the APK

```bash
# Size (should be ~30 MB, not 92 MB)
ls -lh android/app/build/outputs/apk/release/app-release.apk

# ABI check (should show ONLY lib/arm64-v8a/)
unzip -l android/app/build/outputs/apk/release/app-release.apk | grep -oP 'lib/[^/]+' | sort -u
```

If you see `lib/armeabi-v7a/`, `lib/x86/`, or `lib/x86_64/` — the build wasn't
arm64-only. Re-run with the `-PreactNativeArchitectures=arm64-v8a` flag.

## Deploy to The Storm (8001 download page)

```bash
# Copy to the static download dir
cp android/app/build/outputs/apk/release/app-release.apk \
   ~/.openclaw/workspace/projects/the-storm/static/app/unguided-android.apk

# Verify
ls -lh ~/.openclaw/workspace/projects/the-storm/static/app/unguided-android.apk
```

`the-storm/templates/welcome.html` already points at `/static/app/unguided-android.apk`
(30 MB, arm64) — no HTML edit needed for rebuilds. The old 92 MB `unguided.apk` was
removed from static/ and moved to `shipped/old_releases/`.

## Copy to shipped/

```bash
cp android/app/build/outputs/apk/release/app-release.apk \
   ~/.openclaw/workspace/projects/unguided/shipped/unguided-android.apk
```

## Clean Reinstall (if node_modules is corrupted)

If the build fails with AGP/Kotlin/Gradle version mismatches, do a full clean:

```bash
cd ~/.openclaw/workspace/projects/unguided/app
rm -rf node_modules
npm ci
npx expo install --fix
npx expo prebuild --platform android --clean
# Recreate local.properties (prebuild wipes it)
echo "sdk.dir=/home/allen/Android/Sdk" > android/local.properties
npm run apk
```

**Why:** `expo prebuild --clean` regenerates the native Android project with the
correct AGP/Gradle/Kotlin versions for the installed Expo SDK. This is the clean path.
Do NOT patch `node_modules/react-native/gradle/libs.versions.toml` or
`node_modules/@react-native/gradle-plugin/` to fix version mismatches — that's a
rabbit hole (see lesson below).

## ⚠️ Don't Use `abiFilters` in build.gradle

Adding `abiFilters 'arm64-v8a'` to `android/app/build.gradle` triggers an AGP version
check that conflicts with the Expo SDK's pinned AGP/Gradle/Kotlin versions. The
`-PreactNativeArchitectures=arm64-v8a` CLI flag is the correct approach — it sets
`reactNativeArchitectures` in `gradle.properties` for the build only, no source edits.

## ⚠️ `local.properties` Is Wiped by `prebuild --clean`

After `expo prebuild --platform android --clean`, recreate it:

```bash
echo "sdk.dir=/home/allen/Android/Sdk" > android/local.properties
```

Without it, the build fails with "SDK location not found."

## Shipped Artifacts

| File | What |
|------|------|
| `shipped/unguided-android.apk` | Current release APK (30 MB, arm64) |
| `shipped/unguided-ios-xcode-20261116.zip` | iOS Xcode project zip (for Mac builds) |
| `shipped/old_releases/` | Superseded artifacts (92 MB 4-ABI APK, older iOS zips) |
| `the-storm/static/app/unguided-android.apk` | Live download (8001 welcome page) |
