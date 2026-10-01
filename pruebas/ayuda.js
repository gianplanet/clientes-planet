// Lo que comparten todas las pruebas del portal.
import { expect } from '@playwright/test';

export const API_PRODUCCION = 'https://portal-planet.gianlucca-planet.workers.dev';
export const API_LOCAL = 'http://127.0.0.1:8787';

// Una foto de 1 píxel, para adjuntar
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// Abre una ventana nueva (sin sesión) con el portal hablando con el servidor local.
// opciones: las del contexto del navegador (por ejemplo, un modelo de celular).
export async function ventana(browser, opciones = {}) {
  const context = await browser.newContext(opciones);
  await context.route(API_PRODUCCION + '/**', async (route) => {
    const url = route.request().url().replace(API_PRODUCCION, API_LOCAL);
    try { await route.fulfill({ response: await route.fetch({ url }) }); }
    catch { /* la ventana se cerró con un pedido en camino */ }
  });
  const page = await context.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errores.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  return page;
}

export async function entrar(page, usuario, dejarResumen) {
  await page.fill('#login-user', usuario);
  await page.fill('#login-pass', 'clave123');
  await page.click('#login-btn');
  await expect(page.locator(usuario.endsWith('.planet') ? '#screen-planet' : '#screen-client')).toHaveClass(/active/);
  // El resumen de turno tapa la pantalla: salvo que la prueba lo esté mirando, se cierra
  const turno = page.locator('#modal-turno');
  if (!dejarResumen && await turno.evaluate((e) => e.classList.contains('active')).catch(() => false)) {
    await page.evaluate(() => cerrarResumenTurno());
    await expect(turno).not.toHaveClass(/active/);
  }
  // Que no aparezca la guía de clientes nuevos en el medio de la prueba
  await page.evaluate(() => { local.guardar(claveGuia(), 1); if (_guia) cerrarGuia(); });
}

// Dispara la actualización automática sin esperar los 30 s
export const revisar = (page) => page.evaluate(() => revisarNovedades());
export const refrescar = (page) => page.evaluate(() => refrescar());

// Llamada directa al servidor local con la sesión de la página
export const apiDe = (page, params) => page.evaluate((p) => api(p), params);

let n = 0;
export const ref = (base) => `${base}-${Date.now().toString(36)}-${++n}`;

export async function crearConsultaCliente(page, referencia, mensaje = 'No llegó el paquete') {
  await page.click('#screen-client .fab');
  await page.fill('#nq-ref', referencia);
  await page.selectOption('#nq-tipo', 'No entregado');
  await page.fill('#nq-mensaje', mensaje);
  await page.click('#nq-send');
  await expect(page.locator('#modal-new-query')).not.toHaveClass(/active/);
}

export const tarjetaPlanet = (page, texto) => page.locator('.ticket-card', { hasText: texto });
export const tarjetaCliente = (page, texto) => page.locator('.consulta-card', { hasText: texto });

// Cuántas consultas hay en el servidor con ese texto en el asunto, y sus mensajes
export async function enServidor(page, texto) {
  const res = await apiDe(page, { action: 'consultas', historial: 1 });
  return res.consultas.filter((c) => c.asunto.includes(texto));
}

// Hace que los pedidos de una acción al servidor tarden o fallen.
// modo: 'cortar' (sin conexión), 'error' (el servidor se cae), o milisegundos de demora.
// Devuelve una función para volver a la normalidad.
export async function estorbar(page, accion, modo) {
  const patron = API_PRODUCCION + '/**';
  const handler = async (route) => {
    let cuerpo = {};
    try { cuerpo = JSON.parse(route.request().postData() || '{}'); } catch {}
    if (cuerpo.action !== accion) return route.fallback();
    if (modo === 'cortar') return route.abort('internetdisconnected');
    if (modo === 'error') return route.fulfill({ status: 500, contentType: 'text/html', body: '<h1>Error 1101</h1>' });
    await new Promise((r) => setTimeout(r, modo));
    return route.fallback();
  };
  await page.context().route(patron, handler);
  return () => page.context().unroute(patron, handler);
}
