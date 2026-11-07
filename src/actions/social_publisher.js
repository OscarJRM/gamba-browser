const path = require('path');
const { connectLive } = require('../browser');
const { cleanSurface, smartClick, insertFormattedText, uploadWithFileChooser } = require('./surface_cleaner');

/**
 * Universal Facebook Post Publisher (Profiles & Business Pages)
 */
async function publishFacebookPost(options = {}) {
  const {
    pageUrl = 'https://www.facebook.com/profile.php?id=100085891360900',
    text,
    imagePath,
    actionButton = null, // 'whatsapp' | 'messenger' | null
    dryRun = true,       // Default true: leaves on screen for manual review
    onProgress = () => {}
  } = options;

  onProgress({ step: 'CONNECTING', message: 'Conectando a la sesión de Chrome...' });
  const { page, disconnect } = await connectLive();

  try {
    // 1. Navigate to target page if not already there
    if (!page.url().includes(pageUrl.split('?')[0])) {
      onProgress({ step: 'NAVIGATING', message: `Navegando a ${pageUrl}...` });
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    // 2. Surface cleaning
    onProgress({ step: 'CLEANING', message: 'Limpiando popups y notificaciones...' });
    await cleanSurface(page);

    // 3. Open composer
    onProgress({ step: 'OPENING_COMPOSER', message: 'Abriendo cuadro de publicación...' });
    const composerTrigger = 'div[role="button"]:has-text("¿Qué estás pensando?"), div[role="button"]:has-text("Escribe algo"), span:has-text("¿Qué estás pensando?")';
    await smartClick(page, composerTrigger, { timeout: 4000 });
    await page.waitForTimeout(1500);

    // 4. Handle Action Button BEFORE photo if requested
    if (actionButton === 'whatsapp') {
      onProgress({ step: 'ATTACHING_CTA', message: 'Activando botón de WhatsApp...' });
      const moreBtn = 'div[role="dialog"] div[aria-label="Más"], div[role="dialog"] div[aria-label*="más" i]';
      await smartClick(page, moreBtn, { timeout: 3000 });
      await page.waitForTimeout(1000);

      const waBtn = 'div[role="button"]:has-text("Recibir mensajes de WhatsApp"), span:has-text("Recibir mensajes de WhatsApp")';
      await smartClick(page, waBtn, { timeout: 3000 });
      await page.waitForTimeout(1500);
    } else if (actionButton === 'messenger') {
      onProgress({ step: 'ATTACHING_CTA', message: 'Activando botón de Messenger...' });
      const moreBtn = 'div[role="dialog"] div[aria-label="Más"], div[role="dialog"] div[aria-label*="más" i]';
      await smartClick(page, moreBtn, { timeout: 3000 });
      await page.waitForTimeout(1000);

      const msgBtn = 'div[role="button"]:has-text("Recibir mensajes"), span:has-text("Recibir mensajes")';
      await smartClick(page, msgBtn, { timeout: 3000 });
      await page.waitForTimeout(1500);
    }

    // 5. Attach Media
    if (imagePath) {
      onProgress({ step: 'UPLOADING_MEDIA', message: `Subiendo imagen: ${path.basename(imagePath)}...` });
      const resolvedImg = path.resolve(imagePath);

      // In Facebook with WhatsApp/CTA card, the card input accepts heic/images only
      const dialogCardInput = page.locator('div[role="dialog"] input[type="file"][accept*="heic"]').first();
      const hasCardInput = await dialogCardInput.count().catch(() => 0);

      if (hasCardInput > 0) {
        await dialogCardInput.setInputFiles(resolvedImg);
        await page.waitForTimeout(2000);
      } else {
        // Fallback: Trigger fileChooser via button
        const photoTrigger = async () => {
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('div[role="button"]'))
              .find(b => b.innerText && (b.innerText.includes('Agregar fotos/videos') || b.getAttribute('aria-label')?.includes('Foto/video')));
            if (btn) btn.click();
          });
        };
        await uploadWithFileChooser(page, photoTrigger, resolvedImg, 8000);
        await page.waitForTimeout(2000);
      }
    }

    // 6. Insert Text Atomically
    if (text) {
      onProgress({ step: 'INSERTING_TEXT', message: 'Insertando texto formateado...' });
      const editorSelector = 'div[role="dialog"] [contenteditable="true"]';
      await insertFormattedText(page, editorSelector, text);
      await page.waitForTimeout(1000);
    }

    // 7. Capture visual proof and scroll verification
    onProgress({ step: 'VERIFYING', message: 'Verificando estado final...' });
    await page.evaluate(() => {
      const d = document.querySelector('div[role="dialog"]');
      if (d) {
        const scrollables = Array.from(d.querySelectorAll('*')).filter(el => el.scrollHeight > el.clientHeight);
        scrollables.forEach(s => s.scrollTop = s.scrollHeight);
      }
    });
    await page.waitForTimeout(500);

    const screenshotPath = '/tmp/live_post_preview.png';
    await page.screenshot({ path: screenshotPath });

    const statusReport = await page.evaluate(() => {
      const d = document.querySelector('div[role="dialog"]');
      return {
        hasDialog: !!d,
        textPreview: d?.innerText?.slice(0, 200),
        hasWhatsAppBadge: d?.innerText?.includes('WhatsApp') || false,
        hasImage: !!d?.querySelector('img[src^="blob:"]')
      };
    });

    onProgress({ step: 'READY', message: 'Publicación preparada y lista en pantalla.', status: statusReport });

    // 8. Publish or DryRun
    if (dryRun) {
      onProgress({ step: 'DRY_RUN', message: 'Modo revisión activo. Ventana dejada abierta en pantalla.' });
      return {
        success: true,
        dryRun: true,
        screenshot: screenshotPath,
        status: statusReport
      };
    } else {
      onProgress({ step: 'PUBLISHING', message: 'Haciendo clic en Siguiente / Publicar...' });
      const nextBtn = 'div[role="dialog"] div[aria-label="Siguiente"], div[role="dialog"] div[role="button"]:has-text("Siguiente"), div[role="dialog"] div[role="button"]:has-text("Publicar")';
      await smartClick(page, nextBtn, { timeout: 5000 });
      await page.waitForTimeout(2500);

      // Check if second "Publicar" confirmation button appears
      const publishConfirm = await page.$('div[role="dialog"] div[aria-label="Publicar"], div[role="dialog"] div[role="button"]:has-text("Publicar")');
      if (publishConfirm) {
        await publishConfirm.click();
        await page.waitForTimeout(4000);
      }

      onProgress({ step: 'PUBLISHED', message: '¡Post publicado exitosamente en el feed!' });
      return {
        success: true,
        dryRun: false,
        screenshot: screenshotPath
      };
    }
  } finally {
    await disconnect();
  }
}

module.exports = {
  publishFacebookPost
};
