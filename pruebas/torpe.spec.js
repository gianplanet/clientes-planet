// Pruebas de "cliente torpe": lo que pasa cuando alguien usa el portal mal o
// con mala suerte — doble clic, internet que se corta, mensajes enormes,
// archivos que no son fotos, la sesión que vence en el medio.
import { test, expect } from '@playwright/test';
import {
  ventana, entrar, revisar, refrescar, apiDe, ref, crearConsultaCliente,
  tarjetaPlanet, tarjetaCliente, enServidor, estorbar, PNG_1PX,
} from './ayuda.js';

const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Abre la tarjeta de una consulta. La busca por su referencia: con muchas
// consultas la lista muestra de a 20 y podría no estar a la vista.
async function abrirTarjetaCliente(page, r) {
  await page.fill('#client-search', r);
  const t = tarjetaCliente(page, r);
  await t.locator('.card-summary').click();
  return t;
}
async function abrirTarjetaPlanet(page, r) {
  await page.click('#planet-estado-filter >> text=Todos');
  await page.fill('#planet-search', r);
  const t = tarjetaPlanet(page, r);
  await t.locator('.card-summary').click();
  return t;
}

test('doble clic en "Enviar consulta" crea una sola', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('DOBLE');
  const normal = await estorbar(cliente, 'nueva_consulta', 700);
  await cliente.click('#screen-client .fab');
  await cliente.fill('#nq-ref', r);
  await cliente.selectOption('#nq-tipo', 'No entregado');
  await cliente.fill('#nq-mensaje', 'Mensaje');
  await cliente.locator('#nq-send').dblclick();
  await cliente.locator('#nq-send').click({ force: true, timeout: 2000 }).catch(() => {});
  await expect(cliente.locator('#modal-new-query')).not.toHaveClass(/active/);
  await normal();
  expect(await enServidor(cliente, r)).toHaveLength(1);
  await cliente.fill('#client-search', r);
  await expect(tarjetaCliente(cliente, r)).toHaveCount(1);
  expect(cliente.errores).toEqual([]);
});

test('apurado: Enter y clic repetidos al responder mandan un solo mensaje', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('APURO');
  await crearConsultaCliente(cliente, r);

  // El cliente
  const normalC = await estorbar(cliente, 'responder', 700);
  const tc = await abrirTarjetaCliente(cliente, r);
  const campo = tc.locator('input[id^="reply-"]');
  await campo.fill('Una sola vez');
  await campo.press('Enter');
  await campo.press('Enter').catch(() => {});
  await tc.locator('.reply-send').click({ force: true, timeout: 2000 }).catch(() => {});
  await expect(campo).toHaveValue('');
  await normalC();

  // Planet
  await revisar(planet);
  const normalP = await estorbar(planet, 'responder', 700);
  const tp = await abrirTarjetaPlanet(planet, r);
  await tp.locator('.thread-reply-input').fill('Respuesta única');
  await tp.getByRole('button', { name: 'Enviar', exact: true }).dblclick();
  await tp.getByRole('button', { name: 'Enviar y pedir info' }).click({ force: true, timeout: 2000 }).catch(() => {});
  await expect(tarjetaPlanet(planet, r).locator('.thread-reply-input')).toHaveValue('');
  await normalP();

  const [c] = await enServidor(planet, r);
  expect(c.mensajes.map((m) => m.texto)).toEqual(['No llegó el paquete', 'Una sola vez', 'Respuesta única']);
  // En pantalla tampoco se ve repetido, ni después de actualizarse
  await refrescar(planet);
  await expect(tarjetaPlanet(planet, r).locator('.thread-msg')).toHaveCount(3);
  await refrescar(cliente);
  await expect(tarjetaCliente(cliente, r).locator('.timeline-item')).toHaveCount(3);
});

test('mensajes vacíos o de puros espacios no se mandan', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('VACIO');
  await crearConsultaCliente(cliente, r);
  const t = await abrirTarjetaCliente(cliente, r);
  await t.locator('input[id^="reply-"]').fill('     ');
  await t.locator('.reply-send').click();
  await cliente.waitForTimeout(500);

  // Nueva consulta con campos de puros espacios
  await cliente.keyboard.press('Escape');
  await cliente.evaluate(() => abrirNuevaConsultaCliente());
  await cliente.fill('#nq-ref', '   ');
  await cliente.selectOption('#nq-tipo', 'Otro');
  await cliente.fill('#nq-mensaje', '  \n  ');
  await cliente.click('#nq-send');
  await expect(cliente.locator('#modal-new-query')).toHaveClass(/active/);

  const mias = await enServidor(cliente, r);
  expect(mias).toHaveLength(1);
  expect(mias[0].mensajes).toHaveLength(1);
  // Directo al servidor, salteando la pantalla: tampoco
  expect((await apiDe(cliente, { action: 'responder', id: mias[0].id, texto: '   ' })).ok).toBe(false);
  expect((await apiDe(cliente, { action: 'nueva_consulta', asunto: '  ', mensaje: 'x' })).ok).toBe(false);
});

