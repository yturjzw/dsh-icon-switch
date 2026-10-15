# dsh-icon-switch

In-app icon switcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Change the app / tray / taskbar icon right from the Settings page, upload any image to generate a full icon set, round the corners, and optionally hide the sidebar brand row.

## Features

- **Icon gallery** — preview every installed icon set inside the DSH Settings page.
- **Upload → icon set** — upload a PNG/JPEG/GIF/BMP and the bundled PowerShell engine generates the full set (`app-icon.png/.ico` + tray sizes).
- **Rounded corners** — optional 26% corner radius; the square original is kept as `source.png` so toggling it off restores sharp corners.
- **Tray & taskbar** — writes `tray.ico`/`icon.png` for the app, updates Windows shortcuts, and sets the taskbar icon (Electron `setIcon` first, a resident PowerShell watcher as fallback).
- **Hide sidebar brand row** — optional pure-CSS toggle, instant.

## Install

```
dsh plugin add dsh-icon-switch
```

or from source:

```
dsh plugin add github:yturjzw/dsh-icon-switch
```

After installing, **fully quit and restart DSH** so the plugin loads and the tray icon is picked up.

## How it works

`lib/index.js` registers a settings section plus loopback-only HTTP routes under
`/api/dsh-icon-switch/`. The bundled `tool/dsh-icon-switch.ps1` engine reads and
writes icon sets under `tool/icons` (override the directory with the `toolDir`
setting if you want them to persist across plugin reinstalls).

## Layout

```
lib/index.js          host side: Config schema, routes, engine spawn
client/client.js      browser settings section (gallery, upload, form)
tool/                 bundled PowerShell engines + starter icon sets
cordis.patch.yml      bundle patch
```

## Icon files

- `tray.ico` → `process.resourcesPath\tray.ico` (tray icon, read once at startup).
- `icon.png` → `process.resourcesPath\icon.png` (About panel; the window/taskbar icon is set via `setIcon`/WM_SETICON at runtime).
- ICO frames are built as 32 bpp DIB with an alpha-derived AND mask — PNG frames are rejected by some shell extraction paths and show up as a blank icon.