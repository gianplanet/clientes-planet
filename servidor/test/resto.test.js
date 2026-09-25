import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index.js';
import { escenario, consulta, llamar, entrar, db } from './ayuda.js';

const H = 3600000;

describe('métricas', () => {
  it('calcula tiempos en horas corridas, separando la espera del cliente', async () => {
    const { nume, planet, admin } = await escenario();
    const { id } = await consulta(nume);
    // Armamos una historia con horas conocidas:
    // alta 0 h · Planet contesta 2 h · cliente contesta 10 h · cierre 12 h
    const t0 = Date.now() - 24 * H;
    await db.batch([
      db.prepare('UPDATE consultas SET creado_en = ? WHERE id = ?').bind(t0, id),
      db.prepare('UPDATE mensajes SET creado_en = ?, equipo = ? WHERE consulta_id = ?').bind(t0, 'cliente', id),
      db.prepare(`INSERT INTO mensajes (consulta_id, autor, fecha, creado_en, equipo) VALUES (?, 'beto.planet', '', ?, 'planet')`).bind(id, t0 + 2 * H),
      db.prepare(`INSERT INTO mensajes (consulta_id, autor, fecha, creado_en, equipo) VALUES (?, 'nico.nume', '', ?, 'cliente')`).bind(id, t0 + 10 * H),
      db.prepare(`UPDATE consultas SET estado = 'Cerrado', cerrado_en = ? WHERE id = ?`).bind(t0 + 12 * H, id),
    ]);
    // Una abierta hace 3 días y una excluida (limpieza) que no debe contar
    const vieja = await consulta(nume);
    await db.prepare('UPDATE consultas SET creado_en = ? WHERE id = ?').bind(Date.now() - 72 * H, vieja.id).run();
    const excluida = await consulta(nume);
    await db.prepare('UPDATE consultas SET excluir_metricas = 1 WHERE id = ?').bind(excluida.id).run();
    // Las que enviamos nosotros no se miden acá
    await consulta(planet, { cliente: 'GETBOX', direccion: 'planet_a_cliente' });

    const m = await admin({ action: 'metricas', dias: 30 });
    expect(m).toMatchObject({
      ok: true, dias: 30, cliente: 'Todos',
      nuevas: 2, resueltas: 1, excluidas: 1,
      resolucion: { mediana: 12 * H, muestras: 1, aproximadas: 0 },
      tiempoNuestro: { mediana: 4 * H, muestras: 1 },         // 12 h - 8 h esperando al cliente
      primeraRespuesta: { mediana: 2 * H, muestras: 1, sinResponder: 1 },
      respuestaCliente: { mediana: 8 * H, muestras: 1 },
      nuestrasRespuestas: { mediana: 2 * H, muestras: 1 },
      tipos: [{ tipo: 'No entregado', cantidad: 2 }],
      clientes: [{ cliente: 'NUME', nuevas: 2, resueltas: 1, resolucion: 12 * H, nuestro: 4 * H }],
    });
    expect(m.abiertas.cantidad).toBe(1);
    expect(m.abiertas.masDe48h).toBe(1);
  });

  it('las de cierre estimado no entran en el tiempo de resolución', async () => {
    const { nume, admin } = await escenario();
    const { id } = await consulta(nume);
    await db.prepare(`UPDATE consultas SET estado = 'Cerrado', cerrado_en = ?, cierre_aprox = 1 WHERE id = ?`).bind(Date.now(), id).run();
    const m = await admin({ action: 'metricas', dias: 0 });
    expect(m.resueltas).toBe(1);
    expect(m.resolucion).toMatchObject({ muestras: 0, mediana: null, aproximadas: 1 });
  });

  it('filtra por cliente', async () => {
    const { nume, getbox, admin } = await escenario();
    await consulta(nume);
    await consulta(getbox, { asunto: 'X · GETBOX · Otro' });
    const m = await admin({ action: 'metricas', cliente: 'GETBOX' });
    expect(m.nuevas).toBe(1);
    expect(m.tipos).toEqual([{ tipo: 'No entregado', cantidad: 1 }]);
  });
});

