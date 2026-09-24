// Consultas y mensajes: listar, crear, responder y cambiar de estado.

import { ok, err } from './http.js';
import { esPlanet } from './auth.js';
import { ahoraAR, msDeFechaAR, tipoDeAsunto, esVerdadero, texto, idValido, DIA_MS } from './util.js';

// Estados que se guardan en la base. Cada lado los ve con su propio nombre
// (eso lo resuelve el portal).
export const ESTADOS = ['Abierto', 'En proceso', 'Esperando info', 'Respuesta cliente', 'Cerrado'];
const DIRECCIONES = ['cliente_a_planet', 'planet_a_cliente'];

const MAX_ASUNTO = 300;
const MAX_MENSAJE = 5000;
const MAX_IMAGENES = 10;

// De entrada se cargan las abiertas y las cerradas con movimiento en los
// últimos 60 días. El historial completo se pide aparte ("Ver historial").
const DIAS_HISTORIAL = 60;

// Al pedir "lo que cambió desde X" se vuelve un minuto atrás: la hora de un
// cambio se toma antes de guardarlo, así que uno lento puede quedar con una
// hora anterior a otro que se guardó después. El portal descarta lo repetido.
const SOLAPA_MS = 60000;

// ── LISTAR ─────────────────────────────────────────────────
// Un cliente solo ve su empresa. Planet ve todo, o un cliente si lo pide.
function clienteVisible(me, p) {
  if (!esPlanet(me)) return me.cliente;
  return p.cliente && p.cliente !== 'Todos' ? String(p.cliente) : null;
}

