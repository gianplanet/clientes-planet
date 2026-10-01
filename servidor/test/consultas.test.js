import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { escenario, consulta, fila, db } from './ayuda.js';

describe('crear y listar', () => {
  it('el cliente crea una consulta y Planet la ve con su primer mensaje', async () => {
    const { nume, planet } = await escenario();
    const r = await consulta(nume, { mensaje: 'No llegó el paquete', imagenes: JSON.stringify(['https://portal.test/img/00000000-0000-4000-8000-000000000000.jpg']) });
    expect(r).toEqual({ ok: true, id: expect.any(Number) });

    const { consultas } = await planet({ action: 'consultas' });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toMatchObject({
      id: r.id, cliente: 'NUME', direccion: 'cliente_a_planet', estado: 'Abierto',
      creado_por: 'nico.nume', nombre_creador: 'Nico', tipo: 'No entregado',
      mensajes: [{ autor: 'nico.nume', nombre: 'Nico', texto: 'No llegó el paquete', imagenes: ['https://portal.test/img/00000000-0000-4000-8000-000000000000.jpg'] }],
    });
    expect(consultas[0].creado_en).toBeGreaterThan(Date.now() - 60000);
    expect(consultas[0].fecha).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  it('un cliente no puede crear una consulta a nombre de otra empresa ni "desde Planet"', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume, { cliente: 'GETBOX', direccion: 'planet_a_cliente' });
    expect(await fila(id)).toMatchObject({ cliente: 'NUME', direccion: 'cliente_a_planet', estado: 'Abierto' });

    const enviada = await consulta(planet, { cliente: 'GETBOX', direccion: 'planet_a_cliente' });
    expect(await fila(enviada.id)).toMatchObject({ cliente: 'GETBOX', direccion: 'planet_a_cliente', estado: 'Esperando info' });
  });

  it('faltan campos', async () => {
    const { nume } = await escenario();
    expect((await consulta(nume, { mensaje: '   ' })).error).toBe('Faltan campos obligatorios');
  });

  it('cada cliente ve solo lo de su empresa, y no puede responder lo ajeno', async () => {
    const { nume, getbox, planet } = await escenario();
    const deNume = await consulta(nume);
    await consulta(planet, { cliente: 'GETBOX', direccion: 'planet_a_cliente' });

    const vistas = (await getbox({ action: 'consultas', cliente: 'NUME' })).consultas;   // pedir otra empresa no sirve
    expect(vistas.map((c) => c.cliente)).toEqual(['GETBOX']);

    expect(await getbox({ action: 'responder', id: deNume.id, texto: 'hola' })).toEqual({ ok: false, error: 'Consulta no encontrada' });
    const { n } = await db.prepare('SELECT COUNT(*) n FROM mensajes WHERE consulta_id = ?').bind(deNume.id).first();
    expect(n).toBe(1);
  });

  it('Planet puede filtrar por cliente', async () => {
    const { nume, planet } = await escenario();
    await consulta(nume);
    await consulta(planet, { cliente: 'GETBOX', direccion: 'planet_a_cliente' });
    const r = await planet({ action: 'consultas', cliente: 'GETBOX' });
    expect(r.consultas.map((c) => c.cliente)).toEqual(['GETBOX']);
  });

  it('funciona con más de 100 consultas (antes fallaba: "too many SQL variables")', async () => {
    const { nume, planet } = await escenario();
    const ahora = Date.now();
    const altas = [];
    for (let i = 0; i < 130; i++) {
      altas.push(db.prepare(
        `INSERT INTO consultas (fecha, asunto, cliente, creado_por, actualizado, creado_en) VALUES ('01/01/2026 10:00', ?, 'NUME', 'nico.nume', ?, ?)`
      ).bind('T' + i + ' · NUME · Otro', ahora, ahora));
    }
    await db.batch(altas);
    await db.prepare(`INSERT INTO mensajes (consulta_id, autor, fecha, texto) SELECT id, 'nico.nume', fecha, 'msg' FROM consultas`).run();

    for (const api of [planet, nume]) {
      const r = await api({ action: 'consultas' });
      expect(r.ok).toBe(true);
      expect(r.consultas).toHaveLength(130);
      expect(r.consultas.every((c) => c.mensajes.length === 1)).toBe(true);
    }
  });
});

