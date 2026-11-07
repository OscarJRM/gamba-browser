#!/usr/bin/env node
'use strict';

const path = require('path');
const pkg = require('../package.json');

function load(name) {
  return require(`./actions/${name}`);
}

function printHelp() {
  console.log(`
gamba-browser ${pkg.version} — drive your real Chrome from scripts and AI agents

Usage:
  gamba-browser <command> [options]

Getting started:
  doctor                     Check Chrome, CDP port, profile and Playwright
  login <url> [minutes]      Open a window, log in once, keep the session
  mcp                        Run the MCP server over stdio

Automation recipes:
  screenshot <url> [file]    Navigate with your session and save a screenshot
  post-x <text> [--image p] [--dry-run]
  set-banner-x <image>
  post-facebook <text> [--image p] [--dry-run]

Harness (inspect and act on the current tab):
  list-tabs
  inspect-disabled <selector|text> [url-filter]
  smart-fill <selector|label> <value> [url-filter]

Eval runner:
  gamba-exec -e "<playwright code>"

Docs: https://github.com/OscarJRM/gamba-browser
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-v') {
    console.log(pkg.version);
    return;
  }

  const browser = require('./browser');

  if (command === 'doctor') {
    const { findChromePath } = browser;
    const chrome = findChromePath();
    const cdp = await browser.isChromeRunning();
    const port = await browser.isPortInUse(browser.DEBUG_PORT);
    console.log(`gamba-browser   ${pkg.version}`);
    console.log(`node            ${process.version}`);
    console.log(`platform        ${process.platform}/${process.arch}`);
    console.log(`playwright      ${require('playwright/package.json').version}`);
    console.log(`chrome          ${chrome || 'NOT FOUND (set GAMBA_CHROME_PATH)'}`);
    console.log(`profile         ${browser.USER_DATA_DIR}`);
    console.log(`cdp port        ${browser.DEBUG_PORT}${cdp ? ' (connected)' : port ? ' (in use, not CDP)' : ' (free)'}`);
    console.log(`github          https://github.com/OscarJRM/gamba-browser`);
    if (!chrome) process.exitCode = 1;
    return;
  }

  if (command === 'mcp') {
    require('./mcp');
    return;
  }

  if (command === 'login') {
    const { openLoginWindow } = load('login');
    const url = args[1] || 'https://x.com';
    const timeout = parseInt(args[2], 10) || 3;
    await openLoginWindow(url, timeout);
    return;
  }

  if (command === 'post-x') {
    const { postToX } = load('x');
    const text = args[1];
    let imagePath = null;
    let dryRun = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--image' && args[i + 1]) { imagePath = args[++i]; }
      else if (args[i] === '--dry-run') { dryRun = true; }
    }
    if (!text && !imagePath) throw new Error('Provide post text or an --image path.');
    await postToX({ text, imagePath, dryRun, onProgress: (p) => console.log(`[${p.step}] ${p.message}`) });
    return;
  }

  if (command === 'set-banner-x') {
    const { updateProfileBanner } = load('x');
    if (!args[1]) throw new Error('Usage: gamba-browser set-banner-x <image>');
    await updateProfileBanner(args[1], { onProgress: (p) => console.log(`[${p.step}] ${p.message}`) });
    return;
  }

  if (command === 'post-facebook') {
    const { postToFacebook } = load('facebook');
    const text = args[1];
    let imagePath = null;
    let dryRun = false;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--image' && args[i + 1]) { imagePath = args[++i]; }
      else if (args[i] === '--dry-run') { dryRun = true; }
    }
    if (!text) throw new Error('Provide post text.');
    await postToFacebook({ text, imagePath, dryRun });
    return;
  }

  if (command === 'screenshot') {
    const url = args[1] || 'https://example.com';
    const outputPath = args[2] || 'screenshot.png';
    const { context, page } = await browser.launchBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: outputPath });
    await context.close();
    console.log(`Saved ${path.resolve(outputPath)}`);
    return;
  }

  if (command === 'list-tabs') {
    const { context, disconnect } = await browser.connectLive();
    const pages = context.pages();
    pages.forEach((p, i) => console.log(`[${i}] ${p.url()}`));
    await disconnect();
    return;
  }

  if (command === 'inspect-disabled' || command === 'smart-fill') {
    const target = args[1];
    if (!target) throw new Error(`Usage: gamba-browser ${command} <target> [value] [url-filter]`);
    const { page, disconnect } = await browser.connectLive({ targetUrl: args[3] });
    try {
      if (command === 'inspect-disabled') {
        console.log(JSON.stringify(await page.explainDisabled(target), null, 2));
      } else {
        const value = args[2];
        if (value === undefined) throw new Error('smart-fill requires a value');
        console.log(JSON.stringify(await page.smartFill(target, value), null, 2));
      }
    } finally {
      await disconnect();
    }
    return;
  }

  throw new Error(`Unknown command: ${command}. Run "gamba-browser --help".`);
}

main().catch((err) => {
  console.error(`gamba-browser: ${err.message}`);
  process.exit(1);
});
