# API-Meter Design Spec

**Date:** 2026-06-10  
**Status:** Draft — pending user review  
**Approach:** Plugin-based Electron monolith (Approach 1)

## Summary

API-Meter is a cross-platform (Windows, macOS, Linux) desktop application that monitors AI service usage limits across six providers in one place. The primary interaction surface is the **system tray**; a full **dashboard** provides detail and history; an optional **floating widget** offers always-on-top glanceable monitoring.

Visual design follows the OpenToken Monitor card-and-gauge aesthetic: dark theme, circular progress rings, reset countdowns, and LIVE/LOCAL source badges.

## Goals

- Show real-time usage limits for Claude.ai, Claude Code, Gemini, Perplexity, Grok, and Cursor from a single tray icon.
- Auto-detect subscription tier per provider where possible.
- Alert the user when any provider crosses configurable warn/danger thresholds.
- Keep all credentials and history local — no third-party proxy servers.
- Ship all six providers in v1 with graceful per-provider degradation.

## Non-Goals (v1)

- Cost estimation / token pricing breakdown (future phase).
- Team/organization multi-account support.
- Mobile or web versions.
- Automated quota consumption ("burn unused budget").

## User Requirements (Confirmed)

| Decision | Choice |
|---|---|
| Primary UI | System tray (B) |
| Secondary UI | Full dashboard (C) |
| Optional UI | Floating always-on-top widget (A), off by default |
| Providers | All six in v1 |
| Plans | User plans with autodetect for all |
| Platform | Windows + macOS + Linux |
| Tech stack | Fresh Electron build in API-Meter (not a fork) |
| Alerts | Per-provider configurable warn/danger thresholds |
| History | 7-day per-provider trend graphs in detail view |
| Visual style | OpenToken Monitor–inspired cards and gauges |

### User's Current Plans (starting point for autodetect validation)

| Provider | Known plan |
|---|---|
| Claude.ai | Autodetect |
| Claude Code | Pro |
| Gemini | AI Pro |
| Perplexity | Pro |
| Grok | SuperGrok |
| Cursor | Free |

## Architecture

### High-Level Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Main Process                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ TrayManager │  │ WindowManager│  │ AlertManager   │ │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘ │
│         │                │                   │          │
│  ┌──────┴────────────────┴───────────────────┴───────┐  │
│  │              UsageStore (normalized cache)         │  │
│  └──────┬────────────────────────────────────────────┘  │
│         │                                                │
│  ┌──────┴────────────────────────────────────────────┐  │
│  │           CollectorScheduler (5 min default)       │  │
│  └──────┬──────┬──────┬──────┬──────┬──────┬─────────┘  │
│         │      │      │      │      │      │             │
│     ┌───┴──┐┌──┴──┐┌──┴──┐┌──┴──┐┌──┴──┐┌──┴──┐        │
│     │Claude││Code ││Gemini││Pplx ││Grok ││Cursor│        │
│     │.ai   ││     ││     ││     ││     ││     │        │
│     └──────┘└─────┘└─────┘└─────┘└─────┘└─────┘        │
│              Provider Adapter Plugins                    │
└─────────────────────────────────────────────────────────┘
         ▲ IPC (contextBridge) ▲
┌────────┴─────────────────────┴──────────────────────────┐
│              Renderer (React or vanilla HTML/CSS/JS)   │
│   TrayPopover │ DashboardWindow │ FloatingWidget      │
└─────────────────────────────────────────────────────────┘
```

### Core Modules

| Module | Responsibility |
|---|---|
| `ProviderRegistry` | Registers adapters, exposes list/metadata |
| `CollectorScheduler` | Polls adapters on interval; respects per-provider backoff |
| `UsageStore` | Normalized in-memory cache + persisted snapshots/history |
| `CredentialStore` | `electron-store` settings + `safeStorage` for secrets |
| `TrayManager` | Icon color, tooltip, popover, context menu |
| `WindowManager` | Dashboard and floating widget lifecycle |
| `AlertManager` | Threshold crossing detection + desktop notifications |
| `AuthWindow` | Shared embedded BrowserWindow for web-login providers |

## Provider Adapter Interface

Every provider implements the same contract:

```typescript
interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly authMethod: 'browser' | 'local-oauth' | 'local-db';

  isAvailable(): Promise<boolean>;       // e.g. Cursor installed?
  isAuthenticated(): Promise<boolean>;
  login(): Promise<void>;
  logout(): Promise<void>;

  fetchUsage(): Promise<UsageSnapshot>;
  detectPlan(snapshot: UsageSnapshot): string | null;
}

type ProviderId =
  | 'claude-ai'
  | 'claude-code'
  | 'gemini'
  | 'perplexity'
  | 'grok'
  | 'cursor';