describe('carga parcial y actualización', () => {
  it('de entrada no manda las cerradas viejas, pero avisa que hay historial', async () => {
    const { nume, planet } = await escenario();
    const vieja = await consulta(nume);
    const nueva = await consulta(nume);
    await planet({ action: 'cambiar_estado', id: vieja.id, estado: 'Cerrado' });
    await db.prepare('UPDATE consultas SET actualizado = ? WHERE id = ?').bind(Date.now() - 90 * 86400000, vieja.id).run();

    const r = await nume({ action: 'consultas' });
    expect(r.consultas.map((c) => c.id)).toEqual([nueva.id]);
    expect(r.historialCompleto).toBe(false);

    const todo = await nume({ action: 'consultas', historial: 1 });
    expect(todo.consultas.map((c) => c.id).sort()).toEqual([vieja.id, nueva.id].sort());
    expect(todo.historialCompleto).toBe(true);
  });

  it('con "desde" manda solo lo que cambió, y "ultimo" marca el último cambio', async () => {
    const { nume, planet } = await escenario();
    const a = await consulta(nume);
    const b = await consulta(nume);
    await db.batch([
      db.prepare('UPDATE consultas SET actualizado = ? WHERE id = ?').bind(Date.now() - 600000, a.id),
      db.prepare('UPDATE consultas SET actualizado = ? WHERE id = ?').bind(Date.now() - 300000, b.id),
    ]);
    const { ultimo } = await planet({ action: 'consultas' });

    // Lo del último minuto antes de la marca se repite a propósito (cambios lentos);
    // el portal ve que no cambió nada y no vuelve a dibujar
    const sinCambios = await planet({ action: 'consultas', desde: ultimo });
    expect(sinCambios.consultas.map((c) => c.id)).toEqual([b.id]);
    expect(sinCambios.ultimo).toBe(ultimo);

    await planet({ action: 'responder', id: b.id, texto: 'Lo vemos' });
    const cambios = await planet({ action: 'consultas', desde: ultimo });
    expect(cambios.consultas.map((c) => c.id)).toEqual([b.id]);
    expect(cambios.consultas[0].mensajes).toHaveLength(2);
    expect(cambios.ultimo).toBeGreaterThan(ultimo);
    expect(cambios.notas).toEqual([]);   // los post-its viajan también, para sincronizarlos
    expect(a.id).not.toBe(b.id);
  });

  it('"novedades" sigue respondiendo (portal anterior) y un cliente solo ve sus cambios', async () => {
    const { nume, getbox } = await escenario();
    await consulta(nume);
    expect((await nume({ action: 'novedades' })).ultimo).toBeGreaterThan(0);
    expect((await getbox({ action: 'novedades' })).ultimo).toBe(0);
  });
});

