'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const browserModule = require('../src/browser');
const harness = require('../src/helpers/harness');
const pkg = require('../package.json');

test('selectPage picks by url substring, regex and index', () => {
  const pages = [
    { url: () => 'https://github.com/OscarJRM' },
    { url: () => 'https://x.com/home' },
    { url: () => 'about:blank' }
  ];
  assert.equal(browserModule.selectPage(pages, { targetUrl: 'x.com' }).url(), 'https://x.com/home');
  assert.equal(browserModule.selectPage(pages, { targetUrl: /github/ }).url(), 'https://github.com/OscarJRM');
  assert.equal(browserModule.selectPage(pages, { targetIndex: 2 }).url(), 'about:blank');
  assert.equal(browserModule.selectPage(pages, { targetUrl: 'nope' }).url(), 'https://github.com/OscarJRM');
  assert.equal(browserModule.selectPage([], { targetUrl: 'x' }), null);
});

test('matchesTarget never throws on odd input', () => {
  assert.equal(browserModule.matchesTarget('https://a.test/x', 'a.test'), true);
  assert.equal(browserModule.matchesTarget('https://a.test/x', /b\.test/), false);
  assert.equal(browserModule.matchesTarget('https://a.test/x', null), false);
});

test('findChromePath honours GAMBA_CHROME_PATH', () => {
  const previous = process.env.GAMBA_CHROME_PATH;
  process.env.GAMBA_CHROME_PATH = '/tmp/fake-chrome';
  assert.equal(browserModule.findChromePath(), '/tmp/fake-chrome');
  if (previous === undefined) delete process.env.GAMBA_CHROME_PATH;
  else process.env.GAMBA_CHROME_PATH = previous;
});

test('harness exports every helper advertised in the README', () => {
  for (const name of [
    'smartFill', 'smartClick', 'smartSelect', 'uploadFile', 'getActiveModal',
    'handleModal', 'dismissAmbientModals', 'inspectState', 'explainDisabled',
    'clickPrimary', 'getOrCreateTab', 'attachHarness'
  ]) {
    assert.equal(typeof harness[name], 'function', `${name} must be exported`);
  }
});

test('smartFill is defined exactly once', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'helpers', 'harness.js'), 'utf8');
  const definitions = source.match(/async function smartFill/g) || [];
  assert.equal(definitions.length, 1);
});

test('package metadata is publishable', () => {
  assert.equal(pkg.name, 'gamba-browser');
  assert.equal(pkg.license, 'MIT');
  assert.ok(pkg.bin['gamba-exec']);
  assert.ok(pkg.files.includes('src'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'LICENSE')));
});
