const path = require('path');
const fs = require('fs');

/**
 * Universal Media Attachment Helper for SPAs (X/Twitter, Meta/Facebook, LinkedIn, Discord, etc.)
 * Handles both silent direct file inputs and native fileChooser event triggers.
 *
 * @param {import('playwright').Page} page
 * @param {string} filePath - Absolute or relative path to file
 * @param {object} [options]
 * @param {string} [options.triggerSelector] - Optional custom button selector that opens file dialog
 * @param {number} [options.timeout=10000] - Max wait timeout in ms
 * @param {boolean} [options.verifyAttachments=true] - Wait for platform attachment preview to mount
 * @returns {Promise<{ success: boolean, file: string }>}
 */
async function attachMedia(page, filePath, options = {}) {
  const {
    triggerSelector = null,
    timeout = 10000,
    verifyAttachments = true
  } = options;

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`attachMedia error: file not found at ${resolved}`);
  }

  // 1. Estrategia Directa (Playwright setInputFiles en input[type="file"])
  const fileInput = page.locator('input[type="file"]').first();
  const hasInput = await fileInput.count() > 0;

  if (hasInput && !triggerSelector) {
    try {
      await fileInput.setInputFiles(resolved);
    } catch (inputErr) {
      // Si falla setInputFiles directo (ej. input no interactuable), fallback a filechooser
      await uploadViaFileChooser(page, fileInput, resolved, timeout);
    }
  } else {
    // 2. Estrategia FileChooser (hacer clic en botón con listener activo)
    const trigger = triggerSelector
      ? page.locator(triggerSelector).first()
      : page.locator('button[aria-label*="Media" i], button[aria-label*="Foto" i], div[aria-label*="Foto" i]').first();

    await uploadViaFileChooser(page, trigger, resolved, timeout);
  }

  // 3. Verificación de montaje de previsualización
  if (verifyAttachments) {
    const attachmentSelectors = [
      'div[data-testid="attachments"]',               // X / Twitter
      'div[role="dialog"] img[src*="blob:"]',         // Facebook
      'div[role="dialog"] img[src*="data:image"]',    // Facebook/LinkedIn
      'div[aria-label*="Media preview" i]'            // Universal
    ];

    try {
      await page.waitForSelector(attachmentSelectors.join(','), { timeout: 6000 });
      await page.waitForTimeout(1000);
    } catch (e) {
      // Continuamos si no hay selector estándar visible
    }
  }

  return { success: true, file: resolved };
}

/**
 * Internal FileChooser trigger wrapper
 */
async function uploadViaFileChooser(page, triggerLocator, resolvedPath, timeout) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout }),
    triggerLocator.click({ timeout: 4000 })
  ]);
  await fileChooser.setFiles(resolvedPath);
}

/**
 * Universal In-Memory Canvas Crop Helper
 * Evita bloqueos de seguridad de Chrome (CORS/file://) pasando la imagen por Base64.
 *
 * @param {import('playwright').Page} page
 * @param {object} params
 * @param {string} params.sourceImagePath
 * @param {{ x: number, y: number, width: number, height: number }} params.cropBox
 * @param {string} params.outputPath
 * @param {number} [params.outputWidth]
 * @param {number} [params.outputHeight]
 */
