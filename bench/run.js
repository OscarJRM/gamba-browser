#!/usr/bin/env node
'use strict';

// Compares this project's CDP driver against an extension-relay driver
// (browse) using the same Playwright code. Run: node bench/run.js

const { spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixture.html');
const PORT = Number(process.env.BENCH_PORT || 8123);
const RUNS = Number(process.env.BENCH_RUNS || 5);
const BASE = `http://127.0.0.1:${PORT}/fixture.html`;
const SHOT = path.join(__dirname, 'shot.png');

const tasks = [
  { name: 'ping', code: 'return { pong: true }' },
  { name: 'nav-local', code: `const t0=Date.now(); await page.goto("${BASE}",{waitUntil:"domcontentloaded"}); const t1=Date.now(); return {internalMs:t1-t0}` },
  { name: 'extract-100', code: `const t0=Date.now(); await page.goto("${BASE}",{waitUntil:"domcontentloaded"}); const rows=await page.$$eval("#rows li",e=>e.map(x=>x.textContent)); const t1=Date.now(); return {internalMs:t1-t0,count:rows.length}` },
  { name: 'form-3-fields', code: `const t0=Date.now(); await page.goto("${BASE}",{waitUntil:"domcontentloaded"}); await page.fill("#name","a"); await page.fill("#email","b@c.d"); await page.fill("#qty","3"); await page.click("#submit"); await page.waitForFunction(()=>document.querySelector("#out").textContent.includes("OK"),null,{timeout:5000}); const t1=Date.now(); return {internalMs:t1-t0}` },
  { name: 'screenshot', code: `const t0=Date.now(); await page.goto("${BASE}",{waitUntil:"domcontentloaded"}); await page.screenshot({path:"${SHOT}"}); const t1=Date.now(); return {internalMs:t1-t0}` }
];

function has(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
}

function run(tool, code) {
  const t0 = process.hrtime.bigint();
  const result = {
    gamba: spawnSync(path.join(ROOT, 'bin', 'gamba-exec'), ['-e', code], { encoding: 'utf8', timeout: 180000 }),
    browse: spawnSync('browse', ['execute', '--rm', '--timeout-ms', '60000', code], { encoding: 'utf8', timeout: 180000 })
  }[tool];
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  const match = out.match(/internalMs["']?\s*[:=]\s*(\d+)/);
  return { wallMs, internalMs: match ? Number(match[1]) : null, ok: result.status === 0 };
}

const median = (values) => {
  const sorted = values.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

async function main() {
  const server = http.createServer((req, res) => {
    fs.readFile(FIXTURE, (err, data) => {
      if (err) { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const tools = ['gamba'];
  if (has('browse')) tools.push('browse');
  else console.log('browse not found on PATH; measuring gamba only.');

  const data = {};
  for (const task of tasks) data[task.name] = Object.fromEntries(tools.map((t) => [t, []]));

  for (const task of tasks) for (const tool of tools) run(tool, task.code);

  for (let i = 1; i <= RUNS; i++) {
    for (const task of tasks) {
      for (const tool of tools) {
        const r = run(tool, task.code);
        data[task.name][tool].push(r);
        console.log(`[${i}/${RUNS}] ${tool.padEnd(7)} ${task.name.padEnd(14)} wall=${r.wallMs.toFixed(0)}ms internal=${r.internalMs}ms ok=${r.ok}`);
      }
    }
  }

  console.log('\nmedian wall time');
  for (const task of tasks) {
    const line = tools.map((t) => `${t}=${Math.round(median(data[task.name][t].map((r) => r.wallMs)))}ms`).join('  ');
    console.log(`${task.name.padEnd(16)} ${line}`);
  }
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
