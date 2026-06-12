# Contributing to API-Meter

Thanks for helping improve API-Meter. This project is an Electron tray app with provider-specific parsers — keep changes focused and tested.

## Getting started

```bash
git clone https://github.com/Hesamsamani/API-Meter.git
cd API-Meter
npm install
npm start
npm test
```

## Pull request checklist

- [ ] `npm test` passes (all tests green)
- [ ] Provider changes include or update tests under `tests/providers/`
- [ ] UI changes update README screenshots: `npm run screenshots`
- [ ] No secrets, cookies, or personal session data committed
- [ ] Commit messages describe **why**, not just what

## Code areas

| Area | Path | Notes |
|---|---|---|
| Provider parsers | `src/providers/` | One file per provider; return normalized snapshot shape |
| Main process | `src/main/` | Tray, scheduler, SQLite, auth windows |
| Renderer | `src/renderer/` | Dashboard, settings, widget, popover |
| Shared UI | `src/renderer/shared/` | Gauges, provider cards, styles |
| Icons | `assets/`, `scripts/generate-icons.js` | Run `npm run icons:generate` after visual changes |

## Adding a provider

1. Create `src/providers/<name>.js` exporting a fetch function
2. Register in the scheduler / provider registry
3. Add logo PNGs to `assets/providers/` and `src/renderer/assets/providers/`
4. Add `PROVIDER_META` entry in `provider-card.js`
5. Write tests in `tests/providers/<name>.test.js`

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:

- Windows version
- API-Meter version
- Provider affected
- Steps to reproduce
- Expected vs actual behavior

## Feature requests

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) describing the user workflow, not just the implementation.

## Code style

- Match existing module style (ES modules in renderer, CommonJS in main where present)
- Prefer small, testable functions over large handlers
- Reuse `provider-card.js` and `gauge.js` for UI consistency