describe('flujo de estados', () => {
  it('recorre el circuito completo', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);

    // El cliente agrega algo antes de que la tomen: sigue pendiente
    await nume({ action: 'responder', id, texto: 'Un dato más' });
    expect((await fila(id)).estado).toBe('Abierto');

    // Planet contesta: pasa a En proceso y queda como quien la atiende
    expect(await planet({ action: 'responder', id, texto: 'Lo vemos' })).toMatchObject({ ok: true, estado: 'En proceso' });
    expect(await fila(id)).toMatchObject({ estado: 'En proceso', atendido_por: 'Beto' });

    // Planet pide info
    await planet({ action: 'responder', id, texto: '¿Qué dirección?', esperar_info: '1' });
    expect((await fila(id)).estado).toBe('Esperando info');

    // El cliente contesta
    await nume({ action: 'responder', id, texto: 'Calle 123' });
    expect((await fila(id)).estado).toBe('Respuesta cliente');

    // Planet cierra: queda la hora exacta
    await planet({ action: 'cambiar_estado', id, estado: 'Cerrado' });
    const cerrada = await fila(id);
    expect(cerrada.estado).toBe('Cerrado');
    expect(cerrada.cerrado_en).toBeGreaterThan(Date.now() - 60000);
    expect(cerrada.cierre_aprox).toBe(0);

    // Volver a "cerrarla" no pisa la hora de cierre
    await db.prepare('UPDATE consultas SET cerrado_en = 123456789000 WHERE id = ?').bind(id).run();
    await planet({ action: 'cambiar_estado', id, estado: 'Cerrado' });
    expect((await fila(id)).cerrado_en).toBe(123456789000);

    // El cliente escribe en la cerrada: se reabre y vuelve a Planet como pendiente
    expect(await nume({ action: 'responder', id, texto: 'Sigue sin llegar' })).toMatchObject({ ok: true, reabierta: true, estado: 'Abierto' });
    expect(await fila(id)).toMatchObject({ estado: 'Abierto', cerrado_en: null, reaberturas: 1 });

    const eventos = (await db.prepare('SELECT evento, de_estado, a_estado FROM eventos WHERE consulta_id = ? ORDER BY id').bind(id).all()).results;
    expect(eventos.filter((e) => e.evento !== 'mensaje')).toEqual([
      { evento: 'creada', de_estado: '', a_estado: 'Abierto' },
      { evento: 'estado', de_estado: 'Abierto', a_estado: 'En proceso' },
      { evento: 'estado', de_estado: 'En proceso', a_estado: 'Esperando info' },
      { evento: 'estado', de_estado: 'Esperando info', a_estado: 'Respuesta cliente' },
      { evento: 'estado', de_estado: 'Respuesta cliente', a_estado: 'Cerrado' },
      { evento: 'reabierta', de_estado: 'Cerrado', a_estado: 'Abierto' },
    ]);
  });

  it('Planet puede cerrar en el mismo mensaje, y el cliente no', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);

    // El cliente no puede cerrarla ni pidiéndolo
    await nume({ action: 'responder', id, texto: 'Un dato más', cerrar: '1' });
    expect((await fila(id)).estado).toBe('Abierto');

    // Planet manda el mensaje y la cierra de una
    expect(await planet({ action: 'responder', id, texto: 'Ya se entregó', cerrar: '1' }))
      .toMatchObject({ ok: true, estado: 'Cerrado' });
    const cerrada = await fila(id);
    expect(cerrada).toMatchObject({ estado: 'Cerrado', atendido_por: 'Beto' });
    expect(cerrada.cerrado_en).toBeGreaterThan(Date.now() - 60000);
    // Queda el mensaje y el cambio de estado anotado
    expect((await db.prepare('SELECT COUNT(*) AS n FROM mensajes WHERE consulta_id = ?').bind(id).first()).n).toBe(3);
    const eventos = (await db.prepare('SELECT evento, a_estado FROM eventos WHERE consulta_id = ? ORDER BY id').bind(id).all()).results;
    expect(eventos.at(-1)).toMatchObject({ evento: 'estado', a_estado: 'Cerrado' });

    // Y si escribe en la cerrada sin pedir cerrarla, la reabre igual que antes
    expect(await planet({ action: 'responder', id, texto: 'Perdón, seguimos' }))
      .toMatchObject({ ok: true, reabierta: true, estado: 'En proceso' });
  });

  it('Planet reabre desde el botón: queda En proceso y cuenta la reapertura', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);
    await planet({ action: 'cambiar_estado', id, estado: 'Cerrado' });
    await planet({ action: 'cambiar_estado', id, estado: 'En proceso' });
    const f = await fila(id);
    expect(f).toMatchObject({ estado: 'En proceso', cerrado_en: null, reaberturas: 1 });
    expect(f.reabierta_en).toBeGreaterThan(0);
  });

  it('quien atiende no se pisa cuando otro cambia el estado', async () => {
    const { admin, nume, planet } = await escenario();
    const { id } = await consulta(nume);
    await planet({ action: 'cambiar_estado', id, estado: 'En proceso' });
    await admin({ action: 'cambiar_estado', id, estado: 'Cerrado' });
    expect((await fila(id)).atendido_por).toBe('Beto');
  });

  it('rechaza estados inventados e ids inválidos', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);
    expect((await planet({ action: 'cambiar_estado', id, estado: 'Borrada' })).error).toBe('Estado inválido');
    expect((await planet({ action: 'cambiar_estado', id: 'abc', estado: 'Cerrado' })).error).toBe('Faltan campos');
    expect((await planet({ action: 'cambiar_estado', id: 99999, estado: 'Cerrado' })).error).toBe('Consulta no encontrada');
    expect((await planet({ action: 'responder', id, texto: '' })).error).toBe('Faltan campos');
  });

  it('se puede responder solo con fotos, y solo valen las subidas a este servidor', async () => {
    const { nume } = await escenario();
    const { id } = await consulta(nume);
    const imagenes = JSON.stringify([
      'https://portal.test/img/00000000-0000-4000-8000-000000000000.jpg', 'javascript:alert(1)', 'https://portal.test/img/" onerror="alert(1)',
      'https://otro-sitio.example/espia.png',                      // de afuera: el navegador de Planet la cargaría
      'https://portal.test/img/../?action=logout',
      'https://portal.test.otro.example/img/00000000-0000-4000-8000-000000000000.jpg',
      '1AbCdEfGhIjKlMnOpQrStUv',                                    // id de Google Drive (fotos viejas)
    ]);
    expect((await nume({ action: 'responder', id, imagenes })).ok).toBe(true);
    const { imagenes: guardadas } = await db.prepare('SELECT imagenes FROM mensajes WHERE consulta_id = ? ORDER BY id DESC').bind(id).first();
    expect(JSON.parse(guardadas)).toEqual(['https://portal.test/img/00000000-0000-4000-8000-000000000000.jpg', '1AbCdEfGhIjKlMnOpQrStUv']);
    // Solo con direcciones de afuera no hay nada que mandar
    expect((await nume({ action: 'responder', id, imagenes: ['https://otro-sitio.example/espia.png'] })).error).toBe('Faltan campos');
  });

  it('las fotos guardadas antes (con otra dirección) se siguen mostrando', async () => {
    const { nume } = await escenario();
    const { id } = await consulta(nume);
    await db.prepare(`UPDATE mensajes SET imagenes = '["https://portal-viejo.workers.dev/img/x.jpg","javascript:alert(1)"]' WHERE consulta_id = ?`).bind(id).run();
    const { consultas } = await nume({ action: 'consultas' });
    expect(consultas[0].mensajes[0].imagenes).toEqual(['https://portal-viejo.workers.dev/img/x.jpg']);
  });
});

