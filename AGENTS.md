# AGENTS.md — runbook for AI agents

How to operate this repository if you are an autonomous agent (Claude Code, Codex, Cursor, Windsurf, etc.).

## 1. What this is

`gamba-browser` connects Playwright to the user's real Chrome over CDP, using a persistent profile, and exposes a harness for SPAs that fight automation. It also ships an MCP server.

## 2. Structure

```text
gamba-browser/
├── bin/gamba-exec          # Playwright eval/script runner
├── src/browser.js          # Chrome detection, CDP connection, page selection
├── src/cli.js              # Human CLI (doctor, login, recipes, harness)
├── src/mcp.js              # MCP server over stdio
├── src/helpers/harness.js  # smartFill, smartClick, smartSelect, explainDisabled...
├── src/helpers/sites/      # Optional site recipes (lazy loaded)
├── src/actions/            # Example flows (X, Facebook, login)
├── bench/                  # Latency benchmark and fixture
└── user_data/              # Chrome profile with real cookies (gitignored)
```

## 3. Rules

1. **Never delete `user_data/` or `GAMBA_PROFILE_DIR`.** It holds the user's sessions.
2. **Never publish without `--dry-run` first.** Any social action must show a screenshot of the draft before the final click.
3. **Do not replace harness helpers with raw `page.evaluate()`.** Use `page.smartFill`, `page.smartClick`, `page.smartSelect`, `page.explainDisabled`, `page.inspectState`, `page.handleModal`.
4. **Prefer direct URLs** over navigating nested menus; fewer modals, fewer A/B tests.
5. **Never type long text with `keyboard.type`.** Use `keyboard.insertText` or `smartFill`; per-keystroke round-trips are the main latency source.
6. **Read the docs before writing a flow:** `skills/gamba-browser/SKILL.md` and `docs/PLAYBOOK.md`.
7. **If a new edge case appears** (shadow DOM, canvas, nested iframes), solve it, document it in `docs/PLAYBOOK.md`, and promote the generalizable part into `src/helpers/harness.js`.

## 4. Commands

```bash
node src/cli.js doctor
node src/cli.js login "https://x.com" 3
node src/cli.js list-tabs
node src/cli.js inspect-disabled "Publish"
node src/cli.js smart-fill "Budget" "1.00"
node bin/gamba-exec -e 'return await page.title()'
node bin/gamba-exec -e 'return page.url()' --target-url github.com
node src/mcp.js
```

## 5. Adding a site recipe

1. Create `src/helpers/sites/<site>.js`, export `attach<Site>(page)`, and read configuration from env vars (no hardcoded domains).
2. Load it lazily from `attachHarness` inside `try/catch`; a missing recipe must never break the harness.
3. Keep selectors scoped to roles/test ids, and verify the resulting state, not just the click.
