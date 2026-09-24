// Pruebas del portal: una persona entrando como cliente y otra como Planet,
// en dos ventanas, haciendo lo de todos los días.
import { test, expect } from '@playwright/test';

const API_PRODUCCION = 'https://portal-planet.gianlucca-planet.workers.dev';
const API_LOCAL = 'http://127.0.0.1:8787';

// Abre una ventana nueva (sin sesión) con el portal hablando con el servidor local
async function ventana(browser) {
  const context = await browser.newContext();
  await context.route(API_PRODUCCION + '/**', async (route) => {
    const url = route.request().url().replace(API_PRODUCCION, API_LOCAL);
    route.fulfill({ response: await route.fetch({ url }) });
  });
  const page = await context.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errores.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  return page;
}

async function entrar(page, usuario) {
  await page.fill('#login-user', usuario);
  await page.fill('#login-pass', 'clave123');
  await page.click('#login-btn');
  await expect(page.locator(usuario.endsWith('.planet') ? '#screen-planet' : '#screen-client')).toHaveClass(/active/);
  // Que no aparezca la guía de clientes nuevos en el medio de la prueba
  await page.evaluate(() => { local.guardar(claveGuia(), 1); if (_guia) cerrarGuia(); });
}

// Dispara la actualización automática sin esperar los 30 s
const revisar = (page) => page.evaluate(() => revisarNovedades());
const refrescar = (page) => page.evaluate(() => refrescar());

// Llamada directa al servidor local con la sesión de la página
const apiDe = (page, params) => page.evaluate((p) => api(p), params);

let n = 0;
const ref = (base) => `${base}-${Date.now().toString(36)}-${++n}`;

async function crearConsultaCliente(page, referencia, mensaje = 'No llegó el paquete') {
  await page.click('#screen-client .fab');
  await page.fill('#nq-ref', referencia);
  await page.selectOption('#nq-tipo', 'No entregado');
  await page.fill('#nq-mensaje', mensaje);
  await page.click('#nq-send');
  await expect(page.locator('#modal-new-query')).not.toHaveClass(/active/);
}

const tarjetaPlanet = (page, texto) => page.locator('.ticket-card', { hasText: texto });
const tarjetaCliente = (page, texto) => page.locator('.consulta-card', { hasText: texto });

test('login: datos incorrectos y salir', async ({ browser }) => {
  const page = await ventana(browser);
  await page.click('#login-btn');
  await expect(page.locator('#login-error')).toHaveText('Completá usuario y contraseña');
  await page.fill('#login-user', 'nico.nume');
  await page.fill('#login-pass', 'mala');
  await page.click('#login-btn');
  await expect(page.locator('#login-error')).toHaveText('Usuario o contraseña incorrectos');

  await entrar(page, 'nico.nume');
  await expect(page.locator('#client-org')).toHaveText('NUME');
  // La sesión queda guardada: al recargar entra directo
  await page.reload();
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await page.locator('#screen-client .topbar-actions button[title="Salir"]').click();
  await expect(page.locator('#screen-login')).toHaveClass(/active/);
  await page.reload();
  await expect(page.locator('#screen-login')).toHaveClass(/active/);
  expect(page.errores).toEqual([]);
});