describe('post-its', () => {
  it('cada uno ve, edita y borra solo los suyos', async () => {
    const { admin, planet } = await escenario();
    const { id } = await planet({ action: 'nota_guardar', texto: 'Llamar a NUME', color: 'rosa', x: '0.5', y: 120 });
    expect((await planet({ action: 'notas' })).notas).toEqual([
      expect.objectContaining({ id, texto: 'Llamar a NUME', color: 'rosa', pin: false, min: false, x: 0.5, y: 120 }),
    ]);
    expect((await admin({ action: 'notas' })).notas).toEqual([]);
    expect((await admin({ action: 'nota_guardar', id, texto: 'hackeada' })).error).toBe('Esa nota no es tuya');
    expect((await admin({ action: 'nota_borrar', id })).error).toBe('Esa nota no es tuya');

    // Solo cambia lo que llega
    await planet({ action: 'nota_guardar', id, pin: '1' });
    const [n] = (await planet({ action: 'notas' })).notas;
    expect(n).toMatchObject({ texto: 'Llamar a NUME', color: 'rosa', pin: true, x: 0.5 });

    // Colores desconocidos vuelven a amarillo; el texto se recorta
    await planet({ action: 'nota_guardar', id, color: 'negro', texto: 'x'.repeat(2000) });
    const [n2] = (await planet({ action: 'notas' })).notas;
    expect(n2.color).toBe('amarillo');
    expect(n2.texto).toHaveLength(1000);

    expect((await planet({ action: 'nota_borrar', id })).ok).toBe(true);
    expect((await planet({ action: 'nota_borrar', id })).ok).toBe(true);   // ya no estaba: da igual
    expect((await planet({ action: 'notas' })).notas).toEqual([]);
  });

  it('Planet recibe sus notas al entrar', async () => {
    const { planet } = await escenario();
    await planet({ action: 'nota_guardar', texto: 'hola' });
    const again = await entrar('beto.planet');
    expect(again.login.notas).toHaveLength(1);
  });
});