describe('cerrar sin tapar mensajes del cliente', () => {
  const version = async (api, id) => (await api({ action: 'consultas' })).consultas.find((c) => c.id === id).actualizado;

  it('no deja cerrar si el cliente escribió después de lo que Planet tiene en pantalla', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);
    const visto = await version(planet, id);
    await new Promise((r) => setTimeout(r, 5));
    await nume({ action: 'responder', id, texto: 'Ojo, cambió la dirección' });

    const aviso = { ok: false, novedad: true, error: expect.stringMatching(/mensaje nuevo/) };
    expect(await planet({ action: 'responder', id, texto: 'Entregado', cerrar: '1', visto })).toEqual(aviso);
    expect(await planet({ action: 'cambiar_estado', id, estado: 'Cerrado', visto })).toEqual(aviso);
    // No se guardó nada a medias
    expect((await fila(id)).estado).toBe('Abierto');
    const { n } = await db.prepare('SELECT COUNT(*) n FROM mensajes WHERE consulta_id = ?').bind(id).first();
    expect(n).toBe(2);

    // Responder sin cerrar, o pasarla a En proceso, no se frena
    expect((await planet({ action: 'cambiar_estado', id, estado: 'En proceso', visto })).ok).toBe(true);
    // Con la versión nueva en pantalla (ya leyó el mensaje) sí cierra
    const ahora = await version(planet, id);
    expect((await planet({ action: 'responder', id, texto: 'Entregado', cerrar: '1', visto: ahora })).estado).toBe('Cerrado');
  });

  it('un cambio de un compañero no frena el cierre, y sin "visto" funciona como antes', async () => {
    const { nume, planet, admin } = await escenario();
    const a = await consulta(nume);
    const visto = await version(planet, a.id);
    await new Promise((r) => setTimeout(r, 5));
    await admin({ action: 'responder', id: a.id, texto: 'La estoy viendo' });
    expect((await planet({ action: 'cambiar_estado', id: a.id, estado: 'Cerrado', visto })).ok).toBe(true);

    const b = await consulta(nume);
    await nume({ action: 'responder', id: b.id, texto: 'otro mensaje' });
    expect((await planet({ action: 'cambiar_estado', id: b.id, estado: 'Cerrado' })).ok).toBe(true);   // portal anterior
  });

  it('"Enviar y cerrar" sobre una que ya cerró un compañero la deja cerrada', async () => {
    const { nume, planet, admin } = await escenario();
    const { id } = await consulta(nume);
    await admin({ action: 'cambiar_estado', id, estado: 'Cerrado' });
    const cierre = (await fila(id)).cerrado_en;
    const r = await planet({ action: 'responder', id, texto: 'Ya está entregado', cerrar: '1' });
    expect(r).toMatchObject({ ok: true, reabierta: false, estado: 'Cerrado' });
    expect(await fila(id)).toMatchObject({ estado: 'Cerrado', cerrado_en: cierre, reaberturas: 0, reabierta_en: null });
    // Sin la orden de cerrar, un mensaje en una cerrada la sigue reabriendo
    expect(await planet({ action: 'responder', id, texto: 'Perdón, falta algo' })).toMatchObject({ reabierta: true, estado: 'En proceso' });
    expect(await fila(id)).toMatchObject({ estado: 'En proceso', cerrado_en: null, reaberturas: 1 });
  });

  it('si el cliente y Planet actúan a la vez, no queda "abierta con hora de cierre"', async () => {
    const { nume, planet } = await escenario();
    for (let i = 0; i < 6; i++) {
      const { id } = await consulta(nume);
      await Promise.all([
        nume({ action: 'responder', id, texto: 'Sigo esperando' }),
        i % 2 ? planet({ action: 'cambiar_estado', id, estado: 'Cerrado' }) : planet({ action: 'responder', id, texto: 'Listo', cerrar: '1' }),
      ]);
      const c = await fila(id);
      expect(c.estado === 'Cerrado', `${c.estado} / ${c.cerrado_en}`).toBe(c.cerrado_en !== null);
    }
  });
});