test('circuito completo entre cliente y Planet', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('TRK');

  // 1. El cliente crea la consulta
  await crearConsultaCliente(cliente, 'Tracking ' + r, 'No llegó.\nLlamaron dos veces.');
  await expect(tarjetaCliente(cliente, r)).toBeVisible();

  // 2. Planet la ve como pendiente al actualizarse sola
  await revisar(planet);
  const t = tarjetaPlanet(planet, r);
  await expect(t).toBeVisible();
  await expect(t.locator('.ticket-status')).toHaveText('Pendiente');
  await t.locator('.card-summary').click();
  // El mensaje respeta los saltos de línea
  await expect(t.locator('.thread-text').first()).toHaveText('No llegó.\nLlamaron dos veces.');

  // 3. Planet pide info
  await t.locator('.thread-reply-input').fill('¿Cuál es la dirección?');
  await t.getByRole('button', { name: 'Enviar y pedir info' }).click();
  await planet.click('#planet-estado-filter >> text=Esperando info');
  await expect(tarjetaPlanet(planet, r).locator('.ticket-status')).toHaveText('Esperando info');

  // 4. El cliente lo ve en "Esperan tu respuesta" y contesta
  await revisar(cliente);
  await expect(cliente.locator('#client-mis-alert')).toContainText('Planet necesita info tuya');
  await cliente.locator('#client-mis-list .client-chip[data-v="espera"]').click();
  const tc = tarjetaCliente(cliente, r);
  await expect(tc.locator('.ticket-status')).toHaveText('Esperando tu respuesta');
  await tc.locator('.card-summary').click();
  await tc.locator('input[id^="reply-"]').fill('Calle Falsa 123');
  await tc.locator('.reply-send').click();
  // Ya no espera al cliente: pasa a "En proceso"
  await cliente.locator('#client-mis-list .client-chip[data-v="proceso"]').click();
  await expect(tarjetaCliente(cliente, r).locator('.timeline-item').last()).toContainText('Calle Falsa 123');

  // 5. Planet la ve de nuevo pendiente ("Respondió el cliente") y la cierra
  await revisar(planet);
  await planet.click('#planet-estado-filter >> text=Pendiente');
  const t2 = tarjetaPlanet(planet, r);
  await expect(t2.locator('.tag-respondio')).toBeVisible();
  await t2.getByRole('button', { name: 'Cerrar' }).click();
  await planet.click('#planet-estado-filter >> text=Cerrado');
  await expect(tarjetaPlanet(planet, r).locator('.ticket-status')).toHaveText('Cerrado');

  // 6. Al cliente le aparece el aviso de resuelta
  await revisar(cliente);
  await expect(cliente.locator('#client-mis-alert')).toContainText('Planet resolvió');
  await expect(cliente.locator('#client-stats')).toBeVisible();

  // 7. El cliente escribe en la cerrada: se reabre
  await cliente.locator('#client-mis-list .client-chip[data-v="cerrado"]').click();
  const tc2 = tarjetaCliente(cliente, r);
  await tc2.locator('.card-summary').click();
  await tc2.locator('input[id^="reply-"]').fill('Sigue sin llegar');
  await tc2.locator('.reply-send').click();
  // Cuando el servidor confirma, sale de "Cerradas" y vuelve a "Pendiente"
  await expect(tarjetaCliente(cliente, r)).toHaveCount(0);
  await cliente.locator('#client-mis-list .client-chip[data-v="pendiente"]').click();
  await expect(tarjetaCliente(cliente, r).locator('.tag-reabierta')).toBeVisible();
  await revisar(planet);
  await planet.click('#planet-estado-filter >> text=Pendiente');
  await expect(tarjetaPlanet(planet, r).locator('.tag-reabierta')).toBeVisible();

  expect(cliente.errores).toEqual([]);
  expect(planet.errores).toEqual([]);
});

test('seguridad: lo que escribe un cliente no se ejecuta en la pantalla de Planet', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'ana.planet');
  const r = ref('XSS');
  const ataque = `${r}" autofocus onfocus="window.__hackeado=1" x="`;
  const ataque2 = `<img src=x onerror="window.__hackeado=2">'); window.__hackeado=3; ('`;
  await crearConsultaCliente(cliente, ataque, ataque2);

  await revisar(planet);
  const t = tarjetaPlanet(planet, r);
  await expect(t).toBeVisible();
  await t.locator('.card-summary').click();
  await t.locator('.copy-btn').click();
  await planet.waitForTimeout(300);
  expect(await planet.evaluate(() => window.__hackeado)).toBeUndefined();
  expect(await cliente.evaluate(() => window.__hackeado)).toBeUndefined();
  // El texto se ve tal cual lo escribió, y el botón copia la referencia completa
  await expect(t.locator('.card-asunto')).toContainText(ataque);
  expect(await t.locator('.copy-btn').getAttribute('data-copiar')).toBe(ataque);
});