test('textos larguísimos: se avisa en vez de cortarlos, y no rompen la pantalla', async ({ browser }) => {
  const cliente = await ventana(browser, { viewport: { width: 390, height: 844 } });
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('LARGO');

  // Los campos tienen tope: escribiendo no se puede pasar
  await cliente.click('#screen-client .fab');
  expect(await cliente.getAttribute('#nq-ref', 'maxlength')).toBe('120');
  expect(await cliente.getAttribute('#nq-mensaje', 'maxlength')).toBe('5000');
  // Pegando sí (o con un navegador viejo): se avisa y no se manda cortado
  await cliente.fill('#nq-ref', r);
  await cliente.selectOption('#nq-tipo', 'Dirección incorrecta / cambio de dirección');
  await cliente.evaluate(() => { $('nq-mensaje').value = 'x'.repeat(5001); });
  await cliente.click('#nq-send');
  await expect(cliente.locator('.sl-host')).toContainText(/muy largo/);
  await expect(cliente.locator('#modal-new-query')).toHaveClass(/active/);
  expect(await enServidor(cliente, r)).toHaveLength(0);

  // Justo en el tope entra entero: referencia de 120 sin espacios y mensaje de 5000
  const refLarga = (r + 'W'.repeat(120)).slice(0, 120);
  const mensaje = ('palabra '.repeat(560) + 'https://ejemplo.com/' + 'a'.repeat(300) + ' ' + 'z'.repeat(5000)).slice(0, 4997) + 'FIN';
  await cliente.fill('#nq-ref', refLarga);
  await cliente.fill('#nq-mensaje', mensaje);
  await cliente.click('#nq-send');
  await expect(cliente.locator('#modal-new-query')).not.toHaveClass(/active/);
  const [c] = await enServidor(cliente, r);
  expect(c.mensajes[0].texto).toHaveLength(5000);
  expect(c.mensajes[0].texto.endsWith('FIN')).toBe(true);
  expect(c.asunto).toBe(refLarga + ' · NUME · Dirección incorrecta / cambio de dirección');

  const t = await abrirTarjetaCliente(cliente, r);
  await expect(t).toBeVisible();
  await cliente.waitForTimeout(500);
  expect(await sinDesborde(cliente)).toBe(true);

  // La respuesta: igual
  const campo = t.locator('input[id^="reply-"]');
  expect(await campo.getAttribute('maxlength')).toBe('5000');
  await campo.evaluate((el) => { el.value = 'r'.repeat(6000); });
  await t.locator('.reply-send').click();
  await expect(cliente.locator('.sl-host')).toContainText(/muy largo/);
  await expect(campo).toHaveValue('r'.repeat(6000));   // no se pierde lo escrito
  expect((await enServidor(cliente, r))[0].mensajes).toHaveLength(1);

  await revisar(planet);
  const tp = await abrirTarjetaPlanet(planet, r);
  expect(await tp.locator('.thread-reply-input').getAttribute('maxlength')).toBe('5000');
  await planet.waitForTimeout(500);
  expect(await sinDesborde(planet)).toBe(true);
  expect(cliente.errores).toEqual([]);
  expect(planet.errores).toEqual([]);
});

test('Planet no puede cerrar una consulta con un mensaje del cliente que todavía no vio', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('SINLEER');
  await crearConsultaCliente(cliente, r);
  await revisar(planet);
  const tp = await abrirTarjetaPlanet(planet, r);
  // Planet empieza a escribir (la pantalla deja de actualizarse sola) y justo el cliente agrega algo
  await tp.locator('.thread-reply-input').fill('Ya fue entregado');
  const tc = await abrirTarjetaCliente(cliente, r);
  await tc.locator('input[id^="reply-"]').fill('¡Ojo! Cambió la dirección');
  await tc.locator('.reply-send').click();
  await expect(tc.locator('input[id^="reply-"]')).toHaveValue('');

  await tp.getByRole('button', { name: 'Enviar y cerrar' }).click();
  await expect(planet.locator('.sl-host')).toContainText('Hay un mensaje nuevo');
  // No se cerró, aparece el mensaje del cliente y no se perdió lo que Planet escribía
  const t2 = tarjetaPlanet(planet, r);
  await expect(t2.locator('.thread-text').last()).toHaveText('¡Ojo! Cambió la dirección');
  await expect(t2.locator('.thread-reply-input')).toHaveValue('Ya fue entregado');
  await expect(t2.locator('.ticket-status')).not.toHaveText('Cerrado');
  expect((await enServidor(planet, r))[0].mensajes).toHaveLength(2);

  // El botón "Cerrar" solo, con la pantalla vieja, tampoco (lo simulamos con la versión anterior)
  const vieja = (await enServidor(planet, r))[0].actualizado - 1;
  const res = await apiDe(planet, { action: 'cambiar_estado', id: (await enServidor(planet, r))[0].id, estado: 'Cerrado', visto: vieja });
  expect(res.novedad).toBe(true);

  // Ahora que lo leyó, cierra normalmente
  await t2.getByRole('button', { name: 'Enviar y cerrar' }).click();
  await expect(planet.locator('.sl-host')).toContainText(/cerrada/i);
  const [c] = await enServidor(planet, r);
  expect(c.estado).toBe('Cerrado');
  expect(c.mensajes.map((m) => m.texto)).toEqual(['No llegó el paquete', '¡Ojo! Cambió la dirección', 'Ya fue entregado']);
  expect(planet.errores).toEqual([]);
});

