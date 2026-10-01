// Pruebas en celular: corren en un iPhone (Safari) y en un Android (Chrome)
// simulados. Miran lo que más molesta en un teléfono: que nada se salga de la
// pantalla, que los botones se puedan tocar y que el teclado no haga zoom.
import { test, expect } from '@playwright/test';
import { ventana, entrar, revisar, apiDe, ref, tarjetaPlanet, tarjetaCliente, enServidor, PNG_1PX } from './ayuda.js';

// La ventana usa el celular del proyecto (iPhone o Android), no una de escritorio
const celular = (browser, testInfo) => {
  const { defaultBrowserType, ...opciones } = testInfo.project.use;
  return ventana(browser, {
    viewport: opciones.viewport, userAgent: opciones.userAgent, deviceScaleFactor: opciones.deviceScaleFactor,
    isMobile: opciones.isMobile, hasTouch: opciones.hasTouch, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
  });
};

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Campos visibles con letra de menos de 16 px: en iPhone, al tocarlos, la
// pantalla hace zoom sola y queda corrida.
const camposConZoom = (page) => page.evaluate(() =>
  [...document.querySelectorAll('input, textarea, select')]
    .filter((e) => e.type !== 'file' && e.getClientRects().length && e.offsetWidth)
    .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16)
    .map((e) => `${e.id || e.className} (${getComputedStyle(e).fontSize})`));

// ¿Se puede tocar de verdad? (está dentro de la pantalla y no hay nada encima)
const sePuedeTocar = (locator) => locator.evaluate((el) => {
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.bottom > window.innerHeight || r.top < 0 || r.right > window.innerWidth + 1 || r.left < 0) return 'fuera de la pantalla';
  const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return arriba && (arriba === el || el.contains(arriba)) ? 'ok' : 'tapado por ' + (arriba ? arriba.className || arriba.tagName : 'nada');
});

test('cliente en el celular: entra, crea una consulta con foto, responde y nada se sale de la pantalla', async ({ browser }, testInfo) => {
  const page = await celular(browser, testInfo);
  expect(await camposConZoom(page)).toEqual([]);
  await entrar(page, 'nico.nume');
  await expect(page.locator('.tab-bar')).toBeVisible();
  expect(await sinDesborde(page)).toBe(true);

  // Nueva consulta
  const r = ref('CEL');
  expect(await sePuedeTocar(page.locator('#screen-client .fab'))).toBe('ok');
  await page.locator('#screen-client .fab').tap();
  await expect(page.locator('#modal-new-query')).toHaveClass(/active/);
  await page.waitForTimeout(500);   // termina de subir la ventana
  expect(await camposConZoom(page)).toEqual([]);
  await page.fill('#nq-ref', r + ' Av. Corrientes 1234 piso 5 depto B');
  await page.selectOption('#nq-tipo', 'Dirección incorrecta / cambio de dirección');
  await page.fill('#nq-mensaje', 'El paquete fue a otra dirección.\nNecesito que lo reprogramen para mañana.');
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#modal-new-query .attach-btn').tap()]);
  await selector.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.locator('#prev-nq .img-prev')).toHaveCount(1);
  expect(await sePuedeTocar(page.locator('#nq-send'))).toBe('ok');
  expect(await sePuedeTocar(page.locator('#modal-new-query .modal-close'))).toBe('ok');
  expect(await sinDesborde(page)).toBe(true);
  await page.locator('#nq-send').tap();
  await expect(page.locator('#modal-new-query')).not.toHaveClass(/active/);

  // La abre y responde
  const t = tarjetaCliente(page, r);
  await expect(t).toBeVisible();
  await t.locator('.card-asunto').tap();
  await expect(t).toHaveClass(/open/);
  await page.waitForTimeout(500);
  await expect(t.locator('.msg-imgs img')).toHaveCount(1);
  expect(await camposConZoom(page)).toEqual([]);
  const campo = t.locator('input[id^="reply-"]');
  await campo.tap();
  await campo.fill('Gracias, quedo atento');
  expect(await sePuedeTocar(t.locator('.reply-send'))).toBe('ok');
  expect(await sePuedeTocar(t.locator('.attach-btn'))).toBe('ok');
  await t.locator('.reply-send').tap();
  await expect(campo).toHaveValue('');
  await expect(tarjetaCliente(page, r).locator('.timeline-item')).toHaveCount(2);
  expect(await sinDesborde(page)).toBe(true);

  // La foto se abre grande y se puede cerrar
  await tarjetaCliente(page, r).locator('.msg-imgs img').tap();
  await expect(page.locator('#lightbox')).toHaveClass(/active/);
  expect(await sePuedeTocar(page.locator('#lightbox .lightbox-close, #lightbox button').first())).toBe('ok');
  await page.evaluate(() => cerrarImagen());

  // Con una consulta abierta igual se puede crear otra: está en la barra de abajo
  expect(await sePuedeTocar(page.locator('#tab-nueva'))).toBe('ok');

  // Las solapas y el buscador
  for (const v of ['pendiente', 'proceso', 'espera', 'cerrado', 'Todos']) {
    await page.locator(`#client-list .client-chip[data-v="${v}"]`).tap();
    expect(await sinDesborde(page)).toBe(true);
  }
  await page.fill('#client-search', r);
  await expect(tarjetaCliente(page, r)).toBeVisible();

  const [c] = await enServidor(page, r);
  expect(c.mensajes).toHaveLength(2);
  expect(c.mensajes[0].imagenes).toHaveLength(1);
  expect(page.errores).toEqual([]);
});

