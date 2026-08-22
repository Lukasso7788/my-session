# FocusShield Desktop

Windows-first desktop companion for the existing FocusShield browser extension.

## What it does

- blocks selected Windows applications by executable name while a focus timer is active;
- provides a searchable picker populated from Windows Start Menu and installed-app records;
- supports custom `.exe` names and discovery of currently running processes as fallbacks;
- keeps enforcing in the system tray and can start with Windows;
- supports Locked mode until the timer expires;
- runs multiple independent blocking sessions at once, each with its own name, duration, websites, apps, and Locked mode;
- synchronizes the active policy with the Chrome/Edge extension through a local-only bridge at `127.0.0.1:43117`.
- connects through the existing MySession browser login and synchronizes policies and reusable block lists between Windows computers;
- includes Hyper Focus: name one task, allow only the services it needs, keep MySession available, and optionally close distracting desktop apps;
- accepts any custom duration from 1 minute to 24 hours, with common focus presets.
- checks the MySession release feed automatically and installs downloaded updates on restart.

Before cloud sync can be used, apply both migrations in Supabase:

- `supabase/migrations/20260726_focus_shield_cross_device_sync.sql` for the active policy;
- `supabase/migrations/20260811_focus_shield_saved_lists.sql` for persistent reusable lists.

In the app, press **Connect MySession**; the browser page securely returns the current MySession session through a one-time loopback pairing code. Refresh tokens are encrypted using Windows DPAPI/Electron `safeStorage` before being persisted. List saves and deletes are sent immediately, while a low-frequency reconciliation pass picks up changes from another desktop device.

The app deliberately refuses to add critical Windows processes to a blocklist. It does not install a kernel driver or background Windows service, so an administrator can always terminate or uninstall it.

## Run locally

```powershell
cd focusshield\desktop
npm install
npm run dev
```

## Build a Windows installer

```powershell
npm run dist:win
```

The installer is written to `focusshield/desktop/dist`.

To stage a new auto-update release after increasing `version` in `package.json`:

```powershell
npm run dist:win
npm run release:stage
```

Deploy the three staged files from `public/downloads/focusshield/updates`. Existing
installations check that feed at startup and every four hours. Version `0.3.0` is
the one-time bootstrap installer; later versions update in place.

Reload the unpacked extension after updating it. Policies started in either the desktop app or extension are mirrored while the desktop app is running.
