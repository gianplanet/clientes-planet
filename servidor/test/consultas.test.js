import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { escenario, consulta, fila, db } from './ayuda.js';

describe('crear y listar', () => {
  it('el cliente crea una consulta y Planet la ve con su primer mensaje', async () => {
    const { nume, planet } = await escenario();
    const r = await consulta(nume, { mensaje: 'No llegó el paquete', imagenes: JSON.stringify(['https://x.test/img/a.jpg']) });
    expect(r).toEqual({ ok: true, id: expect.any(Number) });

    const { consultas } = await planet({ action: 'consultas' });
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toMatchObject({
      id: r.id, cliente: 'NUME', direccion: 'cliente_a_planet', estado: 'Abierto',
      creado_por: 'nico.nume', nombre_creador: 'Nico', tipo: 'No entregado',
      mensajes: [{ autor: 'nico.nume', nombre: 'Nico', texto: 'No llegó el paquete', imagenes: ['https://x.test/img/a.jpg'] }],
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

  it('se puede responder solo con fotos, y se descartan las direcciones peligrosas', async () => {
    const { nume } = await escenario();
    const { id } = await consulta(nume);
    const imagenes = JSON.stringify(['https://x.test/img/a.jpg', 'javascript:alert(1)', 'https://x.test/" onerror="alert(1)', '1AbCdEfGhIjKlMnOpQrStUv']);
    expect((await nume({ action: 'responder', id, imagenes })).ok).toBe(true);
    const { imagenes: guardadas } = await db.prepare('SELECT imagenes FROM mensajes WHERE consulta_id = ? ORDER BY id DESC').bind(id).first();
    expect(JSON.parse(guardadas)).toEqual(['https://x.test/img/a.jpg', '1AbCdEfGhIjKlMnOpQrStUv']);
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
