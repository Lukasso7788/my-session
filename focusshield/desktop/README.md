# FocusShield Desktop

Windows-first desktop companion for the existing FocusShield browser extension.

## What it does

- blocks selected Windows applications by executable name while a focus timer is active;
- provides a searchable picker populated from Windows Start Menu and installed-app records;
- supports custom `.exe` names and discovery of currently running processes as fallbacks;
- keeps enforcing in the system tray and can start with Windows;
- supports Locked mode until the timer expires;
- synchronizes the active policy with the Chrome/Edge extension through a local-only bridge at `127.0.0.1:43117`.
- connects through the existing MySession browser login and synchronizes policies between Windows computers every few seconds.

Before cloud sync can be used, apply `supabase/migrations/20260726_focus_shield_cross_device_sync.sql` in Supabase. In the app, press **Connect MySession**; the browser page securely returns the current MySession session through a one-time loopback pairing code. Refresh tokens are encrypted using Windows DPAPI/Electron `safeStorage` before being persisted.

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

Reload the unpacked extension after updating it. Policies started in either the desktop app or extension are mirrored while the desktop app is running.