test('letras raras: emojis, comillas, símbolos y saltos de línea se ven tal cual', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'dani.dangelo');
  await entrar(planet, 'beto.planet');
  const r = ref('RARO');
  const referencia = `${r} · "Ñandú" & <b>O'Brien</b> \\ 📦`;
  const mensaje = 'Línea 1 😀\nLínea 2: 100% "seguro" & <script>alert(1)</script>\n\n\\n no es salto · ¿¡áéíóú!?';
  await crearConsultaCliente(cliente, referencia, mensaje);

  const [c] = await enServidor(cliente, r);
  expect(c.mensajes[0].texto).toBe(mensaje);
  const t = await abrirTarjetaCliente(cliente, r);
  await expect(t.locator('.timeline-item p').first()).toHaveText(mensaje);

  await revisar(planet);
  const tp = await abrirTarjetaPlanet(planet, r);
  await expect(tp.locator('.thread-text').first()).toHaveText(mensaje);
  // El botón copiar se lleva la referencia entera (el " · " se cambió por un guion)
  expect(await tp.locator('.copy-btn').getAttribute('data-copiar')).toBe(`${r} - "Ñandú" & <b>O'Brien</b> \\ 📦`);
  // El buscador aguanta símbolos
  for (const q of ['(', '[a-z', '\\', '*', "O'Brien", '📦', '<b>']) {
    await planet.fill('#planet-search', q);
    await planet.waitForTimeout(50);
  }
  await planet.fill('#planet-search', r + ' ñandu');
  await expect(tarjetaPlanet(planet, r)).toBeVisible();
  expect(cliente.errores).toEqual([]);
  expect(planet.errores).toEqual([]);
});

test('se corta internet al responder: no se pierde lo escrito y se puede reintentar', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('CORTE');
  await crearConsultaCliente(cliente, r);
  const t = await abrirTarjetaCliente(cliente, r);
  const campo = t.locator('input[id^="reply-"]');

  const normal = await estorbar(cliente, 'responder', 'cortar');
  await campo.fill('Mensaje importante');
  await t.locator('.reply-send').click();
  await expect(cliente.locator('.sl-host')).toContainText(/conexión/i);
  await expect(campo).toHaveValue('Mensaje importante');
  await expect(campo).toBeEnabled();
  await expect(t.locator('.reply-send')).toBeEnabled();
  await normal();

  await t.locator('.reply-send').click();
  await expect(campo).toHaveValue('');
  const [c] = await enServidor(cliente, r);
  expect(c.mensajes.map((m) => m.texto)).toEqual(['No llegó el paquete', 'Mensaje importante']);
});

test('el servidor falla al crear la consulta: el formulario queda con lo escrito', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('CAIDO');
  const normal = await estorbar(cliente, 'nueva_consulta', 'error');
  await cliente.click('#screen-client .fab');
  await cliente.fill('#nq-ref', r);
  await cliente.selectOption('#nq-tipo', 'Robo');
  await cliente.fill('#nq-mensaje', 'Se lo llevaron');
  await cliente.click('#nq-send');
  await expect(cliente.locator('.sl-host')).toContainText(/No se pudo completar/);
  await expect(cliente.locator('#modal-new-query')).toHaveClass(/active/);
  await expect(cliente.locator('#nq-ref')).toHaveValue(r);
  await expect(cliente.locator('#nq-mensaje')).toHaveValue('Se lo llevaron');
  await expect(cliente.locator('#nq-send')).toBeEnabled();
  await expect(cliente.locator('#nq-send')).toHaveText('Enviar consulta');
  await normal();
  await cliente.click('#nq-send');
  await expect(cliente.locator('#modal-new-query')).not.toHaveClass(/active/);
  expect(await enServidor(cliente, r)).toHaveLength(1);
});

test('falla la subida de una foto: no se manda el mensaje a medias y se puede reintentar', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  const r = ref('FOTOMAL');
  await crearConsultaCliente(cliente, r);
  const t = await abrirTarjetaCliente(cliente, r);
  const [selector] = await Promise.all([cliente.waitForEvent('filechooser'), t.locator('.attach-btn').click()]);
  await selector.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(t.locator('.img-prev')).toHaveCount(1);
  const campo = t.locator('input[id^="reply-"]');
  await campo.fill('Va la foto');

  const normal = await estorbar(cliente, 'subir_imagen', 'error');
  await t.locator('.reply-send').click();
  await expect(cliente.locator('.sl-host')).toContainText(/foto/i);
  await expect(campo).toHaveValue('Va la foto');
  await expect(t.locator('.img-prev')).toHaveCount(1);
  await expect(campo).toBeEnabled();
  expect((await enServidor(cliente, r))[0].mensajes).toHaveLength(1);
  await normal();

  await t.locator('.reply-send').click();
  await expect(campo).toHaveValue('');
  const [c] = await enServidor(cliente, r);
  expect(c.mensajes).toHaveLength(2);
  expect(c.mensajes[1].imagenes).toHaveLength(1);
});