test('la actualización automática no borra lo que Planet está escribiendo', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('BORR');
  await crearConsultaCliente(cliente, r);
  await revisar(planet);

  const t = tarjetaPlanet(planet, r);
  await t.locator('.card-summary').click();
  await t.locator('.thread-reply-input').fill('Respuesta a medio escribir');
  await planet.click('#planet-stats');   // sale del cuadro de texto
  // Mientras tanto el cliente manda otra consulta
  await crearConsultaCliente(cliente, ref('OTRA'));
  await revisar(planet);
  await expect(t.locator('.thread-reply-input')).toHaveValue('Respuesta a medio escribir');
});

test('nueva consulta de Planet: el cliente elegido no cambia solo y queda en Enviadas', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'gabi.getbox');
  await entrar(planet, 'beto.planet');
  await planet.click('.sidebar-item[data-seccion="planet-nueva"]');
  await planet.selectOption('#pnq-cliente', 'GETBOX');
  const r = ref('ENV');
  await planet.fill('#pnq-ref', r);

  // Llega una consulta nueva de otro cliente y la pantalla se actualiza
  const otro = await ventana(browser);
  await entrar(otro, 'nico.nume');
  await crearConsultaCliente(otro, ref('MIENTRAS'));
  await refrescar(planet);
  await expect(planet.locator('#pnq-cliente')).toHaveValue('GETBOX');

  await planet.selectOption('#pnq-tipo', 'Otro');
  await planet.fill('#pnq-mensaje', 'Necesitamos el DNI del receptor');
  await planet.click('#pnq-send');
  // Muestra Enviadas y el menú marca Enviadas (antes marcaba Consultas)
  await expect(planet.locator('#planet-enviadas')).toHaveClass(/active/);
  await expect(planet.locator('.sidebar-item.active')).toHaveAttribute('data-seccion', 'planet-enviadas');
  await expect(tarjetaPlanet(planet, r)).toBeVisible();

  // Le llega a GETBOX, no a otro
  await revisar(cliente);
  await cliente.locator('.subtab', { hasText: 'De Planet' }).click();
  await expect(tarjetaCliente(cliente, r)).toBeVisible();
  const deNume = await apiDe(otro, { action: 'consultas' });
  expect(deNume.consultas.some((c) => c.asunto.includes(r))).toBe(false);
});

test('un cliente con apóstrofo en el nombre funciona en los filtros', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'dani.dangelo');
  await entrar(planet, 'beto.planet');
  const r = ref('APOS');
  await crearConsultaCliente(cliente, r);
  await revisar(planet);
  await planet.click('#planet-estado-filter >> text=Todos');
  await planet.locator('#planet-filter .client-chip', { hasText: "D'Angelo" }).click();
  await expect(planet.locator('#planet-filter .client-chip.active')).toHaveText("D'Angelo");
  await expect(tarjetaPlanet(planet, r)).toBeVisible();
  await expect(planet.locator('#planet-consultas-list .ticket-card')).toHaveCount(1);
  expect(planet.errores).toEqual([]);
});

test('buscador', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('BUSCA');
  await crearConsultaCliente(cliente, r, 'Paquete con la dirección equivocada');
  await revisar(planet);
  await planet.fill('#planet-search', 'direccion EQUIVOCADA');   // sin tilde y con mayúsculas
  await expect(planet.locator('#planet-search-info')).toContainText('resultado');
  await expect(tarjetaPlanet(planet, r)).toBeVisible();
  await planet.fill('#planet-search', 'palabra-que-no-existe-xyz');
  await expect(planet.locator('#planet-consultas-list')).toContainText('No hay consultas con ese filtro');
  await cliente.fill('#client-search', r);
  await expect(tarjetaCliente(cliente, r)).toBeVisible();
});

test('historial: las cerradas viejas se cargan a pedido', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'ana.planet');
  const r = ref('VIEJA');
  await crearConsultaCliente(cliente, r);
  const { consultas } = await apiDe(planet, { action: 'consultas' });
  const id = consultas.find((c) => c.asunto.includes(r)).id;
  await apiDe(planet, { action: 'cambiar_estado', id, estado: 'Cerrado' });
  // La hacemos "vieja" directo en la base local
  const { spawnSync } = await import('node:child_process');
  const cambio = spawnSync('npx', ['wrangler', 'd1', 'execute', 'portal-planet', '--local', '--persist-to', '.wrangler/pruebas',
    '--config', 'servidor/wrangler.toml', '--command', `"UPDATE consultas SET actualizado = 1000000000000 WHERE id = ${id}"`], { shell: true, encoding: 'utf8' });
  expect(cambio.status, cambio.stderr).toBe(0);

  await cliente.reload();
  await cliente.locator('#client-mis-list .client-chip[data-v="cerrado"]').click();
  await expect(tarjetaCliente(cliente, r)).toHaveCount(0);
  await cliente.locator('#client-mis-list .ver-historial').click();
  await expect(tarjetaCliente(cliente, r)).toBeVisible();
  await expect(cliente.locator('#client-mis-list .ver-historial')).toHaveCount(0);
});

