const path = require('path');
const { connectLive } = require('../browser');
const { cleanSurface, smartClick, insertFormattedText } = require('./surface_cleaner');
const { attachMedia, uploadWithModalConfirmation } = require('../helpers/media');
const { safeNavigate } = require('../helpers/navigation');

const COMPOSE_URL = 'https://x.com/compose/post';
const PROFILE_SETTINGS_URL = 'https://x.com/settings/profile';

/**
 * Universal X (Twitter) Publisher & Draft Copilot
 *
 * @param {object} options
 * @param {string} options.text - Tweet copy content
 * @param {string|string[]} [options.imagePath] - File path(s) to attach
 * @param {boolean} [options.dryRun=true] - If true, leaves draft open in Chrome for human inspection
 * @param {function} [options.onProgress] - Status callback
 * @returns {Promise<{ success: boolean, durationMs: number, proofScreenshot?: string }>}
 */
async function postToX(options = {}) {
  const {
    text,
    imagePath = null,
    dryRun = true,
    onProgress = () => {}
  } = options;

  if (!text && !imagePath) {
    throw new Error('postToX error: You must provide text or at least one image.');
  }

  const startTime = Date.now();
  onProgress({ step: 'CONNECTING', message: 'Conectando a la sesión de Chrome...' });
  const { page, disconnect } = await connectLive();

  try {
    // 1. Abrir compositor de X
    onProgress({ step: 'NAVIGATING', message: 'Navegando al compositor de X...' });
    await page.goto(COMPOSE_URL, { waitUntil: 'domcontentloaded' });

    // 2. Limpieza de superficie (notificaciones / dialogs)
    await cleanSurface(page);

    // 3. Esperar y enfocar caja de texto
    onProgress({ step: 'TYPING', message: 'Insertando texto del tweet...' });
    const textboxSelector = 'div[data-testid="tweetTextarea_0"]';
    await page.waitForSelector(textboxSelector, { timeout: 12000 });

    // Inserción limpia instantánea sin tipeo lento
    await insertFormattedText(page, textboxSelector, text);

    // 4. Adjuntar imagen(es) si se especificaron
    if (imagePath) {
      onProgress({ step: 'ATTACHING_MEDIA', message: 'Adjuntando archivo de medios...' });
      const paths = Array.isArray(imagePath) ? imagePath : [imagePath];
      for (const p of paths) {
        await attachMedia(page, p, { verifyAttachments: true });
      }
    }

    const durationMs = Date.now() - startTime;
    const proofPath = path.resolve(__dirname, '../../screenshots/x_post_status.png');

    // 5. Decisión de publicación vs. Borrador
    if (dryRun) {
      onProgress({ step: 'DRY_RUN_READY', message: '👀 Borrador listo en pantalla para revisión manual.' });
      await page.screenshot({ path: proofPath });
      console.log(`✅ Borrador preparado en ${(durationMs / 1000).toFixed(2)}s.`);
      console.log(`📸 Captura de confirmación: ${proofPath}`);
      return { success: true, dryRun: true, durationMs, proofScreenshot: proofPath };
    }

    // Publicación real (dryRun = false)
    onProgress({ step: 'PUBLISHING', message: 'Publicando tweet en los servidores de X...' });
    const tweetBtnSelector = 'button[data-testid="tweetButton"]';
    await page.waitForSelector(tweetBtnSelector, { timeout: 5000 });
    await smartClick(page, tweetBtnSelector);

    // Esperar a que el modal de composición se cierre tras la confirmación
    await page.waitForTimeout(3000);
    await page.screenshot({ path: proofPath });

    const totalDuration = Date.now() - startTime;
    console.log(`🚀 ¡Tweet publicado con éxito en ${(totalDuration / 1000).toFixed(2)}s!`);
    return { success: true, dryRun: false, durationMs: totalDuration, proofScreenshot: proofPath };

  } finally {
    // Desconecta el socket CDP dejando la pestaña abierta e interactiva
    await disconnect();
  }
}

/**
 * Reply to an existing tweet
 */
async function replyToX(statusUrl, options = {}) {
  const { text, imagePath = null, dryRun = true } = options;
  const { page, disconnect } = await connectLive();

  try {
    await page.goto(statusUrl, { waitUntil: 'domcontentloaded' });
    await cleanSurface(page);

    const replyBox = 'div[data-testid="tweetTextarea_0"], div[role="textbox"][aria-label*="Respuesta" i]';
    await page.waitForSelector(replyBox, { timeout: 10000 });
    await insertFormattedText(page, replyBox, text);

    if (imagePath) {
      await attachMedia(page, imagePath, { verifyAttachments: true });
    }

    if (!dryRun) {
      await smartClick(page, 'button[data-testid="tweetButtonInline"]');
      await page.waitForTimeout(2500);
    }
    return { success: true, dryRun };
  } finally {
    await disconnect();
  }
}

/**
 * Update X (Twitter) profile banner (header photo)
 *
 * @param {string} imagePath - Path to header image
 * @param {object} [options]
 * @param {function} [options.onProgress]
 * @returns {Promise<{ success: boolean, durationMs: number, proofScreenshot: string }>}
 */
async function updateProfileBanner(imagePath, options = {}) {
  const { onProgress = () => {} } = options;
  const startTime = Date.now();

  onProgress({ step: 'CONNECTING', message: 'Conectando a Chrome live...' });
  const { page, disconnect } = await connectLive();

  try {
    onProgress({ step: 'NAVIGATING', message: 'Navegando a configuración de perfil de X...' });
    await safeNavigate(page, PROFILE_SETTINGS_URL, {
      readySelector: 'input[data-testid="fileInput"]',
      timeout: 15000
    });

    onProgress({ step: 'UPLOADING_BANNER', message: 'Subiendo imagen y confirmando recorte...' });
    // En el modal de edición de perfil de X, el primer file input es la portada (Header)
    const bannerInput = page.locator('input[type="file"][data-testid="fileInput"]').first();

    await uploadWithModalConfirmation(page, {
      fileInput: bannerInput,
      filePath: imagePath,
      cropConfirmSelectors: [
        'button[data-testid="applyButton"]',
        'div[role="button"]:has-text("Apply")',
        'div[role="button"]:has-text("Aplicar")'
      ],
      saveSelectors: [
        'button[data-testid="Profile_Save_Button"]',
        'button:has-text("Save")',
        'button:has-text("Guardar")'
      ],
      modalSelector: 'div[role="dialog"]',
      timeout: 12000
    });

    onProgress({ step: 'CAPTURING_PROOF', message: 'Capturando comprobante de perfil...' });
    const proofPath = path.resolve(__dirname, '../../screenshots/profile_banner_status.png');
    await page.screenshot({ path: proofPath });

    const totalDuration = Date.now() - startTime;
    console.log(`✅ Portada de perfil actualizada en ${(totalDuration / 1000).toFixed(2)}s.`);
    return { success: true, durationMs: totalDuration, proofScreenshot: proofPath };

  } finally {
    await disconnect();
  }
}

module.exports = {
  postToX,
  replyToX,
  updateProfileBanner
};