// Acepta:
//   desde=<ms>   → solo las consultas que cambiaron desde ese momento
//   historial=1  → todas, incluidas las cerradas viejas
//   (nada)       → abiertas + cerradas de los últimos 60 días
export async function listarConsultas(db, me, p = {}) {
  const ahora = Date.now();
  const cliente = clienteVisible(me, p);
  const desde = Number(p.desde) || 0;
  const historial = esVerdadero(p.historial);

  const conds = [], vals = [];
  if (cliente) { conds.push('c.cliente = ?'); vals.push(cliente); }
  if (desde) { conds.push('c.actualizado > ?'); vals.push(desde - SOLAPA_MS); }
  else if (!historial) { conds.push("(c.estado != 'Cerrado' OR c.actualizado >= ?)"); vals.push(ahora - DIAS_HISTORIAL * DIA_MS); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const soloCliente = cliente ? 'AND cliente = ?' : '';
  const valCliente = cliente ? [cliente] : [];

  // Todo en un solo viaje a la base. Los mensajes van con JOIN y no con
  // "IN (lista de ids)": D1 acepta como máximo 100 valores por consulta.
  const [rConsultas, rMensajes, rUltimo, rViejas] = await db.batch([
    db.prepare(`SELECT c.* FROM consultas c ${where} ORDER BY c.id DESC`).bind(...vals),
    db.prepare(
      `SELECT m.consulta_id, m.autor, m.nombre, m.fecha, m.texto, m.imagenes
       FROM mensajes m JOIN consultas c ON c.id = m.consulta_id ${where} ORDER BY m.id`
    ).bind(...vals),
    db.prepare(`SELECT MAX(actualizado) AS u FROM consultas WHERE 1 ${soloCliente}`).bind(...valCliente),
    db.prepare(
      `SELECT COUNT(*) AS n FROM consultas WHERE estado = 'Cerrado' AND actualizado < ? ${soloCliente}`
    ).bind(ahora - DIAS_HISTORIAL * DIA_MS, ...valCliente),
  ]);

  const mensajes = new Map();
  for (const m of rMensajes.results) {
    const msg = { autor: m.autor, nombre: m.nombre, fecha: m.fecha, texto: m.texto };
    const imgs = leerImagenes(m.imagenes);
    if (imgs.length) msg.imagenes = imgs;
    if (!mensajes.has(m.consulta_id)) mensajes.set(m.consulta_id, []);
    mensajes.get(m.consulta_id).push(msg);
  }

  return {
    consultas: rConsultas.results.map((c) => ({
      id: c.id, fecha: c.fecha, asunto: c.asunto, cliente: c.cliente,
      direccion: c.direccion, estado: c.estado, creado_por: c.creado_por,
      nombre_creador: c.nombre_creador, atendido_por: c.atendido_por || '',
      tipo: c.tipo || tipoDeAsunto(c.asunto),
      creado_en: c.creado_en || msDeFechaAR(c.fecha),
      actualizado: c.actualizado || 0,
      cerrado_en: c.cerrado_en || null,
      cierre_aprox: c.cierre_aprox ? 1 : 0,
      reabierta_en: c.reabierta_en || null,
      reaberturas: c.reaberturas || 0,
      mensajes: mensajes.get(c.id) || [],
    })),
    ultimo: rUltimo.results[0]?.u || 0,
    // Si hay cerradas viejas que no se mandaron, el portal ofrece cargarlas
    historialCompleto: historial || !!desde || !rViejas.results[0]?.n,
  };
}

// Marca del último cambio visible para este usuario (la pregunta barata
// que el portal hacía cada 30 s; queda por compatibilidad).
export async function ultimoCambio(db, me) {
  const fila = esPlanet(me)
    ? await db.prepare('SELECT MAX(actualizado) AS u FROM consultas').first()
    : await db.prepare('SELECT MAX(actualizado) AS u FROM consultas WHERE cliente = ?').bind(me.cliente).first();
  return fila?.u || 0;
}

// ── IMÁGENES DE UN MENSAJE ─────────────────────────────────
// Acepta dos formatos:
//  - URL completa  → imagen guardada en Cloudflare (http solo en las pruebas locales)
//  - id de Drive   → imagen de cuando el servidor era Apps Script
export function imagenesValidas(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((u) => typeof u === 'string' && (/^https?:\/\/[^\s"'<>]+$/.test(u) || /^[\w-]{20,60}$/.test(u)))
    .slice(0, MAX_IMAGENES);
}

function leerImagenes(json) {
  if (!json) return [];
  try { return imagenesValidas(JSON.parse(json)); } catch { return []; }
}

// ── EVENTOS (para las métricas) ────────────────────────────
function anotarEvento(db, { consultaId, evento, de = '', a = '', me, cuando }) {
  return db.prepare(
    `INSERT INTO eventos (consulta_id, evento, de_estado, a_estado, quien, nombre, equipo, cuando)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(consultaId, evento, de || '', a || '', me.usuario, me.nombre, me.team || '', cuando);
}

function insertarMensaje(db, { consultaId, me, fecha, texto: t, imgs, cuando }) {
  return db.prepare(
    `INSERT INTO mensajes (consulta_id, autor, nombre, fecha, texto, imagenes, creado_en, equipo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(consultaId, me.usuario, me.nombre, fecha, t, imgs.length ? JSON.stringify(imgs) : null, cuando, me.team || '');
}

// ── CREAR ──────────────────────────────────────────────────
export async function nuevaConsulta(db, me, p) {
  const asunto = texto(p.asunto, MAX_ASUNTO);
  const mensaje = texto(p.mensaje, MAX_MENSAJE);
  const cliente = esPlanet(me) ? texto(p.cliente, 100) : me.cliente;
  const direccion = esPlanet(me) && DIRECCIONES.includes(p.direccion) ? p.direccion : 'cliente_a_planet';
  if (!asunto || !cliente || !mensaje) return err('Faltan campos obligatorios');

  const ahora = Date.now();
  const fecha = ahoraAR(false, ahora);
  const tipo = texto(p.tipo, 100) || tipoDeAsunto(asunto);
  const estado = direccion === 'planet_a_cliente' ? 'Esperando info' : 'Abierto';
  const res = await db.prepare(
    `INSERT INTO consultas (fecha, asunto, cliente, direccion, estado, creado_por, nombre_creador,
                            atendido_por, actualizado, tipo, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
  ).bind(fecha, asunto, cliente, direccion, estado, me.usuario, me.nombre, ahora, tipo, ahora).run();

  const id = res.meta.last_row_id;
  await db.batch([
    insertarMensaje(db, { consultaId: id, me, fecha, texto: mensaje, imgs: imagenesValidas(p.imagenes), cuando: ahora }),
    anotarEvento(db, { consultaId: id, evento: 'creada', a: estado, me, cuando: ahora }),
  ]);
  return ok({ id });
}

// ── RESPONDER ──────────────────────────────────────────────
// Flujo de estados:
//  - Planet responde pidiendo info      → Esperando info
//  - Planet responde sin pedir info     → En proceso (si estaba pendiente)
//  - El cliente responde                → Respuesta cliente (salvo que siga Abierta)
//  - Cualquiera escribe en una cerrada  → se reabre (Planet: En proceso · cliente: Abierto)
export function estadoTrasMensaje(estado, planet, pideInfo) {
  if (estado === 'Cerrado') return planet ? 'En proceso' : 'Abierto';
  if (planet) {
    if (pideInfo) return 'Esperando info';
    if (estado === 'Abierto' || estado === 'Respuesta cliente') return 'En proceso';
    return estado;
  }
  return estado === 'Abierto' ? estado : 'Respuesta cliente';
}

export async function responder(db, me, p) {
  const id = idValido(p.id);
  const t = texto(p.texto, MAX_MENSAJE);
  const imgs = imagenesValidas(p.imagenes);
  if (!id || (!t && !imgs.length)) return err('Faltan campos');

  const c = await db.prepare('SELECT * FROM consultas WHERE id = ?').bind(id).first();
  // Un cliente solo responde consultas de su empresa
  if (!c || (!esPlanet(me) && c.cliente !== me.cliente)) return err('Consulta no encontrada');

  const ahora = Date.now();
  const reabre = c.estado === 'Cerrado';
  const nuevo = estadoTrasMensaje(c.estado, esPlanet(me), esVerdadero(p.esperar_info));
  const ops = [
    insertarMensaje(db, { consultaId: id, me, fecha: ahoraAR(false, ahora), texto: t, imgs, cuando: ahora }),
    anotarEvento(db, { consultaId: id, evento: 'mensaje', de: c.estado, me, cuando: ahora }),
    db.prepare('UPDATE consultas SET actualizado = ? WHERE id = ?').bind(ahora, id),
  ];
  if (reabre) {
    ops.push(
      db.prepare('UPDATE consultas SET cerrado_en = NULL, reabierta_en = ?, reaberturas = reaberturas + 1 WHERE id = ?').bind(ahora, id),
      anotarEvento(db, { consultaId: id, evento: 'reabierta', de: 'Cerrado', a: nuevo, me, cuando: ahora })
    );
  } else if (nuevo !== c.estado) {
    ops.push(anotarEvento(db, { consultaId: id, evento: 'estado', de: c.estado, a: nuevo, me, cuando: ahora }));
  }
  if (nuevo !== c.estado) {
    ops.push(db.prepare('UPDATE consultas SET estado = ? WHERE id = ?').bind(nuevo, id));
  }
  // El primero de Planet que la mueve queda como quien la atiende
  if (esPlanet(me) && nuevo !== c.estado && !c.atendido_por) {
    ops.push(db.prepare('UPDATE consultas SET atendido_por = ? WHERE id = ?').bind(me.nombre, id));
  }
  await db.batch(ops);
  return ok({ reabierta: reabre, estado: nuevo });
}

// ── CAMBIAR ESTADO (solo Planet) ───────────────────────────
export async function cambiarEstado(db, me, p) {
  const id = idValido(p.id);
  const estado = p.estado;
  if (!id || !estado) return err('Faltan campos');
  if (!ESTADOS.includes(estado)) return err('Estado inválido');
  const antes = await db.prepare('SELECT estado, atendido_por FROM consultas WHERE id = ?').bind(id).first();
  if (!antes) return err('Consulta no encontrada');
  if (antes.estado === estado) return ok({});   // nada que cambiar (y no pisa la hora de cierre)

  const ahora = Date.now();
  const reabre = antes.estado === 'Cerrado';
  const ops = [
    // Al cerrar se guarda el momento exacto (mide el tiempo de resolución).
    // Si deja de estar cerrada, se borra para no dejar un cierre falso.
    db.prepare('UPDATE consultas SET estado = ?, actualizado = ?, cerrado_en = ? WHERE id = ?')
      .bind(estado, ahora, estado === 'Cerrado' ? ahora : null, id),
    anotarEvento(db, { consultaId: id, evento: reabre ? 'reabierta' : 'estado', de: antes.estado, a: estado, me, cuando: ahora }),
  ];
  if (reabre) {
    ops.push(db.prepare('UPDATE consultas SET reabierta_en = ?, reaberturas = reaberturas + 1 WHERE id = ?').bind(ahora, id));
  }
  if (!antes.atendido_por) {
    ops.push(db.prepare('UPDATE consultas SET atendido_por = ? WHERE id = ?').bind(me.nombre, id));
  }
  await db.batch(ops);
  return ok({});
}
