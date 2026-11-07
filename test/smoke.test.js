'use strict';

const test = require('node:test');
const assert = require('node:assert');

const enabled = process.env.GAMBA_TEST_BROWSER === '1';

test('live browser smoke test', { skip: !enabled && 'set GAMBA_TEST_BROWSER=1 to run' }, async () => {
  const { connectLive } = require('../src/browser');
  const { page, disconnect } = await connectLive();
  try {
    await page.goto('about:blank');
    assert.equal(await page.evaluate(() => 1 + 1), 2);
    assert.equal(typeof page.smartClick, 'function');
    assert.equal(typeof page.inspectState, 'function');
  } finally {
    await disconnect();
  }
});