test('fotos: adjuntar, enviar y ver', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('FOTO');
  await cliente.click('#screen-client .fab');
  await cliente.fill('#nq-ref', r);
  await cliente.selectOption('#nq-tipo', 'Paquete dañado');
  await cliente.fill('#nq-mensaje', 'Llegó roto');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const [selector] = await Promise.all([cliente.waitForEvent('filechooser'), cliente.click('#modal-new-query .attach-btn')]);
  await selector.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(1);
  await cliente.click('#nq-send');
  const t = tarjetaCliente(cliente, r);
  await t.locator('.card-summary').click();
  const img = t.locator('.msg-imgs img');
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await img.click();
  await expect(cliente.locator('#lightbox')).toHaveClass(/active/);
  await cliente.keyboard.press('Escape');
  await expect(cliente.locator('#lightbox')).not.toHaveClass(/active/);
  expect(cliente.errores).toEqual([]);
});

test('Planet: métricas, post-its y administración', async ({ browser }) => {
  const planet = await ventana(browser);
  await entrar(planet, 'ana.planet');

  await planet.click('.sidebar-item[data-seccion="planet-metricas"]');
  await expect(planet.locator('#met-contenido .met-tile')).toHaveCount(8);
  await planet.click('#met-periodo >> text=Desde siempre');
  await expect(planet.locator('#met-contenido')).toContainText('todo el historial');

  // Post-it: se crea, se escribe y queda guardado
  await planet.click('.sidebar-item[data-seccion="planet-consultas"]');
  await planet.click('.btn-nota');
  const nota = planet.locator('.postit').last();
  await nota.locator('textarea').fill('Llamar a NUME');
  await expect(nota.locator('.nota-estado')).toHaveText(/Guardado/, { timeout: 5000 });
  const { notas } = await apiDe(planet, { action: 'notas' });
  expect(notas.map((x) => x.texto)).toContain('Llamar a NUME');

  // Clientes
  await planet.click('.sidebar-item[data-seccion="planet-clientes"]');
  await expect(planet.locator('.cliente-ficha', { hasText: 'GETBOX' })).toBeVisible();
  const empresa = ref('Empresa');
  await planet.click('#planet-clientes .admin-cabecera .btn-send');
  await planet.fill('#nc-nombre', empresa);
  await planet.click('#new-client-form >> text=Crear cliente');
  await expect(planet.locator('.cliente-ficha', { hasText: empresa })).toBeVisible();

  // Usuarios: crear, editar y eliminar
  await planet.click('.sidebar-item[data-seccion="planet-usuarios"]');
  await expect(planet.locator('.tabla-admin')).toContainText('nico.nume');
  await planet.click('#planet-usuarios .admin-cabecera .btn-send');
  const usuario = ref('prueba').toLowerCase();
  await planet.fill('#nu-user', usuario);
  await planet.fill('#nu-name', 'Usuario de prueba');
  await planet.fill('#nu-pass', 'x123');
  await planet.selectOption('#nu-empresa', empresa);
  await planet.click('#new-user-form >> text=Crear usuario');
  const fila = planet.locator('.tabla-admin tr', { hasText: usuario });
  await expect(fila).toContainText(empresa);
  await fila.getByRole('button', { name: /Editar/ }).click();
  await planet.fill('#eu-nombre', 'Nombre cambiado');
  await planet.click('text=Guardar');
  await expect(planet.locator('.tabla-admin tr', { hasText: usuario })).toContainText('Nombre cambiado');
  await planet.locator('.tabla-admin tr', { hasText: usuario }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(planet.locator('.tabla-admin tr', { hasText: usuario })).toHaveCount(0);

  expect(planet.errores).toEqual([]);
});

test('Planet común no ve la administración', async ({ browser }) => {
  const planet = await ventana(browser);
  await entrar(planet, 'beto.planet');
  await expect(planet.locator('#admin-btn')).toBeHidden();
  await expect(planet.locator('#admin-clientes-btn')).toBeHidden();
});

test('celular: el cliente ve la barra de abajo y la guía la primera vez', async ({ browser }) => {
  const context = await browser.newContext({ ...(await import('@playwright/test')).devices['Pixel 7'] });
  await context.route(API_PRODUCCION + '/**', async (route) => {
    route.fulfill({ response: await route.fetch({ url: route.request().url().replace(API_PRODUCCION, API_LOCAL) }) });
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.fill('#login-user', 'gabi.getbox');
  await page.fill('#login-pass', 'clave123');
  await page.click('#login-btn');
  await expect(page.locator('.tab-bar')).toBeVisible();
  await expect(page.locator('.guia-card')).toBeVisible({ timeout: 5000 });
  await page.click('.guia-saltar');
  await expect(page.locator('.guia')).toHaveCount(0);
  // Sin desborde horizontal
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('una respuesta vieja del servidor no pisa un cambio recién hecho', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('CARRERA');
  await crearConsultaCliente(cliente, r);
  await revisar(planet);
  // Foto de la consulta tal como está ahora (Pendiente), como si fuera una
  // revisión automática que salió antes del cambio y llega tarde
  const vieja = await planet.evaluate((r) => JSON.parse(JSON.stringify(consultas.find((c) => c.asunto.includes(r)))), r);
  await planet.click('#planet-estado-filter >> text=Todos');
  await tarjetaPlanet(planet, r).locator('.card-summary').click();
  await tarjetaPlanet(planet, r).getByRole('button', { name: 'Cerrar' }).click();
  await expect(tarjetaPlanet(planet, r).locator('.ticket-status')).toHaveText('Cerrado');
  await planet.evaluate((v) => { if (recibirConsultas([v], false)) pintar(); }, vieja);
  await expect(tarjetaPlanet(planet, r).locator('.ticket-status')).toHaveText('Cerrado');
  // Y la versión nueva del servidor sí se acepta
  await refrescar(planet);
  await expect(tarjetaPlanet(planet, r).locator('.ticket-status')).toHaveText('Cerrado');
  expect(await planet.evaluate((r) => consultas.find((c) => c.asunto.includes(r)).cerrado_en > 0, r)).toBe(true);
});

// No verifica nada: deja capturas en test-results/capturas para mirarlas a ojo
test('capturas de pantalla', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'ana.planet');
  await crearConsultaCliente(cliente, 'Tracking 152089', 'El paquete figura entregado pero no llegó.\n¿Pueden revisar?');
  await crearConsultaCliente(cliente, 'Av. Siempreviva 742', 'Cambió la dirección de entrega');
  await revisar(planet);
  await planet.click('#planet-estado-filter >> text=Todos');
  await planet.locator('.ticket-card .card-summary').first().click();
  await planet.waitForTimeout(600);
  await planet.screenshot({ path: 'test-results/capturas/planet.png', fullPage: false });
  await planet.emulateMedia({ colorScheme: 'dark' });
  await planet.waitForTimeout(300);
  await planet.screenshot({ path: 'test-results/capturas/planet-oscuro.png' });
  await planet.click('.sidebar-item[data-seccion="planet-usuarios"]');
  await planet.waitForTimeout(800);
  await planet.screenshot({ path: 'test-results/capturas/usuarios-oscuro.png' });
  await planet.emulateMedia({ colorScheme: 'light' });
  await planet.click('.sidebar-item[data-seccion="planet-metricas"]');
  await planet.waitForTimeout(800);
  await planet.screenshot({ path: 'test-results/capturas/metricas.png' });

  await cliente.setViewportSize({ width: 390, height: 844 });
  await cliente.locator('#client-mis-list .client-chip[data-v="Todos"]').click();
  await cliente.locator('.consulta-card .card-summary').first().click();
  await cliente.waitForTimeout(600);
  await cliente.screenshot({ path: 'test-results/capturas/cliente-celular.png' });
});
