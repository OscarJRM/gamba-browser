/**
 * Universal Navigation Helper for SPAs (X/Twitter, Meta, LinkedIn, etc.)
 * Avoids networkidle hangs caused by WebSockets, background event streaming, and analytics.
 */

/**
 * Resilient SPA navigation
 *
 * @param {import('playwright').Page} page
 * @param {string} url - Target URL
 * @param {object} [options]
 * @param {string} [options.readySelector] - CSS/XPath selector that confirms the page is ready
 * @param {number} [options.timeout=15000] - Max wait time in ms
 * @param {boolean} [options.skipIfSameUrl=true] - Skip navigation if already on this URL
 * @param {string} [options.waitUntil='domcontentloaded'] - Safe default lifecycle event
 * @returns {Promise<{ navigated: boolean, currentUrl: string }>}
 */
async function safeNavigate(page, url, options = {}) {
  const {
    readySelector = null,
    timeout = 15000,
    skipIfSameUrl = true,
    waitUntil = 'domcontentloaded'
  } = options;

  const currentUrl = page.url();

  if (skipIfSameUrl && (currentUrl === url || currentUrl.startsWith(url))) {
    if (readySelector) {
      await page.waitForSelector(readySelector, { timeout: Math.min(timeout, 5000) }).catch(() => {});
    }
    return { navigated: false, currentUrl };
  }

  // Navigate using domcontentloaded to prevent networkidle traps
  await page.goto(url, { waitUntil, timeout });

  if (readySelector) {
    await page.waitForSelector(readySelector, { timeout });
  }

  return { navigated: true, currentUrl: page.url() };
}

module.exports = {
  safeNavigate
};