describe('lecturas a la base (Cloudflare cuenta cada fila leída)', () => {
  // Una base que cuenta lo que se lee, para medir lo que gasta cada revisión
  const contando = () => {
    const cuenta = { filas: 0 };
    cuenta.db = {
      prepare: (sql) => db.prepare(sql),
      batch: async (ops) => {
        const r = await db.batch(ops);
        r.forEach((x) => { cuenta.filas += x.meta.rows_read; });
        return r;
      },
    };
    return cuenta;
  };

  it('una revisión sin cambios casi no lee, por más consultas que haya', async () => {
    const { listarConsultas } = await import('../src/consultas.js');
    await escenario();
    const hace = Date.now() - 3600000;
    const altas = [];
    for (let i = 1; i <= 300; i++) {
      const cliente = i % 4 ? 'GETBOX' : 'NUME';
      altas.push(db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, estado, actualizado, creado_en) VALUES (?, '', 'a', ?, 'x', ?, ?, ?)`)
        .bind(i, cliente, i % 3 ? 'Cerrado' : 'Abierto', hace, hace));
      for (let j = 0; j < 3; j++) altas.push(db.prepare(`INSERT INTO mensajes (consulta_id, autor, fecha, creado_en) VALUES (?, 'x', '', ?)`).bind(i, hace));
    }
    for (let i = 0; i < altas.length; i += 50) await db.batch(altas.slice(i, i + 50));

    const dePlanet = { usuario: 'beto.planet', team: 'planet' }, deNume = { usuario: 'nico.nume', team: 'cliente', cliente: 'NUME' };
    for (const me of [dePlanet, deNume]) {
      const c = contando();
      const r = await listarConsultas(c.db, me, { desde: Date.now() });
      expect(r.consultas).toEqual([]);
      expect(r.ultimo).toBe(hace);
      expect(c.filas, 'filas leídas por ' + me.usuario).toBeLessThan(10);
    }

    // Cambia una sola: se lee esa y sus mensajes, no todo
    await db.prepare('UPDATE consultas SET actualizado = ? WHERE id = 8').bind(Date.now()).run();
    for (const me of [dePlanet, deNume]) {
      const c = contando();
      const r = await listarConsultas(c.db, me, { desde: Date.now() - 1000 });
      expect(r.consultas.map((x) => x.id)).toEqual([8]);
      expect(r.consultas[0].mensajes).toHaveLength(3);
      expect(c.filas, 'filas leídas por ' + me.usuario).toBeLessThan(20);
    }

    // La carga completa sigue trayendo todo, ordenado
    const todo = await listarConsultas(db, dePlanet, {});
    expect(todo.consultas).toHaveLength(300);
    expect(todo.consultas[0].id).toBe(300);
    expect(todo.consultas[299].mensajes).toHaveLength(3);
    expect(todo.historialCompleto).toBe(true);
  });

  it('buscar al usuario de una sesión no recorre toda la tabla de usuarios', async () => {
    const plan = await db.prepare(
      `EXPLAIN QUERY PLAN SELECT u.* FROM sesiones s JOIN usuarios u ON lower(u.usuario) = lower(s.usuario) WHERE s.token = ? AND s.expira > ?`
    ).bind('x', 1).all();
    const pasos = plan.results.map((p) => p.detail).join(' | ');
    expect(pasos).not.toMatch(/SCAN/);
    expect(pasos).toMatch(/idx_usuarios_minusculas/);
  });

  it('a un cliente no se le mandan los usuarios de login', async () => {
    const { nume, planet } = await escenario();
    const { id } = await consulta(nume);
    await planet({ action: 'responder', id, texto: 'Hola' });
    const [c] = (await nume({ action: 'consultas' })).consultas;
    expect(JSON.stringify(c)).not.toMatch(/beto\.planet|nico\.nume/);
    expect(c.mensajes.map((m) => m.nombre)).toEqual(['Nico', 'Beto']);
    const [p] = (await planet({ action: 'consultas' })).consultas;
    expect(p.mensajes.map((m) => m.autor)).toEqual(['nico.nume', 'beto.planet']);
  });
});

describe('migración 0003', () => {
  it('completa el "último cambio" de las consultas migradas que lo tenían en 0', async () => {
    await db.batch([
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, actualizado, creado_en, cerrado_en) VALUES (1, '', 'a', 'NUME', 'x', 0, 1000, 5000)`),
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, actualizado, creado_en) VALUES (2, '', 'b', 'NUME', 'x', 0, 1000)`),
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, actualizado, creado_en) VALUES (3, '', 'c', 'NUME', 'x', 777, 1000)`),
      db.prepare(`INSERT INTO mensajes (consulta_id, autor, fecha, creado_en) VALUES (2, 'x', '', 9000)`),
    ]);
    const m = env.MIGRACIONES.find((x) => x.name.startsWith('0003'));
    for (const q of m.queries.filter((q) => /^\s*UPDATE/i.test(q))) await db.prepare(q).run();
    const act = (await db.prepare('SELECT id, actualizado FROM consultas ORDER BY id').all()).results;
    expect(act).toEqual([{ id: 1, actualizado: 5000 }, { id: 2, actualizado: 9000 }, { id: 3, actualizado: 777 }]);
  });
});

