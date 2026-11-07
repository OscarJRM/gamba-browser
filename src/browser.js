'use strict';

const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const {
  attachHarness, getOrCreateTab, smartFill, smartClick, smartSelect,
  uploadFile, getActiveModal, handleModal, dismissAmbientModals,
  inspectState, explainDisabled, clickPrimary
} = require('./helpers/harness');

const ROOT = path.resolve(__dirname, '..');

const DEBUG_PORT = Number(process.env.GAMBA_CDP_PORT || 9222);
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const USER_DATA_DIR = path.resolve(process.env.GAMBA_PROFILE_DIR || path.join(ROOT, 'user_data'));

function findChromePath() {
  const fromEnv = process.env.GAMBA_CHROME_PATH || process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;

  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else if (process.platform === 'win32') {
    const bases = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const base of bases) {
      candidates.push(
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'
    );
  }
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function isChromeRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${DEBUG_URL}/json/version`, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.abort(); resolve(false); });
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

function profileLockExists() {
  try {
    fs.lstatSync(path.join(USER_DATA_DIR, 'SingletonLock'));
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureChromeRunning() {
  if (await isChromeRunning()) return true;

  if (await isPortInUse(DEBUG_PORT)) {
    throw new Error(
      `Port ${DEBUG_PORT} is already in use but does not answer as Chrome DevTools. ` +
      `Close that process or set GAMBA_CDP_PORT to a free port.`
    );
  }

  if (profileLockExists()) {
    throw new Error(
      `Chrome is already running with the profile at ${USER_DATA_DIR} without CDP.\n` +
      `Quit that Chrome instance, or use a dedicated profile:\n` +
      `  GAMBA_PROFILE_DIR="$HOME/.gamba-browser/profile" gamba-browser doctor`
    );
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'Could not find Chrome/Chromium. Set GAMBA_CHROME_PATH to the browser executable.'
    );
  }

  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--remote-debugging-address=127.0.0.1`,
      `--user-data-dir=${USER_DATA_DIR}`,
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--test-type',
      '--disable-infobars'
    ],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();

  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isChromeRunning()) return true;
    if (child.exitCode !== null) break;
  }

  throw new Error(
    `Chrome did not expose CDP on ${DEBUG_URL} within 15s.\n` +
    `Profile: ${USER_DATA_DIR}\n` +
    `Try closing Chrome and running \`gamba-browser doctor\`.`
  );
}

function matchesTarget(url, targetUrl) {
  if (!targetUrl) return false;
  if (targetUrl instanceof RegExp) return targetUrl.test(url);
  return url.includes(targetUrl);
}

function selectPage(pages, { targetUrl, targetIndex } = {}) {
  if (!pages.length) return null;
  if (targetUrl != null) {
    const found = pages.find((p) => matchesTarget(p.url(), targetUrl));
    if (found) return found;
  }
  if (Number.isInteger(targetIndex) && pages[targetIndex]) return pages[targetIndex];
  return pages[0];
}

async function connectLive(options = {}) {
  await ensureChromeRunning();

  const browser = await chromium.connectOverCDP(DEBUG_URL);
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const pages = context.pages();
  const page = selectPage(pages, options) || (await context.newPage());

  if (options.bringToFront) {
    try {
      if (process.platform === 'darwin') {
        execSync('osascript -e \'tell application "Google Chrome" to activate\'');
      }
    } catch (e) {}
  }

  attachHarness(page);
  context.getOrCreateTab = (pattern, fallback) => getOrCreateTab(context, pattern, fallback);

  return {
    browser,
    context,
    page,
    disconnect: async () => {
      try { await browser.close(); } catch (e) {}
    }
  };
}

async function launchBrowser(options = {}) {
  const { browser, context, page } = await connectLive(options);
  const originalClose = context.close.bind(context);
  context.close = async () => {
    try { await browser.close(); } catch (e) {}
  };
  return { browser, context, page, originalClose };
}

function mergeAllWindows() {
  if (process.platform !== 'darwin') return;
  try {
    execSync(`osascript -e '
      tell application "Google Chrome"
        if (count of windows) > 1 then
          set mainWindow to window 1
          repeat with i from (count of windows) to 2 by -1
            set w to window i
            repeat with t in tabs of w
              tell mainWindow to make new tab with properties {URL:(URL of t)}
            end repeat
            close w
          end repeat
        end if
      end tell
    '`);
  } catch (e) {}
}

function hideBrowser() {
  if (process.platform !== 'darwin') return;
  try {
    execSync('osascript -e \'tell application "System Events" to set visible of process "Google Chrome" to false\'');
  } catch (e) {}
}

function showBrowser() {
  if (process.platform !== 'darwin') return;
  try {
    execSync('osascript -e \'tell application "System Events" to set visible of process "Google Chrome" to true\'');
    execSync('osascript -e \'tell application "Google Chrome" to activate\'');
  } catch (e) {}
}

function stopLiveBrowser() {
  try {
    if (process.platform === 'win32') return;
    execSync(`pkill -f "remote-debugging-port=${DEBUG_PORT}"`);
  } catch (e) {}
}

async function humanType(element, text) {
  for (const char of text) {
    await element.type(char, { delay: Math.floor(Math.random() * 60) + 30 });
  }
}

async function humanDelay(minMs = 800, maxMs = 2000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

module.exports = {
  ROOT,
  USER_DATA_DIR,
  DEBUG_PORT,
  DEBUG_URL,
  findChromePath,
  isChromeRunning,
  isPortInUse,
  ensureChromeRunning,
  ensureLiveChrome: ensureChromeRunning,
  selectPage,
  matchesTarget,
  launchBrowser,
  connectLive,
  mergeAllWindows,
  hideBrowser,
  showBrowser,
  stopLiveBrowser,
  humanType,
  humanDelay,
  smartFill,
  smartClick,
  smartSelect,
  uploadFile,
  getActiveModal,
  handleModal,
  dismissAmbientModals,
  inspectState,
  explainDisabled,
  clickPrimary,
  getOrCreateTab,
  attachHarness
};