test('fotos: lo que no es imagen se rechaza, más de 3 no entran, y una foto enorme sube igual', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await cliente.click('#screen-client .fab');
  const elegir = async (archivos) => {
    const [selector] = await Promise.all([cliente.waitForEvent('filechooser'), cliente.click('#modal-new-query .attach-btn')]);
    await selector.setFiles(archivos);
  };
  const foto = (name) => ({ name, mimeType: 'image/png', buffer: PNG_1PX });

  await elegir([{ name: 'remito.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }]);
  await expect(cliente.locator('.sl-host')).toContainText('Solo se pueden adjuntar imágenes');
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(0);

  // Dice ser una foto pero está rota
  await elegir([{ name: 'rota.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('esto no es una foto') }]);
  await expect(cliente.locator('.sl-host')).toContainText('No se pudo leer la imagen');
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(0);

  await elegir([foto('1.png'), foto('2.png'), foto('3.png'), foto('4.png'), foto('5.png')]);
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(3);
  await expect(cliente.locator('.sl-host')).toContainText('Máximo 3 fotos');
  // Se pueden quitar
  await cliente.locator('#prev-nq .img-prev button').first().click();
  await cliente.locator('#prev-nq .img-prev button').first().click();
  await cliente.locator('#prev-nq .img-prev button').first().click();
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(0);

  // Una foto de celular de 12 megapíxeles, bien pesada (ruido: no se comprime)
  const pesoMB = await cliente.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000; canvas.height = 3000;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(4000, 3000);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : Math.random() * 255;
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 1));
    await agregarImagenes('nq', [new File([blob], 'IMG_0001.jpg', { type: 'image/jpeg' })]);
    return blob.size / 1048576;
  });
  expect(pesoMB).toBeGreaterThan(5);
  await expect(cliente.locator('#prev-nq .img-prev')).toHaveCount(1);
  const r = ref('PESADA');
  await cliente.fill('#nq-ref', r);
  await cliente.selectOption('#nq-tipo', 'Paquete dañado');
  await cliente.fill('#nq-mensaje', 'Foto pesada');
  await cliente.click('#nq-send');
  await expect(cliente.locator('#modal-new-query')).not.toHaveClass(/active/, { timeout: 30000 });
  const [c] = await enServidor(cliente, r);
  expect(c.mensajes[0].imagenes).toHaveLength(1);
  expect(cliente.errores).toEqual([]);
});

test('dos de Planet sobre la misma consulta: no se pisan ni se pierden mensajes', async ({ browser }) => {
  const cliente = await ventana(browser);
  const ana = await ventana(browser);
  const beto = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(ana, 'ana.planet');
  await entrar(beto, 'beto.planet');
  const r = ref('DOSJUNTOS');
  await crearConsultaCliente(cliente, r);
  await revisar(ana);
  await revisar(beto);
  const ta = await abrirTarjetaPlanet(ana, r);
  const tb = await abrirTarjetaPlanet(beto, r);

  // Los dos escriben con la consulta "vieja" en pantalla; Ana la cierra y Beto responde después
  await ta.locator('.thread-reply-input').fill('Entregado, la cierro');
  await tb.locator('.thread-reply-input').fill('Estoy averiguando');
  await ta.getByRole('button', { name: 'Enviar y cerrar' }).click();
  await expect(tarjetaPlanet(ana, r).locator('.ticket-status')).toHaveText('Cerrado');
  await tb.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(tarjetaPlanet(beto, r).locator('.thread-reply-input')).toHaveValue('');

  const [c] = await enServidor(ana, r);
  expect(c.mensajes.map((m) => m.texto)).toEqual(['No llegó el paquete', 'Entregado, la cierro', 'Estoy averiguando']);
  // Las dos pantallas terminan mostrando lo mismo que el servidor
  await refrescar(ana);
  await refrescar(beto);
  const estadoPlanet = { Abierto: 'Pendiente', 'En proceso': 'En proceso', 'Esperando info': 'Esperando info', 'Respuesta cliente': 'Pendiente', Cerrado: 'Cerrado' }[c.estado];
  for (const p of [ana, beto]) {
    await expect(tarjetaPlanet(p, r).locator('.ticket-status')).toHaveText(estadoPlanet);
    await expect(tarjetaPlanet(p, r).locator('.thread-msg')).toHaveCount(3);
    expect(p.errores).toEqual([]);
  }

  // Los dos tocan "Cerrar" casi a la vez: ninguno ve un error
  if (c.estado !== 'Cerrado') {
    await Promise.all([
      tarjetaPlanet(ana, r).getByRole('button', { name: 'Cerrar', exact: true }).click(),
      tarjetaPlanet(beto, r).getByRole('button', { name: 'Cerrar', exact: true }).click(),
    ]);
    for (const p of [ana, beto]) await expect(tarjetaPlanet(p, r).locator('.ticket-status')).toHaveText('Cerrado');
  }
});

test('la sesión se vence en el medio: vuelve al login con un aviso y se puede entrar de nuevo', async ({ browser }) => {
  const admin = await ventana(browser);
  const cliente = await ventana(browser);
  await entrar(admin, 'ana.planet');
  const usuario = ref('vence').toLowerCase();
  expect((await apiDe(admin, { action: 'crear_usuario', usuario, nombre: 'Vence', password: 'clave123', team: 'cliente', cliente: 'NUME' })).ok).toBe(true);
  await entrar(cliente, usuario);
  const r = ref('VENCE');
  await crearConsultaCliente(cliente, r);
  const t = await abrirTarjetaCliente(cliente, r);

  // El admin le cambia la contraseña: sus sesiones se cierran
  await apiDe(admin, { action: 'editar_usuario', usuario, password: 'clave123' });
  await t.locator('input[id^="reply-"]').fill('Mensaje con la sesión vencida');
  await t.locator('.reply-send').click();
  await expect(cliente.locator('#screen-login')).toHaveClass(/active/);
  await expect(cliente.locator('.sl-host')).toContainText(/sesi[oó]n/i);
  // Y no quedó nada del usuario anterior a la vista
  await expect(cliente.locator('#client-list .consulta-card')).toHaveCount(0);

  await entrar(cliente, usuario);
  await cliente.fill('#client-search', r);
  await expect(tarjetaCliente(cliente, r)).toBeVisible();
  expect((await enServidor(cliente, r))[0].mensajes).toHaveLength(1);
  await apiDe(admin, { action: 'eliminar_usuario', usuario });
});

test('salir y entrar con otro usuario en la misma ventana no mezcla datos', async ({ browser }) => {
  const page = await ventana(browser);
  await entrar(page, 'nico.nume');
  const r = ref('DENUME');
  await crearConsultaCliente(page, r);
  const t = await abrirTarjetaCliente(page, r);
  await t.locator('input[id^="reply-"]').fill('borrador de Nico');
  await page.locator('#screen-client .topbar-actions button[title="Salir"]').click();
  await expect(page.locator('#screen-login')).toHaveClass(/active/);
  await expect(page.locator('#login-user')).toHaveValue('');
  await expect(page.locator('#login-pass')).toHaveValue('');

  // Entra otro cliente: no ve nada de NUME
  await entrar(page, 'gabi.getbox');
  await expect(page.locator('#client-org')).toHaveText('GETBOX');
  await page.fill('#client-search', r);
  await expect(tarjetaCliente(page, r)).toHaveCount(0);
  expect(await page.evaluate((r) => consultas.some((c) => c.asunto.includes(r) || c.cliente === 'NUME'), r)).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('nico.nume') && k.startsWith('planet_cache'))) ).toEqual([]);
  await page.fill('#client-search', '');
  await page.locator('#screen-client .topbar-actions button[title="Salir"]').click();

  // Y después alguien de Planet, y de vuelta un cliente: cada uno su pantalla
  await entrar(page, 'beto.planet');
  await expect(page.locator('#planet-name')).toHaveText('Beto');
  await page.locator('#screen-planet .topbar-actions button[title="Salir"]').click();
  await entrar(page, 'nico.nume');
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await expect(page.locator('#screen-planet')).not.toHaveClass(/active/);
  const t2 = await abrirTarjetaCliente(page, r);
  await expect(t2.locator('input[id^="reply-"]')).toHaveValue('');
  expect(page.errores).toEqual([]);
});

