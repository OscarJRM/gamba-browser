const { launchBrowser } = require('../browser');

/**
 * Abre cualquier sitio web en una ventana interactiva de Chrome
 * para que el usuario pueda iniciar sesión manualmente y guardar cookies.
 * 
 * @param {string} url - URL del servicio (ej. https://x.com o https://instagram.com)
 * @param {number} [timeoutMinutes=3] - Minutos que la ventana permanecerá abierta.
 */
async function openLoginWindow(url, timeoutMinutes = 3) {
  console.log(`🚀 Abriendo ventana de login interactiva para: ${url}`);
  console.log(`⏳ La ventana permanecerá abierta por ${timeoutMinutes} minutos para que inicies sesión...`);

  const { context, page } = await launchBrowser({ headless: false });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const totalMs = timeoutMinutes * 60 * 1000;
    const intervalMs = 5000;
    let elapsed = 0;

    console.log("👉 Ingresa tus credenciales en la ventana de Chrome. Las cookies se guardarán solas.");

    while (elapsed < totalMs) {
      await page.waitForTimeout(intervalMs);
      elapsed += intervalMs;
      // Si el usuario cerró la ventana manualmente, salir
      if (page.isClosed()) {
        console.log("ℹ️ Ventana cerrada por el usuario.");
        break;
      }
    }

    console.log("💾 Guardando sesión y cerrando...");
  } finally {
    if (!context.pages().every(p => p.isClosed())) {
      await context.close();
    }
    console.log("✅ Sesión guardada. Ahora el sistema puede acceder automáticamente a este servicio.");
  }
}

module.exports = { openLoginWindow };