test('cliente en el celular: la guía de la primera vez se puede recorrer y cerrar', async ({ browser }, testInfo) => {
  const admin = await ventana(browser);
  await entrar(admin, 'ana.planet');
  const usuario = ref('nuevo').toLowerCase();
  expect((await apiDe(admin, { action: 'crear_usuario', usuario, nombre: 'Nuevo', password: 'clave123', team: 'cliente', cliente: 'GETBOX' })).ok).toBe(true);

  const page = await celular(browser, testInfo);
  await page.fill('#login-user', usuario);
  await page.fill('#login-pass', 'clave123');
  await page.locator('#login-btn').tap();
  await expect(page.locator('.guia-card')).toBeVisible({ timeout: 8000 });
  // Recorre todos los pasos: cada uno entra entero en la pantalla
  let pasos = 0;
  for (; pasos < 12 && await page.locator('.guia-card').count(); pasos++) {
    const i = pasos;
    await page.waitForTimeout(600);
    const caja = await page.locator('.guia-card').boundingBox({ timeout: 2000 }).catch(() => null);
    if (!caja) break;   // se estaba cerrando
    const ancho = await page.evaluate(() => window.innerWidth), alto = await page.evaluate(() => window.innerHeight);
    expect(caja.x, 'paso ' + i).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width, 'paso ' + i).toBeLessThanOrEqual(ancho + 1);
    expect(caja.y, 'paso ' + i).toBeGreaterThanOrEqual(0);
    expect(caja.y + caja.height, 'paso ' + i).toBeLessThanOrEqual(alto + 1);
    await page.locator('.guia-card button').last().tap();
  }
  await expect(page.locator('.guia')).toHaveCount(0);
  expect(pasos).toBeGreaterThanOrEqual(5);
  // No vuelve a salir sola
  await page.reload();
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await page.waitForTimeout(1500);
  await expect(page.locator('.guia')).toHaveCount(0);
  expect(page.errores).toEqual([]);
  await apiDe(admin, { action: 'eliminar_usuario', usuario });
});

test('cliente en el celular: textos larguísimos y girar el teléfono', async ({ browser }, testInfo) => {
  const page = await celular(browser, testInfo);
  await entrar(page, 'dani.dangelo');
  const r = ref('CELARGO');
  const res = await apiDe(page, {
    action: 'nueva_consulta', tipo: 'Otro', asunto: `${r}${'W'.repeat(150)} · D'Angelo · Otro`,
    mensaje: 'https://www.ejemplo.com.ar/seguimiento/' + 'abc123'.repeat(40) + '\n' + 'Texto normal con muchas palabras. '.repeat(60),
  });
  expect(res.ok).toBe(true);
  await page.evaluate(() => refrescar());
  await page.fill('#client-search', r);
  const t = tarjetaCliente(page, r);
  await t.locator('.card-asunto').tap();
  await page.waitForTimeout(500);
  expect(await sinDesborde(page)).toBe(true);
  expect(await sePuedeTocar(t.locator('.reply-send'))).toBe('ok');

  // Acostado
  const { width, height } = page.viewportSize();
  await page.setViewportSize({ width: height, height: width });
  await page.waitForTimeout(300);
  expect(await sinDesborde(page)).toBe(true);
  expect(await sePuedeTocar(t.locator('.reply-send'))).toBe('ok');
  await page.locator('#screen-client .fab').evaluate((f) => f.classList.remove('oculto'));
  await page.evaluate(() => abrirNuevaConsultaCliente());
  await page.waitForTimeout(500);
  expect(await sePuedeTocar(page.locator('#nq-send'))).toBe('ok');
  expect(page.errores).toEqual([]);
});