test('dos pestañas del mismo usuario: salir en una saca a la otra sin errores', async ({ browser }) => {
  const a = await ventana(browser);
  await entrar(a, 'gabi.getbox');
  const b = await a.context().newPage();
  b.errores = [];
  b.on('pageerror', (e) => b.errores.push(e.message));
  await b.goto('/');
  await expect(b.locator('#screen-client')).toHaveClass(/active/);   // entra sola con la sesión guardada
  await b.evaluate(() => { local.guardar(claveGuia(), 1); if (_guia) cerrarGuia(); });

  await a.locator('#screen-client .topbar-actions button[title="Salir"]').click();
  await expect(a.locator('#screen-login')).toHaveClass(/active/);
  await b.evaluate(() => refrescar());
  await expect(b.locator('#screen-login')).toHaveClass(/active/);
  expect(b.errores).toEqual([]);
});

test('con muchas consultas se muestran de a 20 y "Ver más" trae el resto', async ({ browser }) => {
  const cliente = await ventana(browser);
  await entrar(cliente, 'gabi.getbox');
  const r = ref('MUCHAS');
  for (let i = 1; i <= 23; i++) {
    const res = await apiDe(cliente, { action: 'nueva_consulta', asunto: `${r} nro ${i} · GETBOX · Otro`, tipo: 'Otro', mensaje: 'Consulta ' + i });
    expect(res.ok).toBe(true);
  }
  await refrescar(cliente);
  await cliente.fill('#client-search', r);
  await expect(cliente.locator('#client-list .search-info')).toHaveText('23 resultados');
  await expect(cliente.locator('#client-list .consulta-card')).toHaveCount(20);
  await cliente.locator('#client-list .ver-mas').first().click();
  await expect(cliente.locator('#client-list .consulta-card')).toHaveCount(23);
  await expect(cliente.locator('#client-list .ver-mas:not(.ver-historial)')).toHaveCount(0);
  expect(cliente.errores).toEqual([]);
});

