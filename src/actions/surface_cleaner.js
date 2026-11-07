/**
 * Surface Cleaner: Cleans up popups, ghost dialogs, notification drawers,
 * and backdrop overlays across SPAs (Meta/Facebook, X, LinkedIn).
 */
async function cleanSurface(page) {
  return await page.evaluate(() => {
    const cleaned = [];

    // 1. Remove rogue notifications flyouts that block pointer events
    const notifs = document.querySelectorAll('div[role="dialog"][aria-label*="Notificaciones" i], div[aria-label*="Notifications" i][role="dialog"]');
    notifs.forEach(el => {
      el.remove();
      cleaned.push('notif_drawer_removed');
    });

    // 2. Click close buttons on secondary info popups / story notes
    const noteClose = Array.from(document.querySelectorAll('div[role="dialog"] div[aria-label="Cerrar"], div[role="dialog"] button'))
      .filter(b => b.getAttribute('aria-label') === 'Cerrar' || (b.innerText && b.innerText.includes('Cerrar')));
    noteClose.forEach(b => {
      const dialog = b.closest('div[role="dialog"]');
      if (dialog && !dialog.innerText.includes('Crear publicación')) {
        b.click();
        cleaned.push('secondary_dialog_closed');
      }
    });

    return cleaned;
  });
}

/**
 * Universal Smart Click:
 * Tries normal Playwright click with short 1500ms timeout.
 * If blocked by an animation, transparent overlay, or parent interceptor,
 * immediately falls back to native mouse coordinate click.
 */
async function smartClick(page, selectorOrLocator, options = {}) {
  const timeout = options.timeout || 1800;

  try {
    if (typeof selectorOrLocator === 'string') {
      await page.waitForSelector(selectorOrLocator, { timeout });
      const el = page.locator(selectorOrLocator).first();
      await el.click({ timeout, force: options.force || false });
    } else {
      await selectorOrLocator.click({ timeout, force: options.force || false });
    }
    return { success: true, method: 'direct' };
  } catch (err) {
    // Fallback to bounding box coordinate click
    try {
      const box = typeof selectorOrLocator === 'string'
        ? await page.locator(selectorOrLocator).first().boundingBox({ timeout: 1000 })
        : await selectorOrLocator.boundingBox({ timeout: 1000 });

      if (box && box.width > 0 && box.height > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return { success: true, method: 'mouse_coords', coords: box };
      }
    } catch (coordErr) {
      // Last resort: evaluate synthetic click
      const evalSuccess = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          return true;
        }
        return false;
      }, typeof selectorOrLocator === 'string' ? selectorOrLocator : null).catch(() => false);

      if (evalSuccess) return { success: true, method: 'evaluate_click' };
    }
    throw new Error(`smartClick failed for selector: ${selectorOrLocator}: ${err.message}`);
  }
}

/**
 * Instant Atomic Text Insertion:
 * Injects formatted multiline text into Lexical / Draft.js / Prosemirror editors
 * without slow letter-by-letter typing.
 */
async function insertFormattedText(page, targetSelector, text) {
  if (targetSelector) {
    try {
      const locator = page.locator(targetSelector).first();
      await locator.click({ timeout: 2000 });
    } catch (e) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.focus();
      }, targetSelector);
    }
  }
  await page.waitForTimeout(200);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(300);
}

/**
 * Native File Chooser Trigger:
 * Executes a trigger action while listening for OS fileChooser event.
 */
async function uploadWithFileChooser(page, triggerFn, filePath, timeout = 8000) {
  const path = require('path');
  const resolved = path.resolve(filePath);

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout }),
    triggerFn()
  ]);

  await fileChooser.setFiles(resolved);
  await page.waitForTimeout(1500);
  return { success: true, file: resolved };
}

module.exports = {
  cleanSurface,
  smartClick,
  insertFormattedText,
  uploadWithFileChooser
};
