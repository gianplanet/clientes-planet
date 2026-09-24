// Gestión de usuarios (solo admin) y de clientes.

import { ok, err } from './http.js';
import { hashPassword, borrarSesionesDe } from './auth.js';
import { ahoraAR, texto, idValido } from './util.js';

const EQUIPOS = ['planet', 'cliente'];
const ROLES = ['user', 'admin'];
const CAMPOS_CLIENTE = ['nombre', 'contacto', 'telefono', 'email', 'direccion', 'notas'];

// ── USUARIOS ───────────────────────────────────────────────
export async function listarUsuarios(db) {
  const { results } = await db.prepare(
    'SELECT usuario, nombre, team, cliente, role FROM usuarios ORDER BY usuario'
  ).all();
  return ok({ usuarios: results });
}

async function existeUsuario(db, usuario) {
  return !!(await db.prepare('SELECT 1 FROM usuarios WHERE lower(usuario) = ?').bind(usuario).first());
}

export async function crearUsuario(db, p) {
  const usuario = texto(p.usuario, 100).toLowerCase();
  const nombre = texto(p.nombre, 100);
  const password = texto(p.password, 200);
  const team = EQUIPOS.includes(p.team) ? p.team : 'cliente';
  const role = ROLES.includes(p.role) ? p.role : 'user';
  const cliente = team === 'cliente' ? texto(p.cliente, 100) : '-';
  if (!usuario || !nombre || !password) return err('Faltan campos');
  if (team === 'cliente' && (!cliente || cliente === '-')) return err('Falta la empresa del cliente');
  if (await existeUsuario(db, usuario)) return err('El usuario ya existe');

  await db.prepare(
    'INSERT INTO usuarios (usuario, nombre, password_hash, team, cliente, role) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(usuario, nombre, await hashPassword(password), team, cliente, role).run();
  return ok();
}

export async function editarUsuario(db, me, p) {
  const usuario = texto(p.usuario, 100).toLowerCase();
  if (!usuario) return err('Falta usuario');
  if (!(await existeUsuario(db, usuario))) return err('Usuario no encontrado');

  const cambios = {};
  if (texto(p.nombre, 100)) cambios.nombre = texto(p.nombre, 100);
  if (EQUIPOS.includes(p.team)) cambios.team = p.team;
  if (ROLES.includes(p.role)) cambios.role = p.role;
  if (cambios.team === 'planet') cambios.cliente = '-';
  else if (texto(p.cliente, 100)) cambios.cliente = texto(p.cliente, 100);
  const password = texto(p.password, 200);
  if (password) cambios.password_hash = await hashPassword(password);

  const cols = Object.keys(cambios);   // nombres fijos, no vienen del usuario
  if (!cols.length) return ok();
  const ops = [
    db.prepare(`UPDATE usuarios SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE lower(usuario) = ?`)
      .bind(...cols.map((k) => cambios[k]), usuario),
  ];
  // Con contraseña nueva se cierran sus otras sesiones abiertas
  if (password) ops.push(borrarSesionesDe(db, usuario, usuario === String(me.usuario).toLowerCase() ? me.token : ''));
  await db.batch(ops);
  return ok();
}

export async function eliminarUsuario(db, me, p) {
  const usuario = texto(p.usuario, 100).toLowerCase();
  if (!usuario) return err('Falta usuario');
  if (usuario === String(me.usuario).toLowerCase()) return err('No podés eliminar tu propio usuario');
  const [res] = await db.batch([
    db.prepare('DELETE FROM usuarios WHERE lower(usuario) = ?').bind(usuario),
    borrarSesionesDe(db, usuario),
  ]);
  if (!res.meta.changes) return err('Usuario no encontrado');
  return ok();
}

// ── CLIENTES ───────────────────────────────────────────────
export async function listarClientes(db) {
  const { results } = await db.prepare('SELECT * FROM clientes ORDER BY id').all();
  return ok({ clientes: results });
}

export async function crearCliente(db, p) {
  const nombre = texto(p.nombre, 100);
  if (!nombre) return err('Falta el nombre del cliente');
  const existe = await db.prepare('SELECT 1 FROM clientes WHERE lower(nombre) = lower(?)').bind(nombre).first();
  if (existe) return err('Ya existe un cliente con ese nombre');
  const res = await db.prepare(
    `INSERT INTO clientes (nombre, contacto, telefono, email, direccion, notas, fecha_alta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(nombre, texto(p.contacto, 200), texto(p.telefono, 100), texto(p.email, 200),
         texto(p.direccion, 300), texto(p.notas, 1000), ahoraAR(true)).run();
  return ok({ id: res.meta.last_row_id });
}

export async function editarCliente(db, p) {
  const id = idValido(p.id);
  if (!id) return err('Falta id del cliente');
  const cols = CAMPOS_CLIENTE.filter((f) => p[f] !== undefined && p[f] !== null);
  if (!cols.length) return ok();
  const res = await db.prepare(`UPDATE clientes SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((k) => texto(p[k], 1000)), id).run();
  if (!res.meta.changes) return err('Cliente no encontrado');
  return ok();
}

export async function eliminarCliente(db, p) {
  const id = idValido(p.id);
  if (!id) return err('Falta id del cliente');
  const res = await db.prepare('DELETE FROM clientes WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return err('Cliente no encontrado');
  return ok();
}
