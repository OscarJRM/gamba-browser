---
name: browser-automation-copilot
description: >-
  Architectural patterns, best practices, and recipes for autonomous, zero-cost browser automation
  using native Chrome persistent context and Playwright. Covers direct URL route discovery,
  dual-identity switching (Facebook/Meta/LinkedIn), native OS fileChooser handling, SPA resilient selector
  strategies, and state verification.
---

# Browser Automation Copilot: The Zero-Cost Autonomous Playbook

A comprehensive guide for AI agents and developers building and running reliable, cost-free browser automations on complex modern web applications (Meta/Facebook, X/Twitter, LinkedIn, Google) using Playwright and native Chrome with persistent sessions.

---

## 1. Core Architectural Pillars

### A. Direct Route Discovery First (Stop Blind Clicking)
Never navigate blindly through multiple nested UI menus by trial-and-error when a direct URL or deep-link exists.
* **The Rule:** Before writing click sequences, perform a quick web search or inspect platform URL structures (e.g., direct settings subroutes, Meta Business Suite paths `business.facebook.com/latest/settings`, direct profile IDs).
* **Benefit:** Skips 80% of popups, promotional banners, tour tooltips, and dynamic layout shifts.

### B. The Dual-Identity & Role Context Switch (The Page Trap)
Modern platforms enforce role segregation (Personal User vs. Business Page / Organization).
* **The Problem:** Visiting a business page under a personal account displays the page in *viewer mode*. Administrative buttons (e.g., "Edit Cover", "Change Avatar", "Post as Page") do NOT exist in the DOM.
* **The Pattern:**
  1. Detect the identity banner/modal (e.g., `Cambia a la página X para administrarla`).
  2. Trigger the switch action and confirm the role switch modal.
  3. Wait for the reload/re-render under the target organization identity before attempting admin actions.

### C. The Native OS File Dialog Bypass (`fileChooser`)
Automations fail when a click opens the operating system's native file picker (macOS Finder / Windows Explorer), which cannot be manipulated via DOM APIs.
* **The Pattern:** Never click an "Upload" button synchronously without an active listener.
* **Code Recipe:**
  ```javascript
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    uploadTriggerButton.click()
  ]);
  await fileChooser.setFiles(absoluteFilePath);
  ```

### D. Resilient SPA Selectors & The Invisible Element Trap
Modern Single Page Applications (React, Relay, Vue) frequently maintain duplicate DOM nodes:
* Background buttons that are hidden or disabled (`aria-disabled="true"`, `tabindex="-1"`).
* Active modal buttons that are currently visible.
* **The Pattern:** Always filter by visibility and active interactive state:
  ```javascript
  // Bad: Fails or clicks the hidden background node
  await page.locator('div[role="button"]:has-text("Guardar")').click();

  // Good: Targets only the visible, interactive element
  await page.locator('div[role="dialog"]').getByRole('button', { name: 'Guardar' }).click({ force: true });
  // Or:
  await page.locator('button:has-text("Guardar"):not([aria-disabled="true"]):visible').first().click();
  ```

### E. Asynchronous Mutations & State Verification
Clicking "Save" or "Submit" triggers client-side image compression, hashing, and GraphQL/REST mutations.
* The button often transitions to a loading state (e.g., three dots `...`, spinner, or disabled).
* **The Pattern:** Do not immediately close the session. Wait for the confirmation modal to unmount, wait for `networkidle`, or perform a clean reload to capture a definitive proof screenshot.

### F. Controlled Inputs & The Framework Value Tracker Trap (`smartFill`)
Modern SPAs (React, Vue, Svelte) maintain internal state wrappers (`_valueTracker`). Simply setting `el.value = 'x'` does NOT notify the framework, causing the input to silently revert or fail to trigger store updates.
* **The Pattern:** Bypass the synthetic event wrapper by invoking the native `HTMLInputElement.prototype.value` setter, triggering standard bubbling `input` and `change` events, and applying `blur()`.
* **Code Recipe:** Use `await page.smartFill(selector, value)` or `smartFill(page, selector, value)`.

