const path = require('path');
const { launchBrowser, humanType, humanDelay } = require('../browser');

/**
 * Automatiza una publicación en el muro de Facebook.
 * 
 * @param {Object} options
 * @param {string} options.text - Texto a publicar.
 * @param {string} [options.imagePath] - Ruta absoluta o relativa de una imagen opcional.
 * @param {boolean} [options.dryRun=false] - Si es true, deja el post escrito y toma foto sin darle a 'Publicar'.
 */
async function postToFacebook(options = {}) {
  const { text, imagePath, dryRun = false } = options;

  if (!text && !imagePath) {
    throw new Error("Se requiere al menos texto o una imagen para publicar.");
  }

  console.log("🚀 [Facebook] Iniciando navegador con sesión persistente...");
  const { context, page } = await launchBrowser({ headless: false });

  try {
    console.log("🌐 [Facebook] Navegando a facebook.com...");
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    await humanDelay(3000, 5000);

    // 1. Detectar si la sesión está activa
    const isLogin = await page.$('input[name="email"]');
    if (isLogin) {
      throw new Error("La sesión no está activa. Ejecuta 'login' primero.");
    }

    console.log("🔍 [Facebook] Buscando caja de publicación ('¿Qué estás pensando?')...");
    
    // Selectores comunes de la caja inicial de post
    const openBoxSelector = 'div[role="main"] div[role="button"]:has-text("¿Qué estás pensando"), span:has-text("¿Qué estás pensando")';
    const openBox = await page.waitForSelector(openBoxSelector, { timeout: 15000 });
    
    console.log("🖱️ [Facebook] Haciendo clic en la caja de publicación...");
    await openBox.click();
    await humanDelay(2000, 3500);

    // 2. Esperar que abra el modal y encontrar el área editable
    console.log("⌨️ [Facebook] Escribiendo texto...");
    const editorSelector = 'div[role="dialog"] div[contenteditable="true"], div[role="dialog"] div[aria-label*="¿Qué estás pensando"]';
    const editor = await page.waitForSelector(editorSelector, { timeout: 10000 });
    
    await editor.click();
    await humanDelay(500, 1000);
    await humanType(editor, text);
    await humanDelay(1500, 2500);

    // 3. Adjuntar imagen si se proporcionó
    if (imagePath) {
      const resolvedPath = path.resolve(imagePath);
      console.log(`🖼️ [Facebook] Adjuntando imagen desde: ${resolvedPath}`);
      
      // Buscar botón de 'Foto/video' dentro del modal
      const photoBtn = await page.$('div[role="dialog"] div[aria-label*="Foto/video"], div[role="dialog"] div[aria-label*="Photo/video"]');
      if (photoBtn) {
        await photoBtn.click();
        await humanDelay(1000, 2000);
      }

      // Localizar el input file oculto y asignarle la ruta
      const fileInput = await page.waitForSelector('div[role="dialog"] input[type="file"]', { timeout: 8000 });
      await fileInput.setInputFiles(resolvedPath);
      console.log("⏳ [Facebook] Esperando carga de la imagen...");
      await humanDelay(3000, 5000);
    }

    // 4. Modo DryRun vs Publicación Real
    const screenshotPath = path.resolve(__dirname, '..', 'facebook_post_preview.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 [Facebook] Captura guardada en: ${screenshotPath}`);

    if (dryRun) {
      console.log("🛡️ [Facebook] MODO PRUEBA (dryRun=true): No se pulsó 'Publicar'.");
    } else {
      console.log("🚀 [Facebook] Pulsando botón 'Publicar'...");
      const publishBtn = await page.waitForSelector('div[role="dialog"] div[aria-label="Publicar"], div[role="dialog"] div[aria-label="Post"]', { timeout: 10000 });
      await publishBtn.click();
      console.log("⏳ [Facebook] Esperando confirmación de publicación...");
      await humanDelay(4000, 6000);
      console.log("🎉 [Facebook] ¡Publicación realizada con éxito!");
    }

    return { success: true, screenshot: screenshotPath };

  } finally {
    await humanDelay(2000, 3000);
    await context.close();
    console.log("🔒 [Facebook] Navegador cerrado.");
  }
}

module.exports = { postToFacebook };
