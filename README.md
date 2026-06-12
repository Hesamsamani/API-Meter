<p align="center">
  <img src="docs/screenshots/icon.png" alt="API-Meter" width="96" height="96">
</p>

<h1 align="center">API-Meter</h1>

<p align="center">
  <strong>One tray. Six providers. Zero tab-hopping.</strong><br>
  A Windows system-tray command center for AI usage limits — Claude, Gemini, Grok, Cursor, Perplexity, and more.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/Electron-28-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/tests-100%20passing-22c55e?style=for-the-badge" alt="Tests">
  <img src="https://img.shields.io/badge/license-MIT-e8e8ea?style=for-the-badge" alt="MIT">
</p>

---

## Mission Control

API-Meter lives in your system tray and polls provider dashboards on a schedule you control. Gauges turn green → amber → red as quotas fill. Open the full dashboard for history charts, or pin a frosted floating widget to your desktop.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="API-Meter dashboard — Mission Control view with six provider gauges" width="100%">
</p>

<p align="center"><em>Mission Control — live gauges for every connected provider</em></p>

Drill into any provider for quota windows, reset countdowns, and a seven-day utilization chart:

<p align="center">
  <img src="docs/screenshots/dashboard-detail.png" alt="Provider detail panel with history chart" width="100%">
</p>

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### Tray-first workflow
- Dynamic tray icon ring fills with **worst-case utilization** across providers
- Color states: green · amber · red
- Click for a compact usage snapshot; double-click for the dashboard

<p align="center">
  <img src="docs/screenshots/tray-icons-strip.png" alt="Tray icons at 12%, 48%, and 82% utilization" width="280">
</p>

</td>
<td width="50%" valign="top">

### Floating widget
Four display modes — single, grid, compact list, and **orb rings** (Rainmeter-style).

- Resize (− / +), theme cycle (◐), layout cycle (◎)
- **Click-through mode** — sits above the wallpaper, ignores mouse hits, keeps the frosted panel visible
- Position remembered across hide/restart

</td>
</tr>
<tr>
<td valign="top">

<p align="center">
  <img src="docs/screenshots/widget-single.png" alt="Floating widget — single provider mode" width="300">
</p>

</td>
<td valign="top">

<p align="center">
  <img src="docs/screenshots/widget-orb.png" alt="Floating widget — orb mode with per-limit rings" width="380">
</p>

<p align="center">
  <img src="docs/screenshots/widget-click-through.png" alt="Click-through orb widget on desktop" width="380">
</p>

</td>
</tr>
</table>

### Everything else

| Capability | Detail |
|---|---|
| **Auto-refresh** | Configurable interval (1–60 min), toggle from the titlebar |
| **Desktop alerts** | Warn / danger thresholds with native notifications |
| **Provider auth** | Browser login flow + optional cookie import |
| **Local + live data** | SQLite history; stale badges when a fetch fails |
| **Startup** | Optional launch-at-login, starts minimized to tray |

---

## Tray popover

Quick glance without leaving your flow:

<p align="center">
  <img src="docs/screenshots/tray-popover.png" alt="Tray popover with provider usage rows" width="360">
</p>

---

## Supported providers

| Provider | Limits tracked | Auth |
|---|---|---|
| **Claude** (claude.ai) | 5-hour · 7-day windows | Browser session |
| **Claude Code** | 5-hour · 7-day | Browser session |
| **Gemini** | Daily quota | Browser session |
| **Perplexity** | Daily / plan limits | Browser session |
| **Grok** | Rolling windows | Browser session |
| **Cursor** | Usage total | Browser session |

Enable or disable any provider in **Settings → Providers**. Pin providers for widget grid / orb modes.

<p align="center">
  <img src="docs/screenshots/settings.png" alt="Settings — telemetry, alerts, widget, and provider toggles" width="420">
</p>

---

## Install

### Portable (recommended)

1. Download **`API-Meter 0.1.0.exe`** from [Releases](https://github.com/Hesamsamani/API-Meter/releases) (or build locally — see below).
2. Run it. The app minimizes to the tray.
3. Right-click the tray icon → **Open Dashboard** → connect providers via **Login**.

> API-Meter stores credentials in your local Electron user data folder. Nothing is sent to third-party servers except the provider dashboards you authenticate with.

### Build from source

```bash
git clone https://github.com/Hesamsamani/API-Meter.git
cd API-Meter
npm install
npm start          # dev
npm test           # 100 unit tests
npm run build:win  # dist/API-Meter 0.1.0.exe
```

**Requirements:** Node.js 18+, Windows 10/11.

---

## Development

```bash
npm start                 # Electron dev
npm test                  # Node test runner
npm run icons:generate    # Regenerate app + tray PNGs from gauge templates
npm run screenshots       # Regenerate README screenshots (Playwright)
```

### Project layout

```
API-Meter/
├── main.js                 # App entry, IPC wiring
├── src/main/               # Tray, windows, scheduler, SQLite store
├── src/providers/          # Per-provider fetch + parse logic
├── src/renderer/           # Dashboard, settings, widget, tray popover
├── assets/                 # App icon + dynamic tray gauge PNGs
├── docs/screenshots/       # README imagery
└── tests/                  # Provider + main-process unit tests
```

### Tray icon gauge

Tray icons are generated with `scripts/generate-icons.js` and updated at runtime by `tray-icon-buffer.js` — the ring arc reflects aggregate utilization and shifts color at warn/danger thresholds.

---

## Contributing

Bug reports and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

1. Fork → branch → `npm test` → PR
2. Keep provider parsers isolated under `src/providers/`
3. Regenerate screenshots if UI changes: `npm run screenshots`

---

## License

[MIT](LICENSE) — © 2026 Hesam Samani

<p align="center">
  <sub>Built for people who hit rate limits at 2 AM and need to know <em>which</em> provider is the culprit.</sub>
</p>