describe('migración 0002 (fechas de la planilla)', () => {
  const aplicar = async () => {
    const m = env.MIGRACIONES.find((x) => x.name.startsWith('0002'));
    for (const q of m.queries) await db.prepare(q).run();
  };

  it('pasa los números de serie de Google Sheets a fecha y recalcula el alta', async () => {
    await db.batch([
      // "46274" = 09/09/2026; guardado mal como el año 46274
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, creado_en) VALUES (1, '46274', 'a', 'NUME', 'x', 1398099225600000)`),
      // con hora: 46279.45208333333 = 14/09/2026 10:51
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, creado_en) VALUES (2, '46279.45208333333', 'b', 'NUME', 'x', 0)`),
      // consulta nueva, ya bien: no se toca
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, creado_en) VALUES (3, '24/09/2026 11:45', 'c', 'NUME', 'x', 1790261100000)`),
    ]);
    await aplicar();
    const f = (await db.prepare('SELECT id, fecha, creado_en FROM consultas ORDER BY id').all()).results;
    expect(f).toEqual([
      { id: 1, fecha: '09/09/2026', creado_en: Date.UTC(2026, 8, 9, 3) },
      { id: 2, fecha: '14/09/2026 10:51', creado_en: Date.UTC(2026, 8, 14, 13, 51) },
      { id: 3, fecha: '24/09/2026 11:45', creado_en: 1790261100000 },
    ]);
  });

  it('lee bien los mensajes "d/m/aa" (antes se leían como mes/día o quedaban en 0)', async () => {
    await db.batch([
      db.prepare(`INSERT INTO consultas (id, fecha, asunto, cliente, creado_por, creado_en) VALUES (1, '08/09/2026', 'a', 'NUME', 'x', 1)`),
      db.prepare(`INSERT INTO mensajes (id, consulta_id, autor, fecha, creado_en) VALUES (1, 1, 'x', '8/9/26', 1786233600000)`),   // leído como 9 de agosto
      db.prepare(`INSERT INTO mensajes (id, consulta_id, autor, fecha, creado_en) VALUES (2, 1, 'x', '29/8/26', 0)`),
      db.prepare(`INSERT INTO mensajes (id, consulta_id, autor, fecha, creado_en) VALUES (3, 1, 'x', '14/09/2026 10:37', 1790170620000)`),
    ]);
    await aplicar();
    const m = (await db.prepare('SELECT id, fecha, creado_en FROM mensajes ORDER BY id').all()).results;
    expect(m).toEqual([
      { id: 1, fecha: '08/09/2026', creado_en: Date.UTC(2026, 8, 8, 3) },
      { id: 2, fecha: '29/08/2026', creado_en: Date.UTC(2026, 7, 29, 3) },
      { id: 3, fecha: '14/09/2026 10:37', creado_en: 1790170620000 },
    ]);
    // El alta imposible (1 ms) se toma del primer mensaje
    expect((await fila(1)).creado_en).toBe(Date.UTC(2026, 7, 29, 3));
  });

});