describe('administración', () => {
  it('crea usuarios validando equipo, rol y empresa', async () => {
    const { admin } = await escenario();
    expect((await admin({ action: 'crear_usuario', usuario: 'Juan.Nume', nombre: 'Juan', password: 'x1', cliente: 'NUME' })).ok).toBe(true);
    expect((await admin({ action: 'crear_usuario', usuario: 'juan.nume', nombre: 'Juan', password: 'x1', cliente: 'NUME' })).error).toBe('El usuario ya existe');
    expect((await admin({ action: 'crear_usuario', usuario: 'sin.empresa', nombre: 'X', password: 'x1', team: 'cliente' })).error).toMatch(/empresa/);
    await admin({ action: 'crear_usuario', usuario: 'raro', nombre: 'R', password: 'x1', team: 'hacker', role: 'dios', cliente: 'NUME' });
    const u = await db.prepare("SELECT team, role FROM usuarios WHERE usuario = 'raro'").first();
    expect(u).toEqual({ team: 'cliente', role: 'user' });
    const lista = (await admin({ action: 'usuarios' })).usuarios;
    expect(lista.find((x) => x.usuario === 'juan.nume')).toEqual({ usuario: 'juan.nume', nombre: 'Juan', team: 'cliente', cliente: 'NUME', role: 'user' });
    expect(lista[0].password_hash).toBeUndefined();
  });

  it('cambiar la contraseña cierra las otras sesiones de ese usuario', async () => {
    const { admin, nume } = await escenario();
    await admin({ action: 'editar_usuario', usuario: 'nico.nume', password: 'nueva456' });
    expect(await nume({ action: 'consultas' })).toMatchObject({ auth: false });
    expect((await llamar({ action: 'login', usuario: 'nico.nume', password: 'clave123' })).ok).toBe(false);
    expect((await llamar({ action: 'login', usuario: 'nico.nume', password: 'nueva456' })).ok).toBe(true);
  });

  it('el admin que cambia su propia contraseña sigue adentro', async () => {
    const { admin } = await escenario();
    await admin({ action: 'editar_usuario', usuario: 'ana.planet', password: 'otra789' });
    expect((await admin({ action: 'consultas' })).ok).toBe(true);
  });

  it('pasar a Planet deja la empresa en "-"; no se puede eliminar a uno mismo', async () => {
    const { admin } = await escenario();
    await admin({ action: 'editar_usuario', usuario: 'nico.nume', team: 'planet' });
    expect(await db.prepare("SELECT team, cliente FROM usuarios WHERE usuario = 'nico.nume'").first()).toEqual({ team: 'planet', cliente: '-' });
    expect((await admin({ action: 'eliminar_usuario', usuario: 'ANA.planet' })).error).toMatch(/propio usuario/);
    expect((await admin({ action: 'eliminar_usuario', usuario: 'nadie' })).error).toBe('Usuario no encontrado');
  });

  it('clientes: crear, editar, listar y eliminar', async () => {
    const { admin, planet } = await escenario();
    const { id } = await admin({ action: 'crear_cliente', nombre: ' NUME ', email: 'a@b.c' });
    expect((await admin({ action: 'crear_cliente', nombre: 'nume' })).error).toMatch(/Ya existe/);
    await admin({ action: 'editar_cliente', id, telefono: '1234' });
    const [c] = (await planet({ action: 'clientes' })).clientes;
    expect(c).toMatchObject({ id, nombre: 'NUME', email: 'a@b.c', telefono: '1234' });
    expect(c.fecha_alta).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect((await admin({ action: 'eliminar_cliente', id })).ok).toBe(true);
    expect((await admin({ action: 'eliminar_cliente', id })).error).toBe('Cliente no encontrado');
  });
});

describe('imágenes', () => {
  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('sube una imagen y se puede ver por su URL', async () => {
    const { nume } = await escenario();
    const r = await nume({ action: 'subir_imagen', mime: 'image/png', data: 'data:image/png;base64,' + PNG_1PX });
    expect(r.ok).toBe(true);
    expect(r.id).toMatch(/^https:\/\/portal\.test\/img\/[0-9a-f-]{36}\.png$/);
    const img = await worker.fetch(new Request(r.id), env);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await img.arrayBuffer()).slice(1, 4)).toEqual(new Uint8Array([80, 78, 71]));   // "PNG"
  });

  it('rechaza lo que no es imagen y claves raras', async () => {
    const { nume } = await escenario();
    expect((await nume({ action: 'subir_imagen', mime: 'text/html', data: 'PGI+' })).error).toBe('Solo se pueden subir imágenes');
    expect((await nume({ action: 'subir_imagen', mime: 'image/png' })).error).toBe('Falta la imagen');
    expect((await worker.fetch(new Request('https://portal.test/img/migracion_metricas_v4'), env)).status).toBe(404);
  });

  it('sin sesión no se puede subir', async () => {
    expect(await llamar({ action: 'subir_imagen', mime: 'image/png', data: PNG_1PX })).toMatchObject({ auth: false });
  });
});

describe('errores inesperados', () => {
  it('no muestra detalles internos al usuario', async () => {
    const { nume } = await escenario();
    await db.prepare('ALTER TABLE mensajes RENAME TO mensajes_fuera').run();
    try {
      const r = await consulta(nume);
      expect(r).toEqual({ ok: false, error: 'Error interno del servidor. Probá de nuevo en unos segundos.' });
    } finally {
      await db.prepare('ALTER TABLE mensajes_fuera RENAME TO mensajes').run();
    }
  });
});