test('sin almacenamiento local (modo privado estricto) el portal igual funciona', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const bloquear = () => { throw new DOMException('bloqueado', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: bloquear });
  });
  const { API_PRODUCCION, API_LOCAL } = await import('./ayuda.js');
  await context.route(API_PRODUCCION + '/**', async (route) => {
    route.fulfill({ response: await route.fetch({ url: route.request().url().replace(API_PRODUCCION, API_LOCAL) }) });
  });
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto('/');
  await page.fill('#login-user', 'nico.nume');
  await page.fill('#login-pass', 'clave123');
  await page.click('#login-btn');
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await expect(page.locator('#client-stats .stat-card')).toHaveCount(4);
  expect(errores).toEqual([]);
});

test('login: mayúsculas y espacios de más en el usuario no molestan', async ({ browser }) => {
  const page = await ventana(browser);
  await page.fill('#login-user', '  Nico.NUME ');
  await page.fill('#login-pass', 'clave123');
  await page.press('#login-pass', 'Enter');
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await expect(page.locator('#client-org')).toHaveText('NUME');
});

test('lo que se está escribiendo no se pierde al tocar ↻, cambiar de solapa o actualizarse la lista', async ({ browser }) => {
  const cliente = await ventana(browser);
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const base = ref('BORRADOR'), r = base + '-A', r2 = base + '-B';
  await crearConsultaCliente(cliente, r);
  await crearConsultaCliente(cliente, r2);

  // Cliente: escribe, toca ↻, cambia de solapa y vuelve, busca
  const t = await abrirTarjetaCliente(cliente, r);
  await t.locator('input[id^="reply-"]').fill('Borrador del cliente');
  await cliente.fill('#client-search', base);   // quedan a la vista las dos consultas
  await cliente.click('#client-reload');
  await expect(cliente.locator('#client-reload')).not.toHaveClass(/spinning/);
  await expect(tarjetaCliente(cliente, r).locator('input[id^="reply-"]')).toHaveValue('Borrador del cliente');
  await cliente.locator('#client-list .client-chip[data-v="cerrado"]').click();
  await cliente.locator('#client-list .client-chip[data-v="Todos"]').click();
  await expect(tarjetaCliente(cliente, r).locator('input[id^="reply-"]')).toHaveValue('Borrador del cliente');
  // Responder en otra consulta no lo borra
  const otra = tarjetaCliente(cliente, r2);
  await otra.locator('.card-summary').click();
  await otra.locator('input[id^="reply-"]').fill('Otro mensaje');
  await otra.locator('.reply-send').click();
  await expect(tarjetaCliente(cliente, r2).locator('input[id^="reply-"]')).toHaveValue('');
  await expect(tarjetaCliente(cliente, r).locator('input[id^="reply-"]')).toHaveValue('Borrador del cliente');

  // Planet: un borrador olvidado en una tarjeta cerrada ya no frena la actualización automática
  await revisar(planet);
  const tp = await abrirTarjetaPlanet(planet, r);
  await tp.locator('.thread-reply-input').fill('Borrador de Planet');
  await planet.fill('#planet-search', base);
  await tp.locator('.card-summary').click();          // cierra la tarjeta sin enviar
  await planet.click('#planet-stats');
  await planet.evaluate(() => { _ultimaTecla = 0; }); // como si hubiera pasado un rato
  const r3 = base + '-C';
  await crearConsultaCliente(cliente, r3);
  await revisar(planet);
  await expect(tarjetaPlanet(planet, r3)).toBeVisible();
  await expect(tarjetaPlanet(planet, r).locator('.thread-reply-input')).toHaveValue('Borrador de Planet');
  // Mientras está tecleando, en cambio, no se le redibuja la pantalla
  await tarjetaPlanet(planet, r).locator('.card-summary').click();
  await tarjetaPlanet(planet, r).locator('.thread-reply-input').press('End');
  await tarjetaPlanet(planet, r).locator('.thread-reply-input').pressSequentially(' y sigo');
  expect(await planet.evaluate(() => estaOcupado())).toBe(true);
  // Al enviarlo, el borrador se olvida
  await tarjetaPlanet(planet, r).getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(tarjetaPlanet(planet, r).locator('.thread-reply-input')).toHaveValue('');
  expect(await planet.evaluate(() => Object.keys(borradores))).toEqual([]);
  expect((await enServidor(planet, r))[0].mensajes.at(-1).texto).toBe('Borrador de Planet y sigo');
});

