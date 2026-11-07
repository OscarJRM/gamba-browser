#!/usr/bin/env node
'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const browserModule = require('./browser');
const pkg = require('../package.json');

const server = new McpServer({ name: 'gamba-browser', version: pkg.version });

let conn = null;

async function ensureConnection() {
  if (conn) {
    try {
      if (!conn.page.isClosed()) return conn;
    } catch (e) {}
    await conn.disconnect();
    conn = null;
  }
  conn = await browserModule.connectLive();
  return conn;
}

async function getPage(targetUrl) {
  const current = await ensureConnection();
  const page = browserModule.selectPage(current.context.pages(), { targetUrl }) || current.page;
  browserModule.attachHarness(page);
  return page;
}

function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(err) {
  return { isError: true, content: [{ type: 'text', text: err.message || String(err) }] };
}

function tool(handler) {
  return async (args) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  };
}

const targetUrlSchema = z.string().optional().describe('Only use the tab whose URL contains this text');

server.registerTool(
  'gamba_status',
  {
    title: 'Browser status',
    description: 'Report Chrome path, CDP port, profile directory, connection state and open tabs.',
    inputSchema: {}
  },
  tool(async () => {
    let connected = false;
    let tabs = [];
    let error;
    try {
      const current = await ensureConnection();
      connected = true;
      tabs = current.context.pages().map((p) => p.url());
    } catch (err) {
      error = err.message;
    }
    return {
      version: pkg.version,
      chrome: browserModule.findChromePath(),
      profile: browserModule.USER_DATA_DIR,
      cdpPort: browserModule.DEBUG_PORT,
      connected,
      tabs,
      ...(error ? { error } : {})
    };
  })
);

server.registerTool(
  'gamba_list_tabs',
  {
    title: 'List tabs',
    description: 'List the URLs of the tabs available in the connected Chrome profile.',
    inputSchema: {}
  },
  tool(async () => {
    const { context } = await ensureConnection();
    return context.pages().map((p, index) => ({ index, url: p.url() }));
  })
);

server.registerTool(
  'gamba_open',
  {
    title: 'Open page',
    description: 'Navigate the selected tab to a URL and return its title and final URL.',
    inputSchema: { url: z.string().describe('Absolute URL to open') }
  },
  tool(async ({ url }) => {
    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return { url: page.url(), title: await page.title() };
  })
);

server.registerTool(
  'gamba_inspect_state',
  {
    title: 'Inspect page state',
    description:
      'Return a compact, token-efficient snapshot of the visible page: URL, title, active modal, buttons, inputs and alerts.',
    inputSchema: { targetUrl: targetUrlSchema }
  },
  tool(async ({ targetUrl }) => {
    const page = await getPage(targetUrl);
    return page.inspectState();
  })
);

server.registerTool(
  'gamba_smart_fill',
  {
    title: 'Fill a controlled input',
    description:
      'Fill an input, textarea or contenteditable even when React/Vue/Angular reverts synthetic values. Accepts CSS, label, placeholder or aria-label.',
    inputSchema: {
      target: z.string().describe('CSS selector, label, placeholder, aria-label or id'),
      value: z.string().describe('Value to write'),
      targetUrl: targetUrlSchema
    }
  },
  tool(async ({ target, value, targetUrl }) => {
    const page = await getPage(targetUrl);
    return page.smartFill(target, value);
  })
);

server.registerTool(
  'gamba_smart_click',
  {
    title: 'Click a resilient target',
    description:
      'Click by selector or visible text with three fallback tiers (native click, physical coordinates, synthetic pointer events).',
    inputSchema: {
      target: z.string().describe('CSS selector or visible text'),
      targetUrl: targetUrlSchema
    }
  },
  tool(async ({ target, targetUrl }) => {
    const page = await getPage(targetUrl);
    return page.smartClick(target);
  })
);

server.registerTool(
  'gamba_smart_select',
  {
    title: 'Select an option in a combobox',
    description:
      'Pick an option in an autocomplete, React Select, Radix portal or Meta contextual layer without waiting for a 30s timeout.',
    inputSchema: {
      input: z.string().describe('Selector, label or placeholder of the combobox input'),
      option: z.string().describe('Visible text of the option to select'),
      targetUrl: targetUrlSchema
    }
  },
  tool(async ({ input, option, targetUrl }) => {
    const page = await getPage(targetUrl);
    return page.smartSelect(input, option);
  })
);

server.registerTool(
  'gamba_explain_disabled',
  {
    title: 'Explain why a control is blocked',
    description:
      'Diagnose a disabled or unclickable button: ARIA/HTML disabled, pointer-events, overlays, form validity and React Fiber props.',
    inputSchema: {
      target: z.string().describe('CSS selector or visible text of the control'),
      targetUrl: targetUrlSchema
    }
  },
  tool(async ({ target, targetUrl }) => {
    const page = await getPage(targetUrl);
    return page.explainDisabled(target);
  })
);

server.registerTool(
  'gamba_screenshot',
  {
    title: 'Take a screenshot',
    description: 'Capture the selected tab to a PNG file and return its absolute path.',
    inputSchema: {
      file: z.string().optional().describe('Output path (defaults to ./gamba-screenshot.png)'),
      targetUrl: targetUrlSchema
    }
  },
  tool(async ({ file, targetUrl }) => {
    const page = await getPage(targetUrl);
    const out = path.resolve(file || 'gamba-screenshot.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    return { path: out };
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`gamba-browser MCP ${pkg.version} ready`);
}

process.on('SIGINT', async () => {
  if (conn) await conn.disconnect().catch(() => {});
  process.exit(0);
});

main().catch((err) => {
  console.error(`gamba-browser MCP failed: ${err.message}`);
  process.exit(1);
});