async function cropAsset(page, params) {
  const {
    sourceImagePath,
    cropBox,
    outputPath,
    outputWidth = cropBox.width,
    outputHeight = cropBox.height
  } = params;

  const resolvedSrc = path.resolve(sourceImagePath);
  if (!fs.existsSync(resolvedSrc)) {
    throw new Error(`cropAsset error: Source file does not exist: ${resolvedSrc}`);
  }

  const base64Data = fs.readFileSync(resolvedSrc).toString('base64');
  const dataUrl = `data:image/png;base64,${base64Data}`;

  // Cargar en DOM de Chrome
  await page.evaluate((url) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        window._cropSourceImg = img;
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }, dataUrl);

  // Recortar con canvas
  const croppedDataUrl = await page.evaluate((box) => {
    const img = window._cropSourceImg;
    const canvas = document.createElement('canvas');
    canvas.width = box.outW;
    canvas.height = box.outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.outW, box.outH);
    return canvas.toDataURL('image/png');
  }, {
    x: cropBox.x,
    y: cropBox.y,
    w: cropBox.width,
    h: cropBox.height,
    outW: outputWidth,
    outH: outputHeight
  });

  const resolvedOut = path.resolve(outputPath);
  const buffer = Buffer.from(croppedDataUrl.split(',')[1], 'base64');
  fs.writeFileSync(resolvedOut, buffer);

  return { success: true, outputPath: resolvedOut, sizeBytes: buffer.length };
}

/**
 * Universal Sub-modal & Crop confirmation uploader
 * Handles platforms (X, LinkedIn, Facebook, GitHub, Discord) where uploading a profile banner
 * or avatar immediately triggers a crop/position modal followed by a profile save button.
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {import('playwright').Locator|string} options.fileInput - Target input[type="file"]
 * @param {string} options.filePath - Path to image file
 * @param {string|string[]} [options.cropConfirmSelectors] - Selector(s) for the Crop/Apply confirmation button
 * @param {string|string[]} [options.saveSelectors] - Selector(s) for the final form Save button
 * @param {string} [options.modalSelector] - Selector for the main modal dialog to wait until detached
 * @param {number} [options.timeout=10000] - Max wait timeout in ms
 * @returns {Promise<{ success: boolean }>}
 */
async function uploadWithModalConfirmation(page, options = {}) {
  const {
    fileInput,
    filePath,
    cropConfirmSelectors = [
      'button[data-testid="applyButton"]',
      'button:has-text("Apply")',
      'button:has-text("Aplicar")',
      'div[role="button"]:has-text("Apply")',
      'div[role="button"]:has-text("Aplicar")'
    ],
    saveSelectors = [
      'button[data-testid="Profile_Save_Button"]',
      'button:has-text("Save")',
      'button:has-text("Guardar")'
    ],
    modalSelector = 'div[role="dialog"]',
    timeout = 10000
  } = options;

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`uploadWithModalConfirmation error: File not found at ${resolved}`);
  }

  // 1. Inyectar archivo
  const inputLocator = typeof fileInput === 'string'
    ? page.locator(fileInput).first()
    : (fileInput || page.locator('input[type="file"]').first());

  await inputLocator.setInputFiles(resolved);

  // 2. Resolver modal de recorte si aparece
  if (cropConfirmSelectors) {
    const cropSelectorString = Array.isArray(cropConfirmSelectors)
      ? cropConfirmSelectors.join(', ')
      : cropConfirmSelectors;

    try {
      const cropBtn = page.locator(cropSelectorString).first();
      await cropBtn.waitFor({ state: 'visible', timeout: Math.min(timeout, 8000) });
      await cropBtn.click();
      await page.waitForTimeout(1000);
    } catch (e) {
      // Si la plataforma no abrió modal de recorte, continuamos
    }
  }

  // 3. Confirmar guardado del formulario/perfil
  if (saveSelectors) {
    const saveSelectorString = Array.isArray(saveSelectors)
      ? saveSelectors.join(', ')
      : saveSelectors;

    const saveBtn = page.locator(saveSelectorString).first();
    await saveBtn.waitFor({ state: 'visible', timeout });
    await saveBtn.click();

    // 4. Esperar a que el modal se cierre (garantiza persistencia y subida a CDN)
    if (modalSelector) {
      await page.locator(modalSelector).first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    } else {
      await page.waitForTimeout(3000);
    }
  }

  return { success: true };
}

module.exports = {
  attachMedia,
  cropAsset,
  uploadWithModalConfirmation
};
