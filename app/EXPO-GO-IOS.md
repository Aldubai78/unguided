# Expo Go — iOS/iPad Setup (Manual NAT-mode Workaround)

**When to use:** iPad connects to Metro running inside WSL2 (NAT mode, not mirrored).
**Why:** WSL2's NAT IP (172.x.x.x) is not routable from the LAN. The iPad can't
reach it directly. The Windows portproxy bridges the gap: Windows LAN IP:8084 → WSL IP:8084.

## Step 1 — Start Metro (WSL bash)

```bash
cd ~/.openclaw/workspace/projects/unguided/app
EXPO_PUBLIC_SERVER_URL=https://als-gigaaitop-1.tailcf3f27.ts.net \
REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.122 \
npx expo start --port 8084 --host lan --clear
```

**Key details:**
- `EXPO_PUBLIC_SERVER_URL` — inlined at bundle time. The iPad hits this Tailscale
  funnel URL for ALL API calls (internet-routable, works off-LAN).
- `REACT_NATIVE_PACKAGER_HOSTNAME` — forces Metro to advertise the **Windows Wi-Fi
  IP** (the one the iPad sees on the network), NOT the WSL NAT IP.
  ⚠️ Update `192.168.1.122` if the Windows box's LAN IP changes.
- `--host lan` — makes Metro listen on 0.0.0.0 (all interfaces).
- `--clear` — clears the Metro cache (use after config changes).

## Step 2 — Verify Metro is on all interfaces (WSL bash)

```bash
ss -tlnp | grep 8084
```

Should show `0.0.0.0:8084` or `*:8084`. If it only shows `172.17.0.1` (Docker
bridge) or a specific WSL interface, the iPad won't reach it. Modern Expo
usually listens on 0.0.0.0 with `--host lan`.

## Step 3 — Windows portproxy (Admin PowerShell)

```powershell
# Remove any old rule first
netsh interface portproxy delete v4tov4 listenport=8084 listenaddress=0.0.0.0

# Add the correct one (use the ACTUAL WSL eth0 IP, not 172.17.0.1)
$wslIp = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy add v4tov4 listenport=8084 listenaddress=0.0.0.0 connectport=8084 connectaddress=$wslIp
```

**Critical:** `connectaddress` must be the **WSL eth0 IP** (from `wsl hostname -I`),
NOT `172.17.0.1` (Docker) and NOT the Windows LAN IP. This is the bridge that
makes `WindowsLANIP:8084` → `WSL:8084` work.

## Step 4 — Windows Firewall (Admin PowerShell)

```powershell
New-NetFirewallRule -DisplayName "Expo Metro 8084" -Direction Inbound -Protocol TCP -LocalPort 8084 -Action Allow -Profile Private
```

Run this once. Subsequent portproxy updates don't need a new firewall rule.

## Step 5 — iPad (Expo Go)

1. Make sure the iPad is on the **same Wi-Fi** as the Windows box.
2. Open Expo Go app → tap the QR code / camera icon.
3. Scan the QR code Metro printed in the terminal.
   (It'll show the Windows LAN IP:8084, e.g. `192.168.1.122:8084`.)
4. The app loads. API calls go to the Tailscale funnel URL (internet-routable).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ConfigError: package.json does not exist` | Ran `npx expo` from wrong dir | `cd` into `projects/unguided/app/` first |
| iPad can't connect | Portproxy `connectaddress` is wrong (172.17.0.1 or stale WSL IP) | Re-run Step 3 with fresh `wsl hostname -I` |
| iPad can't connect | Firewall rule missing | Re-run Step 4 (needs Admin PowerShell) |
| App loads but API calls fail | `EXPO_PUBLIC_SERVER_URL` missing from Metro command | Add it (Step 1) and restart Metro |
| `REACT_NATIVE_PACKAGER_HOSTNAME` wrong | Metro advertises WSL IP instead of Windows IP | Set it to the Windows Wi-Fi IP |
| WSL IP changed (after restart) | Portproxy points to stale IP | Re-run Step 3 with new `wsl hostname -I` |

## Architecture (why it works)

```
iPad (LAN)
  │
  │  Metro bundle (JS)
  ▼
Windows LAN IP:8084  ──portproxy──►  WSL eth0 IP:8084 (Metro)
  │
  │  API calls (inlined at bundle time)
  ▼
https://als-gigaaitop-1.tailcf3f27.ts.net  (Tailscale Funnel → 8001)
```

- Metro serves the JS bundle on 8084 (LAN-reachable via portproxy).
- API calls go to the Tailscale funnel URL (internet-routable, no LAN needed).
- The two are independent: Metro = bundle delivery, Funnel = API traffic.
