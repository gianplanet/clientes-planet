// Contraseñas, sesiones y límite de intentos de login.

import { ok, err } from './http.js';
import { texto } from './util.js';

const PBKDF2_ITERACIONES = 100000;
const SESION_MS = 30 * 24 * 3600000;

// Límite de intentos fallidos en una ventana de 15 minutos
const VENTANA_INTENTOS_MS = 15 * 60000;
const MAX_INTENTOS_USUARIO = 8;
const MAX_INTENTOS_IP = 60;   // alto: todo un cliente puede salir por la misma IP

export const esPlanet = (u) => !!u && u.team === 'planet';
export const esAdmin = (u) => esPlanet(u) && u.role === 'admin';

// ── CONTRASEÑAS ────────────────────────────────────────────
// Se guarda solo un resumen irreversible (PBKDF2-SHA256):
// ni nosotros podemos leer la contraseña original.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(password, salt, iteraciones) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iteraciones, hash: 'SHA-256' }, key, 256
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(password, salt, PBKDF2_ITERACIONES);
  return `pbkdf2$${PBKDF2_ITERACIONES}$${b64(salt)}$${b64(hash)}`;
}

async function verificarPassword(password, guardado) {
  if (!guardado || !guardado.startsWith('pbkdf2$')) return false;
  const [, iter, saltB64, hashB64] = guardado.split('$');
  const a = new Uint8Array(await derivar(password, deB64(saltB64), Number(iter)));
  const b = deB64(hashB64);
  if (a.length !== b.length) return false;
  // Comparación de tiempo constante: no revela cuántos bytes coinciden
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── SESIONES ───────────────────────────────────────────────
async function crearSesion(db, usuario) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  await db.prepare('INSERT INTO sesiones (token, usuario, expira) VALUES (?, ?, ?)')
    .bind(token, usuario, Date.now() + SESION_MS).run();
  return token;
}

// El usuario se lee siempre de la base: un cambio de rol o una baja
// aplican al instante.
export async function usuarioDeSesion(db, token) {
  if (!token) return null;
  return db.prepare(
    `SELECT u.* FROM sesiones s
     JOIN usuarios u ON lower(u.usuario) = lower(s.usuario)
     WHERE s.token = ? AND s.expira > ?`
  ).bind(String(token), Date.now()).first();
}

export function borrarSesionesDe(db, usuario, salvoToken = '') {
  return db.prepare('DELETE FROM sesiones WHERE lower(usuario) = lower(?) AND token != ?')
    .bind(usuario, salvoToken);
}

// ── ACCIONES ───────────────────────────────────────────────
export async function login(db, p, ctx) {
  const usuario = texto(p.usuario, 100).toLowerCase();
  const password = texto(p.password, 200);
  if (!usuario || !password) return { error: err('Faltan credenciales') };

  const ahora = Date.now();
  const claves = ['u:' + usuario, 'ip:' + (ctx.ip || '?')];
  const { results: intentos } = await db.prepare(
    `SELECT clave, COUNT(*) AS n FROM intentos_login
     WHERE clave IN (?, ?) AND cuando > ? GROUP BY clave`
  ).bind(...claves, ahora - VENTANA_INTENTOS_MS).all();
  const cuenta = (c) => intentos.find((i) => i.clave === c)?.n || 0;
  if (cuenta(claves[0]) >= MAX_INTENTOS_USUARIO || cuenta(claves[1]) >= MAX_INTENTOS_IP) {
    return { error: err('Demasiados intentos fallidos. Esperá 15 minutos y probá de nuevo.') };
  }

  const user = await db.prepare('SELECT * FROM usuarios WHERE lower(usuario) = ?').bind(usuario).first();
  if (!user || !(await verificarPassword(password, user.password_hash))) {
    await db.batch(claves.map((c) =>
      db.prepare('INSERT INTO intentos_login (clave, cuando) VALUES (?, ?)').bind(c, ahora)));
    return { error: err('Usuario o contraseña incorrectos') };
  }

  // Limpieza de lo vencido, aprovechando que alguien entró
  await db.batch([
    db.prepare('DELETE FROM sesiones WHERE expira < ?').bind(ahora),
    db.prepare('DELETE FROM intentos_login WHERE cuando < ? OR clave = ?').bind(ahora - VENTANA_INTENTOS_MS, claves[0]),
  ]);
  const token = await crearSesion(db, String(user.usuario).toLowerCase());
  return { user, token };
}

export async function logout(db, p) {
  if (p.token) await db.prepare('DELETE FROM sesiones WHERE token = ?').bind(String(p.token)).run();
  return ok();
}