test('en una conversación larga, después de responder se ve el mensaje recién enviado', async ({ browser }) => {
  const cliente = await ventana(browser, { viewport: { width: 390, height: 700 } });
  const planet = await ventana(browser);
  await entrar(cliente, 'nico.nume');
  await entrar(planet, 'beto.planet');
  const r = ref('CHARLA');
  await crearConsultaCliente(cliente, r);
  const [{ id }] = await enServidor(cliente, r);
  for (let i = 1; i <= 24; i++) await apiDe(i % 2 ? planet : cliente, { action: 'responder', id, texto: 'Mensaje número ' + i + ' de una charla larga' });
  await refrescar(cliente);
  await revisar(planet);

  const alFinal = (page, sel) => page.locator(sel).evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  const t = await abrirTarjetaCliente(cliente, r);
  await cliente.waitForTimeout(500);
  expect(await alFinal(cliente, '#msgs-c' + id)).toBeLessThan(5);
  await t.locator('input[id^="reply-"]').fill('Último del cliente');
  await t.locator('.reply-send').click();
  await expect(tarjetaCliente(cliente, r).locator('.timeline-item').last()).toContainText('Último del cliente');
  await cliente.waitForTimeout(600);
  expect(await alFinal(cliente, '#msgs-c' + id)).toBeLessThan(5);
  await expect(tarjetaCliente(cliente, r).locator('.timeline-item').last()).toBeInViewport();

  const tp = await abrirTarjetaPlanet(planet, r);
  await tp.locator('.thread-reply-input').fill('Último de Planet');
  await tp.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(tarjetaPlanet(planet, r).locator('.thread-text').last()).toHaveText('Último de Planet');
  await planet.waitForTimeout(600);
  expect(await alFinal(planet, '#msgs-p' + id)).toBeLessThan(5);
  // Y si llega uno del otro lado mientras la tiene abierta al final, también lo ve
  await refrescar(cliente);
  await cliente.waitForTimeout(600);
  expect(await alFinal(cliente, '#msgs-c' + id)).toBeLessThan(5);
  // Pero si subió a leer algo viejo, una actualización no lo mueve de ahí
  await cliente.locator('#msgs-c' + id).evaluate((el) => { el.scrollTop = 0; });
  await apiDe(planet, { action: 'responder', id, texto: 'Otro más' });
  await refrescar(cliente);
  await expect(tarjetaCliente(cliente, r).locator('.timeline-item')).toHaveCount(28);
  expect(await cliente.locator('#msgs-c' + id).evaluate((el) => el.scrollTop)).toBe(0);
});

test('si antes entró un admin, el siguiente usuario no queda parado en su pantalla de Usuarios', async ({ browser }) => {
  const page = await ventana(browser);
  await entrar(page, 'ana.planet');
  await page.click('.sidebar-item[data-seccion="planet-usuarios"]');
  await expect(page.locator('.tabla-admin')).toContainText('nico.nume');
  await page.click('.sidebar-item[data-seccion="planet-metricas"]');
  await expect(page.locator('#met-contenido .met-tile').first()).toBeVisible();
  await page.locator('#screen-planet .topbar-actions button[title="Salir"]').click();

  await entrar(page, 'beto.planet');
  await expect(page.locator('#planet-consultas')).toHaveClass(/active/);
  await expect(page.locator('#planet-usuarios')).not.toHaveClass(/active/);
  await expect(page.locator('#planet-metricas')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => $('users-list').textContent + $('met-contenido').textContent + $('clients-list').textContent)).toBe('');
  expect(page.errores).toEqual([]);
});

test('el botón copiar no recorta direcciones que empiezan parecido a "Venta" o "Nro"', async ({ browser }) => {
  const page = await ventana(browser);
  const casos = {
    'Numancia 450 · NUME · Otro': 'Numancia 450',
    'Ventana 3 rota · NUME · Otro': 'Ventana 3 rota',
    'Orden de compra 1234 · NUME · Otro': 'Orden de compra 1234',
    'Envíos Juan · NUME · Otro': 'Envíos Juan',
    'Tracking 152089 · NUME · Otro': '152089',
    'Venta N° 4521 · NUME · Otro': '4521',
    'pedido: ABC-123 · NUME · Otro': 'ABC-123',
    '#99812 · NUME · Otro': '99812',
    'Guía · NUME · Otro': 'Guía',
  };
  expect(await page.evaluate((asuntos) => asuntos.map(refDeAsunto), Object.keys(casos))).toEqual(Object.values(casos));
});

test('Enter repetido en la contraseña manda un solo pedido de ingreso', async ({ browser }) => {
  const page = await ventana(browser);
  let logins = 0;
  page.on('request', (q) => { if ((q.postData() || '').includes('"action":"login"')) logins++; });
  const normal = await estorbar(page, 'login', 600);
  await page.fill('#login-user', 'nico.nume');
  await page.fill('#login-pass', 'clave123');
  for (let i = 0; i < 4; i++) await page.press('#login-pass', 'Enter');
  await expect(page.locator('#screen-client')).toHaveClass(/active/);
  await normal();
  expect(logins).toBe(1);
});

