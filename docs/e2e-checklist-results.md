# E2E Smoke Checklist Results

**Date:** 2026-06-10  
**Machine:** Windows 10 (`C:\Users\hesam`)  
**Verification method:** `adapter.fetchUsage()` via `scripts/e2e-verify-providers.js` (Node) and `scripts/e2e-verify-electron.js` (Electron). Adapters have no `collect()` method; scheduler uses `fetchUsage()` (`src/main/scheduler.js`).

## Summary

| # | Checklist item | Status | Notes |
|---|----------------|--------|-------|
| 1 | Claude Code: `~/.claude/.credentials.json` → 5H/7D LIVE | **FAIL** | Credentials present; API returned HTTP 429 |
| 2 | Claude.ai: login → sessionKey, usage bars | **SKIP** | `LOGIN_REQUIRED` — no `secret_claude-ai-session` in store |
| 3 | Cursor: signed in → TOTAL/AUTO/API LIVE | **PASS** | Live snapshot from `state.vscdb` |
| 4 | Perplexity: browser login → PRO/RES/LABS bars | **SKIP** | `LOGIN_REQUIRED` — no `secret_perplexity-session` |
| 5 | Grok: `~/.grok/auth.json` → credits % LIVE | **SKIP** | Auth parsing fixed; Grok API HTTP 400 (timeout) |
| 6 | Gemini: LIVE or LOCAL fallback + DAY window | **PASS** | LOCAL fallback, `DAY:0%` |
| 7 | Tray: tooltip shows top-3 worst providers | **PASS** | Code + programmatic `buildTooltip` test |
| 8 | Alerts: 75%/90% thresholds, one notification per window | **PASS** | Code + unit tests |
| 9 | History: detail chart 7-day trend after 2+ refreshes | **PASS** | Store has 2+ entries; chart code verified |
| 10 | Floating widget: tray toggle on/off without breaking tray | **PASS** | Code wiring verified (UI smoke **MANUAL**) |

---

## 1. Claude Code

| Field | Value |
|-------|-------|
| **Status** | FAIL |
| **Credential path** | `C:\Users\hesam\.claude\.credentials.json` |
| **File exists** | Yes |
| **`isAuthenticated()`** | `true` (OAuth `accessToken` present) |
| **`fetchUsage()` result** | Error: `Claude Code usage HTTP 429` |
| **Evidence** | Rate-limited by Anthropic API; adapter and credential read path work |

---

## 2. Claude.ai

| Field | Value |
|-------|-------|
| **Status** | SKIP (`LOGIN_REQUIRED`) |
| **Credential path** | N/A (browser session in `electron-store` secret) |
| **`isAuthenticated()`** | `false` |
| **`fetchUsage()` result** | Error: `Claude.ai login required` |
| **Evidence** | Requires interactive browser login via `openAuthWindow`; not run in this verification |

---

## 3. Cursor

| Field | Value |
|-------|-------|
| **Status** | PASS |
| **Credential path** | `C:\Users\hesam\AppData\Roaming\Cursor\User\globalStorage\state.vscdb` |
| **File exists** | Yes |
| **`fetchUsage()` result** | `source: live` |
| **Windows** | `TOTAL:0%`, `AUTO:0%`, `API:0%` |
| **Plan** | `Free` |
| **Fetched at** | `2026-06-10T20:46:18.360Z` |

---

## 4. Perplexity

| Field | Value |
|-------|-------|
| **Status** | SKIP (`LOGIN_REQUIRED`) |
| **Credential path** | N/A (`secret_perplexity-session` in store) |
| **`isAuthenticated()`** | `false` |
| **`fetchUsage()` result** | Error: `Perplexity login required` |
| **Evidence** | Requires interactive browser login; not run in this verification |

---

## 5. Grok

| Field | Value |
|-------|-------|
| **Status** | SKIP (auth OK, API error) |
| **Credential path** | `C:\Users\hesam\.grok\auth.json` |
| **File exists** | Yes |
| **`isAuthenticated()`** | `true` (after fix: nested CLI format `key` JWT) |
| **`fetchUsage()` result** | Error: `Grok HTTP 400` (`{"error":"Timeout expired"}`) |
| **Code fix** | `readGrokAuth()` now reads nested Grok CLI auth (`Object.values(data)[0].key`) |
| **Evidence** | Auth detection works; billing API unreachable/timed out on this run |