interface UsageWindow {
  key: string;           // e.g. "five_hour", "seven_day", "daily"
  label: string;         // display: "5H", "7D", "DAY"
  utilization: number;   // 0–100
  resetsAt?: string;     // ISO 8601
}

interface UsageSnapshot {
  providerId: ProviderId;
  source: 'live' | 'local' | 'stale';
  plan: string | null;
  windows: UsageWindow[];
  fetchedAt: string;
  error?: string;
}
```

### Adapter Implementations

| Provider | Auth method | Primary data source | Fallback |
|---|---|---|---|
| **claude-ai** | Browser login via `AuthWindow` | Claude.ai session API (cookie-based fetch via hidden `BrowserWindow`, pattern from [claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget)) | None — requires login |
| **claude-code** | Local OAuth token from `~/.claude/.credentials.json` | `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` header | Parse local JSONL project logs for activity indicators |
| **gemini** | Browser login and/or local Google credentials | Google AI quota endpoint (when available for AI Pro) | Parse `~/.gemini/tmp/*/chats/session-*.json` for daily session/token counts |
| **perplexity** | Browser login via `AuthWindow` | Reverse-engineered Perplexity account usage endpoint | Show login required |
| **grok** | Browser login via `AuthWindow` | Reverse-engineered grok.com / xAI session usage endpoint | Show login required |
| **cursor** | Local DB — no user login | Read `state.vscdb` SQLite (`cursorAuth/accessToken`) + Cursor usage API | Show "Cursor not installed" if DB missing |

### Autodetect Plan Logic

Each adapter maps API response fields to a plan label:

- **Claude.ai / Claude Code:** Infer from presence of `seven_day_opus`, extra usage fields, utilization caps.
- **Gemini:** Infer from quota response tier fields or rate-limit headers.
- **Perplexity / Grok:** Infer from response metadata (Pro vs Max limits).
- **Cursor:** Infer from usage tier in API response (Free vs Pro request limits).

When autodetect fails, display `Plan: Unknown` and still show raw utilization numbers.

### Resilience Rules

1. Adapter fetch failure does not block other adapters.
2. On failure, serve last good snapshot with `source: 'stale'`.
3. Per-provider exponential backoff: 25s after failure, 120s after success (prevent rate-limit hammering).
4. Per-provider re-login/logout from tray menu and settings.
5. Adapters log errors locally; no telemetry sent externally.

## UI Design

### Visual Language (OpenToken Monitor–inspired)

- **Background:** Near-black (`#0d0d0d` range).
- **Cards:** Dark gray rounded rectangles with subtle border.
- **Gauges:** Circular ring progress; provider logo centered.
- **Status dot:** Green = live, amber = stale, red = error/disconnected.
- **Badge:** `LIVE` (API fetch) or `LOCAL` (file-based fallback).
- **Typography:** Bold uppercase provider name; smaller stat labels below gauge.
- **Threshold colors:** Green (< warn) → amber (≥ warn) → red (≥ danger).

### Tray (Primary)

- **Icon:** Dynamic color reflecting worst provider status across all connected providers.
- **Tooltip:** Summary line per provider, e.g. `Claude 42% · Cursor 88% · Gemini 36%`.
- **Left-click:** Opens compact popover (mini cards, top 2 windows each).
- **Right-click menu:**
  - Show Dashboard
  - Refresh All
  - Toggle Floating Widget
  - Settings
  - Per-provider: Re-login / Disconnect
  - Exit

### Dashboard (Full Window)

- Frameless custom titlebar with platform-appropriate window controls.
- Header: API-Meter branding, global refresh button, auto-refresh toggle, settings gear.
- **Overview grid:** 6 provider cards, responsive 3 columns (2 rows).
- **Card contents:** Gauge, status dot, plan label, 2–4 stat columns, reset countdowns, LIVE/LOCAL badge.
- **Click card:** Opens detail panel with:
  - All quota windows as progress bars
  - 7-day trend chart (Chart.js)
  - Last fetch time and data source
  - Re-login / disconnect actions

### Floating Widget (Optional)

- Disabled by default; enabled in Settings or tray menu.
- Small always-on-top frameless window.
- User selects 1–3 pinned providers or enables auto-rotate (10s interval).
- Reuses mini card component from tray popover.

## Data & Storage

### Settings (`electron-store`)

```json
{
  "refreshIntervalMinutes": 5,
  "theme": "dark",
  "launchAtStartup": false,
  "floatingWidget": { "enabled": false, "pinnedProviders": [], "autoRotate": false },
  "alerts": {
    "enabled": true,
    "warnThreshold": 75,
    "dangerThreshold": 90
  },
  "providers": {
    "claude-ai": { "enabled": true },
    "claude-code": { "enabled": true },
    "gemini": { "enabled": true },
    "perplexity": { "enabled": true },
    "grok": { "enabled": true },
    "cursor": { "enabled": true }
  }
}
```

### Secrets (`safeStorage`)

- Browser session cookies per web-login provider.
- OAuth tokens when not readable from local CLI files.

### History

- Key: `usageHistory_{providerId}`
- Append snapshot on each successful fetch.
- Retain 8 days; chart displays 7 days.
- Cap at 10,000 samples per provider.
- Skip writes when session is invalid (no reset timestamps).

## Alerts

- Per-provider, per-window threshold evaluation.
- Defaults: warn at 75%, danger at 90% (globally configurable; per-provider override in settings).
- Notify once per threshold crossing per window until utilization drops below threshold.
- Desktop notifications via Electron `Notification` API.
- Tray icon color updates synchronously with alert state.

## Error Handling

| Scenario | Behavior |
|---|---|
| Provider not installed (Cursor) | Card shows "Not installed" with setup hint |
| Not authenticated | Card shows "Login required" with action button |
| API returns 401 | Mark session expired; prompt re-login |
| API returns 429 | Backoff; show stale data |
| Undocumented endpoint changes | Card shows error badge; adapter logs details |
| Network offline | All providers show stale data with amber indicator |

## Testing Strategy

| Layer | Tests |
|---|---|
| Adapters | Unit tests with mocked HTTP/SQLite/fixture files |
| UsageStore | Snapshot normalization and stale fallback |
| AlertManager | Threshold crossing edge cases (no duplicate notifications) |
| Integration | Manual smoke test per provider on Windows (primary dev platform) |
| Packaging | Build artifacts for win (nsis + portable), mac (dmg), linux (AppImage) |

## Project Structure (Proposed)

```
API-Meter/
├── package.json
├── electron-builder config
├── main.js                    # Electron entry
├── preload.js
├── src/
│   ├── main/
│   │   ├── tray.js
│   │   ├── windows.js
│   │   ├── scheduler.js
│   │   ├── store.js
│   │   ├── alerts.js
│   │   └── auth-window.js
│   ├── providers/
│   │   ├── registry.js
│   │   ├── types.ts
│   │   ├── claude-ai.js
│   │   ├── claude-code.js
│   │   ├── gemini.js
│   │   ├── perplexity.js
│   │   ├── grok.js
│   │   └── cursor.js
│   └── renderer/
│       ├── dashboard/
│       ├── tray-popover/
│       ├── floating-widget/
│       ├── components/        # ProviderCard, Gauge, StatRow
│       └── styles/
├── assets/                    # Provider logos, tray icons
└── docs/
```

## Implementation Phases

Even with "all providers in v1," delivery is sequenced to de-risk reverse-engineering:

| Phase | Deliverable | Providers |
|---|---|---|
| **1 — Shell** | Electron scaffold, tray, dashboard skeleton, scheduler, store | None (mock data) |
| **2 — Known APIs** | Working adapters with documented/reused patterns | Claude.ai, Claude Code, Cursor |
| **3 — Web login** | Shared AuthWindow, browser-session adapters | Perplexity, Grok |
| **4 — Gemini** | OAuth + file fallback | Gemini |
| **5 — Polish** | Alerts, history charts, floating widget, cross-platform builds | All |

Phases 2–4 can be parallelized once the shell (Phase 1) is stable.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Undocumented APIs change | Adapter breaks silently | Stale fallback, visible error state, adapter version pinning |
| Cursor API tied to IDE version | Usage fetch fails after update | Read version from install; document tested versions |
| Perplexity/Grok endpoints unknown | Delayed v1 for those two | Phase 3 dedicated to reverse-engineering; ship others first within v1 cycle |
| 6 providers clutter tray tooltip | Poor UX | Tooltip shows top 3 worst; full detail in popover |
| Electron app size | Large downloads | Acceptable for desktop utility; no Tauri migration in v1 |

## Open Questions

None blocking spec approval. History confirmed as Option A (7-day detail charts) per design recommendation.

## References

- [claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget) — Electron widget, Claude.ai session auth, tray, charts
- [OpenTokenMonitor](https://github.com/Hitheshkaranth/OpenTokenMonitor) — Multi-provider UI inspiration, adapter patterns
- [cursor_api_demo](https://github.com/eisbaw/cursor_api_demo) — Cursor auth token reading
- [Claude Code OAuth usage](https://ianlpaterson.com/blog/tracking-claude-codex-gemini-quotas-from-one-script/) — Undocumented usage endpoint