test('la sesión se vence con la ventana de "Nueva consulta" abierta: no queda encima del login', async ({ browser }) => {
  const admin = await ventana(browser);
  const cliente = await ventana(browser);
  await entrar(admin, 'ana.planet');
  const usuario = ref('vence2').toLowerCase();
  expect((await apiDe(admin, { action: 'crear_usuario', usuario, nombre: 'Vence', password: 'clave123', team: 'cliente', cliente: 'NUME' })).ok).toBe(true);
  await entrar(cliente, usuario);
  await cliente.click('#screen-client .fab');
  await cliente.fill('#nq-ref', 'algo');
  await cliente.selectOption('#nq-tipo', 'Otro');
  await cliente.fill('#nq-mensaje', 'algo');
  await apiDe(admin, { action: 'eliminar_usuario', usuario });
  await cliente.click('#nq-send');
  await expect(cliente.locator('#screen-login')).toHaveClass(/active/);
  await expect(cliente.locator('#modal-new-query')).not.toHaveClass(/active/);
  await cliente.fill('#login-user', 'nico.nume');   // el login se puede usar
  expect(cliente.errores).toEqual([]);
});

test('con el reloj del dispositivo en otro país, las antigüedades y las horas siguen bien', async ({ browser }) => {
  const mexico = await ventana(browser, { timezoneId: 'America/Mexico_City' });
  await entrar(mexico, 'nico.nume');
  const r = ref('HUSO');
  await crearConsultaCliente(mexico, r);
  const t = await abrirTarjetaCliente(mexico, r);
  const [c] = await enServidor(mexico, r);
  // La hora que se muestra es la de Argentina, la misma que guardó el servidor
  await expect(t.locator('.card-date')).toHaveText(c.fecha);
  // Y el portal la entiende como "recién", no como hace 3 horas ni en el futuro
  const edad = await mexico.evaluate((f) => Date.now() - fechaMs(f), c.fecha);
  expect(edad).toBeGreaterThanOrEqual(0);
  expect(edad).toBeLessThan(120000);
  // El mensaje que se agrega en pantalla al responder lleva la misma hora que guarda el servidor
  await t.locator('input[id^="reply-"]').fill('hola');
  await t.locator('.reply-send').click();
  await expect(tarjetaCliente(mexico, r).locator('.timeline-item')).toHaveCount(2);
  const enPantalla = await tarjetaCliente(mexico, r).locator('.timeline-time').last().textContent();
  const guardada = (await enServidor(mexico, r))[0].mensajes[1].fecha;
  const minutos = (f) => { const m = f.match(/(\d+):(\d+)$/); return +m[1] * 60 + +m[2]; };
  expect(Math.abs(minutos(enPantalla) - minutos(guardada)) % 1439).toBeLessThanOrEqual(1);
});

test('un cliente eliminado deja de aparecer en los botones del inicio (salvo que tenga algo abierto)', async ({ browser }) => {
  const planet = await ventana(browser);
  await entrar(planet, 'ana.planet');
  const empresa = ref('Borrable');
  const usuario = ref('borrable').toLowerCase();
  const { id: idCliente } = await apiDe(planet, { action: 'crear_cliente', nombre: empresa });
  expect((await apiDe(planet, { action: 'crear_usuario', usuario, nombre: 'Borra', password: 'clave123', team: 'cliente', cliente: empresa })).ok).toBe(true);
  const cliente = await ventana(browser);
  await entrar(cliente, usuario);
  const r = ref('DEBORRADO');
  await crearConsultaCliente(cliente, r);

  await planet.reload();
  await expect(planet.locator('#screen-planet')).toHaveClass(/active/);
  const boton = planet.locator('#planet-filter').getByText(empresa, { exact: false });
  await expect(boton).toHaveCount(1);
  // Planet está mirando ese cliente y lo elimina desde Clientes
  await planet.evaluate((n) => elegirCliente(n), empresa);
  await planet.click('.sidebar-item[data-seccion="planet-clientes"]');
  await planet.locator('.cliente-ficha', { hasText: empresa }).getByRole('button', { name: 'Eliminar' }).click();
  await expect(planet.locator('.cliente-ficha', { hasText: empresa })).toHaveCount(0);
  await planet.click('.sidebar-item[data-seccion="planet-consultas"]');
  // Tiene una consulta abierta: el botón sigue, para no perderla de vista
  await expect(boton).toHaveCount(1);

  // Al cerrarla, el botón se va; la consulta sigue estando en "Todos" y en el buscador
  const [{ id }] = await enServidor(planet, r);
  expect(idCliente).toBeGreaterThan(0);
  await apiDe(planet, { action: 'cambiar_estado', id, estado: 'Cerrado' });
  await refrescar(planet);
  await expect(boton).toHaveCount(0);
  expect(await planet.evaluate(() => filtroCliente)).toBe('Todos');
  await planet.click('#planet-estado-filter >> text=Todos');
  await planet.fill('#planet-search', r);
  await expect(tarjetaPlanet(planet, r)).toBeVisible();
  // Tampoco se le puede mandar una consulta nueva
  expect(await planet.evaluate(() => [...$('pnq-cliente').options].map((o) => o.value))).not.toContain(empresa);
  expect(planet.errores).toEqual([]);
  await apiDe(planet, { action: 'eliminar_usuario', usuario });
});