test('Planet en el celular: puede ver, responder y cerrar', async ({ browser }, testInfo) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('PCEL');
  expect((await apiDe(cliente, { action: 'nueva_consulta', asunto: `${r} · NUME · No entregado`, tipo: 'No entregado', mensaje: 'No llegó' })).ok).toBe(true);

  const page = await celular(browser, testInfo);
  await entrar(page, 'ana.planet', true);
  // El resumen de turno entra en la pantalla y se puede cerrar
  await expect(page.locator('#modal-turno')).toHaveClass(/active/);
  await page.waitForTimeout(500);
  expect(await sePuedeTocar(page.locator('#turno-acciones .btn-primary'))).toBe('ok');
  await page.locator('#turno-acciones .btn-primary').tap();
  await expect(page.locator('#modal-turno')).not.toHaveClass(/active/);
  expect(await sinDesborde(page)).toBe(true);
  expect(await camposConZoom(page)).toEqual([]);

  await page.fill('#planet-search', r);
  const t = tarjetaPlanet(page, r);
  await expect(t).toBeVisible();
  await t.locator('.card-asunto').tap();
  await page.waitForTimeout(500);
  expect(await sinDesborde(page)).toBe(true);
  expect(await camposConZoom(page)).toEqual([]);
  for (const nombre of ['Enviar', 'Enviar y pedir info', 'Enviar y cerrar']) {
    expect(await sePuedeTocar(t.getByRole('button', { name: nombre, exact: true })), nombre).toBe('ok');
  }
  await t.locator('.thread-reply-input').fill('Lo vemos y te avisamos');
  await t.getByRole('button', { name: 'Enviar y cerrar', exact: true }).tap();
  await expect(page.locator('.sl-host')).toContainText(/cerrada/i);
  expect((await enServidor(page, r))[0].estado).toBe('Cerrado');

  // Desde el celular también se llega a las otras secciones
  for (const seccion of ['planet-nueva', 'planet-metricas', 'planet-clientes', 'planet-usuarios', 'planet-consultas']) {
    const boton = page.locator(`[data-seccion="${seccion}"]`).first();
    expect(await sePuedeTocar(boton), seccion).toBe('ok');
    await boton.tap();
    await expect(page.locator('#' + seccion)).toHaveClass(/active/);
    await page.waitForTimeout(400);
    expect(await sinDesborde(page), seccion).toBe(true);
  }
  expect(page.errores).toEqual([]);
});

// No verifica nada: deja capturas en test-results/capturas para mirarlas a ojo
test('capturas de pantalla en el celular', async ({ browser }, testInfo) => {
  const nombre = (n) => 'test-results/capturas/' + testInfo.project.name + '-' + n + '.png';
  const page = await celular(browser, testInfo);
  await page.screenshot({ path: nombre('1-login') });
  await entrar(page, 'nico.nume');
  const r = ref('FOTO');
  await apiDe(page, { action: 'nueva_consulta', asunto: r + ' Av. Corrientes 1234 · NUME · Dirección incorrecta / cambio de dirección', tipo: 'Otro', mensaje: 'El paquete fue a otra dirección.' });
  await page.evaluate(() => refrescar());
  await page.locator('#client-list .client-chip[data-v="Todos"]').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: nombre('2-cliente-lista') });
  await page.fill('#client-search', r);
  await tarjetaCliente(page, r).locator('.card-asunto').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: nombre('3-cliente-consulta-abierta') });
  await page.locator('#tab-nueva').tap();
  await page.waitForTimeout(700);
  await page.screenshot({ path: nombre('4-cliente-nueva-consulta') });

  const planet = await celular(browser, testInfo);
  await entrar(planet, 'ana.planet');
  await planet.waitForTimeout(700);
  await planet.screenshot({ path: nombre('5-planet-lista') });
  await planet.fill('#planet-search', r);
  await tarjetaPlanet(planet, r).locator('.card-asunto').tap();
  await planet.waitForTimeout(700);
  await planet.screenshot({ path: nombre('6-planet-consulta-abierta'), fullPage: true });
});
