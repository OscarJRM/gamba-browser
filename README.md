# gamba-browser

Drive **your real Chrome** (with your real sessions) from scripts and AI agents, with a Playwright harness built for hostile SPAs.

- Runs over Chrome DevTools Protocol on a local profile: no cookies to export, no cloud browser, no per-action API cost.
- Ships an **MCP server** so Claude Code, Codex, Cursor or any MCP client can call it as native tools.
- Adds the helpers raw Playwright lacks: controlled inputs, split buttons, floating portals, blocked-button diagnostics.

> Status: **alpha**. The driver is measured; the site recipes are examples, not guarantees. Expect rough edges.

## Why

Raw Playwright is fine until a React/Vue app fights back: inputs revert, a hidden duplicate node receives the click, a portal menu never becomes "visible", a button is disabled for a reason that only exists inside React Fiber. `gamba-browser` packages the fixes for those cases and exposes them as one-call helpers.

## Install

```bash
git clone https://github.com/OscarJRM/gamba-browser.git
cd gamba-browser
npm install
```

Requires Node 18+. Chrome, Chromium, Brave or Edge must be installed.

## Quick start

```bash
# 1. Verify the environment
node src/cli.js doctor

# 2. Log in once (the session stays in the profile directory)
node src/cli.js login https://x.com 3

# 3. Run Playwright against that live browser
node bin/gamba-exec -e 'await page.goto("https://example.com"); return await page.title()'

# 4. Target a specific tab
node bin/gamba-exec -e 'return page.url()' --target-url github.com
```

## MCP server

```bash
node src/mcp.js
```

Client configuration:

```json
{
  "mcpServers": {
    "gamba-browser": {
      "command": "node",
      "args": ["/absolute/path/to/gamba-browser/src/mcp.js"]
    }
  }
}
```

Tools: `gamba_status`, `gamba_list_tabs`, `gamba_open`, `gamba_inspect_state`, `gamba_smart_fill`, `gamba_smart_click`, `gamba_smart_select`, `gamba_explain_disabled`, `gamba_screenshot`.

The server keeps one CDP connection alive, so a multi-step agent loop does not pay process startup per call.

## Harness helpers

| Helper | Problem it solves |
| --- | --- |
| `smartFill(selector, value)` | React/Vue/Angular controlled inputs that revert synthetic values |
| `smartClick(target)` | Hidden duplicates, overlays, coordinate interception; three fallback tiers |
| `smartSelect(input, option)` | React Select / Radix / Meta portal comboboxes that otherwise hang for 30s |
| `explainDisabled(target)` | ARIA/HTML disabled, `pointer-events`, overlays, form validity, React Fiber props |
| `inspectState()` | Compact page snapshot: modal, buttons, inputs, alerts |
| `handleModal()` / `dismissAmbientModals()` | Sticky dialogs, cookie banners, upsell popups |
| `uploadFile(trigger, path)` | Native `filechooser` coordination with direct-input fallback |
| `getOrCreateTab(pattern, url)` | Reuse a tab instead of piling up new ones |

All helpers are attached to the page (`page.smartClick(...)`) and to `gamba-exec`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GAMBA_CHROME_PATH` | auto-detected | Browser executable |
| `GAMBA_PROFILE_DIR` | `./user_data` | Chrome profile (cookies/sessions) |
| `GAMBA_CDP_PORT` | `9222` | DevTools port |
| `GAMBA_JIRA_BASE_URL` | unset | Enables the optional Jira recipe |

## Measured latency (not a marketing claim)

Same machine, same Playwright script, alternating runs, local fixture:

| Workload | CDP driver (this project) | Extension relay (`browse`) |
| --- | ---: | ---: |
| Process startup + connect | ~1.2 s | ~0.10 s |
| Click | ~36 ms | ~280 ms |
| Type 197 chars (`keyboard.type`) | ~0.4 s | ~15.3 s |
| Type 197 chars (`insertText`) | ~0.08 s | ~0.66 s |

End-to-end X draft flow (trending -> profile -> compose -> text -> image -> save draft): **19.7 s vs 39.7 s** in favor of this project, almost entirely because the relay charges a round-trip per keystroke. With `insertText` the gap shrinks to ~13%.

What this does **not** mean: that agents complete tasks better here. `browse` ships session handoff (2FA/CAPTCHA), recording, tab adoption and a mature MCP surface. This project is a faster local driver with a stronger SPA harness.

Methodology and raw fixture: [`bench/README.md`](bench/README.md).

## Security

The DevTools port gives full control of a logged-in browser and has no authentication. Read [`SECURITY.md`](SECURITY.md) before using a profile with privileged accounts.

## License

MIT
