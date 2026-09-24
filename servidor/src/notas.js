// Post-its personales de Planet: cada usuario ve y edita solo los suyos.

import { ok, err } from './http.js';
import { ahoraAR, esVerdadero, idValido } from './util.js';

const COLORES = ['amarillo', 'rosa', 'verde', 'celeste', 'violeta'];
const MAX_TEXTO = 1000;

export async function listarNotas(db, me) {
  const { results } = await db.prepare(
    'SELECT * FROM notas WHERE lower(autor) = lower(?) ORDER BY id'
  ).bind(me.usuario).all();
  return results.map((n) => ({
    id: n.id,
    texto: String(n.texto || ''),
    color: COLORES.includes(n.color) ? n.color : 'amarillo',
    pin: esVerdadero(n.pin),
    min: esVerdadero(n.min),
    x: n.x === null ? null : Number(n.x),
    y: n.y === null ? null : Number(n.y),
    fecha: n.fecha,
    actualizado: n.actualizado || '',
  }));
}

// La nota existe y es de este usuario
async function notaPropia(db, me, id) {
  const nota = await db.prepare('SELECT autor FROM notas WHERE id = ?').bind(id).first();
  if (!nota) return { falta: true };
  if (String(nota.autor).toLowerCase() !== String(me.usuario).toLowerCase()) return { ajena: true };
  return {};
}

// Solo se toman los campos que llegaron (un arrastre manda x/y, escribir manda texto…)
function camposRecibidos(p) {
  const num = (v) => (v === undefined || v === '' || v === null || isNaN(Number(v)) ? undefined : Number(v));
  const bool = (v) => (v === undefined ? undefined : esVerdadero(v) ? 1 : 0);
  const campos = {
    texto: p.texto === undefined ? undefined : String(p.texto).slice(0, MAX_TEXTO),
    color: p.color === undefined ? undefined : COLORES.includes(p.color) ? p.color : 'amarillo',
    pin: bool(p.pin),
    min: bool(p.min),
    x: num(p.x),
    y: num(p.y),
  };
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
}

export async function guardarNota(db, me, p) {
  const ahora = ahoraAR();
  const c = camposRecibidos(p);

  if (!p.id) {
    const res = await db.prepare(
      `INSERT INTO notas (texto, color, pin, autor, nombre_autor, fecha, actualizado, actualizado_por, x, y, min)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(c.texto || '', c.color || 'amarillo', c.pin || 0, me.usuario, me.nombre,
           ahora, ahora, me.nombre, c.x ?? null, c.y ?? null, c.min || 0).run();
    return ok({ id: res.meta.last_row_id, fecha: ahora });
  }

  const id = idValido(p.id);
  const dueño = id ? await notaPropia(db, me, id) : { falta: true };
  if (dueño.falta) return err('La nota ya no existe');
  if (dueño.ajena) return err('Esa nota no es tuya');

  const cols = Object.keys(c);   // nombres fijos de camposRecibidos: no vienen del usuario
  await db.prepare(
    `UPDATE notas SET ${[...cols.map((k) => `${k} = ?`), 'actualizado = ?'].join(', ')} WHERE id = ?`
  ).bind(...cols.map((k) => c[k]), ahora, id).run();
  return ok({ id, actualizado: ahora });
}

export async function borrarNota(db, me, p) {
  const id = idValido(p.id);
  const dueño = id ? await notaPropia(db, me, id) : { falta: true };
  if (dueño.falta) return ok();   // ya no estaba: da igual
  if (dueño.ajena) return err('Esa nota no es tuya');
  await db.prepare('DELETE FROM notas WHERE id = ?').bind(id).run();
  return ok();
}