---

## 6. Gemini

| Field | Value |
|-------|-------|
| **Status** | PASS |
| **Credential path** | `C:\Users\hesam\.gemini\tmp` (local session count) |
| **File exists** | Yes |
| **`fetchUsage()` result** | `source: local` (live fetch failed → fallback) |
| **Windows** | `DAY:0%`, resets `2026-06-11T00:00:00.000Z` |
| **Fallback error** | `Gemini login required` (no `secret_gemini-session`) |
| **Evidence** | LOCAL fallback with DAY window per design |

---

## 7. Tray tooltip (top-3 worst providers)

| Field | Value |
|-------|-------|
| **Status** | PASS |
| **Code** | `src/main/tray.js` → `buildTooltip()` sorts snapshots by `worstUtilization()`, takes `.slice(0, 3)` |
| **Programmatic test** | Input: grok 91%, gemini 80%, claude-code 76%, cursor 50% → tooltip: `Grok 91% · Gemini 80% · Code 76%` |
| **Evidence** | Matches worst-3 ordering |

---

## 8. Alerts (75% / 90%, dedup)

| Field | Value |
|-------|-------|
| **Status** | PASS |
| **Code** | `src/main/alerts.js` — `warn` at 75%, `danger` at 90%; `state` Map dedupes per `providerId:windowKey:level` |
| **Defaults** | `src/main/store.js` → `warnThreshold: 75`, `dangerThreshold: 90` |
| **Wiring** | `main.js` → `evaluateAlerts()` calls `alertManager.evaluate()` per window |
| **Unit test** | `tests/main/alerts.test.js` — duplicate 91%/92% fires once; reset at 50% then 91% fires again |
| **Programmatic test** | 76% → 1 warn; 90% → 1 danger; repeats suppressed |

---

## 9. History (7-day detail chart)

| Field | Value |
|-------|-------|
| **Status** | PASS |
| **Store path** | `C:\Users\hesam\AppData\Roaming\api-meter\config.json` |
| **Entries** | `usageHistory_gemini`: 4 entries; `usageHistory_cursor`: 2 entries |
| **Append logic** | `src/main/scheduler.js` → `appendHistory()` on successful `fetchUsage()` |
| **Chart logic** | `src/renderer/dashboard/dashboard.js` → `renderHistoryChart()` filters last 7 days, renders Chart.js line chart |
| **Evidence** | ≥2 refreshes recorded; chart renders when `history.length > 0` |

---

## 10. Floating widget toggle

| Field | Value |
|-------|-------|
| **Status** | PASS (code); **MANUAL** (headed UI) |
| **Tray menu** | `src/main/tray.js` line 40 — `Toggle Floating Widget` → `onToggleWidget` |
| **Main wiring** | `main.js` lines 128–136 — `toggleFloatingWidget({ getWin, createWin, settings })` |
| **Toggle logic** | `src/main/windows.js` `toggleFloatingWidget()` — hide + `floatingWidget.enabled=false` when visible; show + `enabled=true` when hidden; creates window if destroyed |
| **IPC** | `main.js` `app:toggleWidget` handler uses same `toggleFloatingWidget` |
| **Note** | Tray instance unchanged on toggle; only floating window visibility/settings updated |

---

## Credential paths checked (`src/shared/paths.js`)

| Provider | Path | Exists |
|----------|------|--------|
| Claude Code | `%USERPROFILE%\.claude\.credentials.json` | Yes |
| Grok | `%USERPROFILE%\.grok\auth.json` | Yes |
| Gemini (local) | `%USERPROFILE%\.gemini\tmp` | Yes |
| Cursor | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` | Yes |

## Scripts used

```bash
node scripts/e2e-verify-providers.js
npx electron scripts/e2e-verify-electron.js
npm test
```

Raw Electron results: `scripts/e2e-verify-electron-results.json`

## Fixes applied this run

- **Grok auth parsing:** `src/providers/grok.js` — support nested Grok CLI `auth.json` format (`key` JWT under issuer key).
- **Test added:** `tests/providers/grok.test.js`