### G. Deep React Fiber & WAI-ARIA Diagnostic for Blocked Buttons (`explainDisabled`)
When an action button is disabled (`aria-disabled="true"` or `disabled="true"`), DOM inspection alone rarely explains the underlying business validation error.
* **The Pattern:** Walk the React Fiber tree (`__reactFiber$`) up to 25 parent levels, extracting validation error modules, `errorCodeNum`, warning notices, and disabled props.
* **Code Recipe:** Use `const report = await page.explainDisabled(selector)` or CLI `node src/cli.js inspect-disabled "<selector>"`.

### H. Split-Button Collision Defense (`clickPrimary`)
Compound buttons (e.g., "Publish" alongside a dropdown arrow for "Schedule") often share similar text or roles.
* **The Pattern:** Always filter out elements carrying `aria-haspopup="menu"`, `aria-haspopup="true"`, or `aria-expanded` when targeting the primary trigger.
* **Code Recipe:** Use `await page.clickPrimary("Publish")`.

### I. The Continuous Harness Evolution Loop (Explore, Resolve, Document, Package)
When an automation encounters an unprecedented edge case (e.g., closed shadow roots, canvas interaction, nested cross-origin iframes) where existing harness helpers do not suffice:
1. **Unrestricted Low-Level Exploration:** The agent is fully authorized to write ad-hoc scripts, inspect CDP sessions, and probe the raw DOM to overcome the immediate blocker.
2. **Document Findings in Playbook:** Record the exact root cause, failed attempts, and the working workaround in `PLAYBOOK.md`.
3. **Package as a Reusable Helper:** If the solution solves a generalizable pattern, promote it into `src/helpers/harness.js` or `cli.js` so future agents never have to re-solve that problem from scratch.

---

## 2. Zero-Cost Architecture vs. Cloud / LLM Services

| Vector | Persistent Local Chrome (Our Stack) | Cloud Browser / Per-Click LLM (Stagehand, Browserbase) |
| :--- | :--- | :--- |
| **Cost** | **$0.00**. Uses local machine power & native browser. | **Pay-per-minute + pay-per-token**. Requires external API keys (OpenAI/Anthropic). |
| **Authentication** | **100% Native**. Saved cookies, localStorage, session tokens in `user_data/`. | Requires syncing cookies or dealing with cloud IP bot-challenges. |
| **Speed** | Milliseconds per action once locators are resolved. | 2–5 seconds latency per action while LLM interprets the DOM. |
| **Stealth** | Native Google Chrome binary (`channel: 'chrome'`), eliminating automated Chromium flags. | Requires specialized stealth proxies and anti-detect patches. |

---

## 3. Standard Reusable Playwright Launcher

```javascript
const { chromium } = require('playwright');
const path = require('path');

async function launchAutonomousBrowser(options = {}) {
  const userDataDir = path.resolve(__dirname, 'user_data');
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: options.headless ?? false,
    viewport: { width: 1280, height: 950 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--test-type',
      '--disable-infobars',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  return { context, page };
}

// Human-like natural delay
const humanDelay = (min = 1000, max = 3000) => 
  new Promise(res => setTimeout(res, Math.floor(Math.random() * (max - min + 1)) + min));
```

---

## 4. Key Failure Modes & Troubleshooting

1. **`TimeoutError: waiting for locator ... to be visible`**  
   * *Cause:* Resolved to a hidden duplicate node, or an overlapping modal backdrop is intercepting pointer events.  
   * *Fix:* Scope the locator to the dialog container (`page.locator('div[role="dialog"]').locator(...)`) or use `{ force: true }`.
2. **Session Dropped / Login Wall Triggered**  
   * *Cause:* Launching without persistent storage or with an incognito context.  
   * *Fix:* Always verify `launchPersistentContext` points to the existing `user_data` directory. Never use `chromium.launch()`.
3. **Facebook Cover / Avatar Not Updating**  
   * *Cause:* The account is viewing the page in spectator mode rather than administrative mode.  
   * *Fix:* Execute the "Switch into Page" profile routine before checking for edit icons.
