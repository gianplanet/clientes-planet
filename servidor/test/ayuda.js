// Ayudas para las pruebas: crear usuarios, entrar y llamar al API
// exactamente como lo hace el portal.
import { env } from 'cloudflare:workers';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';

export const db = env.DB;

let ip = 0;
export async function llamar(params, { metodo = 'POST', desdeIp } = {}) {
  const headers = { 'CF-Connecting-IP': desdeIp || '10.0.0.' + (++ip % 250) };
  const req = metodo === 'POST'
    ? new Request('https://portal.test/', { method: 'POST', body: JSON.stringify(params), headers })
    : new Request('https://portal.test/?' + new URLSearchParams(params), { headers });
  const res = await worker.fetch(req, env);
  return res.headers.get('Content-Type')?.includes('json') ? res.json() : res;
}

export async function crearUsuario(usuario, { team = 'cliente', cliente = 'NUME', role = 'user', password = 'clave123', nombre } = {}) {
  await db.prepare('INSERT INTO usuarios (usuario, nombre, password_hash, team, cliente, role) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(usuario, nombre || usuario, await hashPassword(password), team, team === 'planet' ? '-' : cliente, role).run();
}

// Entra y devuelve una función para llamar al API con esa sesión
export async function entrar(usuario, password = 'clave123') {
  const r = await llamar({ action: 'login', usuario, password });
  if (!r.ok) throw new Error('No pudo entrar ' + usuario + ': ' + r.error);
  const api = (params, opciones) => llamar({ token: r.token, ...params }, opciones);
  api.token = r.token;
  api.login = r;
  return api;
}

// Escenario típico: Planet (admin y común) y dos clientes de empresas distintas
export async function escenario() {
  await crearUsuario('ana.planet', { team: 'planet', role: 'admin', nombre: 'Ana' });
  await crearUsuario('beto.planet', { team: 'planet', nombre: 'Beto' });
  await crearUsuario('nico.nume', { cliente: 'NUME', nombre: 'Nico' });
  await crearUsuario('gabi.getbox', { cliente: 'GETBOX', nombre: 'Gabi' });
  return {
    admin: await entrar('ana.planet'),
    planet: await entrar('beto.planet'),
    nume: await entrar('nico.nume'),
    getbox: await entrar('gabi.getbox'),
  };
}

export const consulta = (api, extra = {}) => api({
  action: 'nueva_consulta', asunto: '152089 · NUME · No entregado', tipo: 'No entregado', mensaje: 'Hola', ...extra,
});

export const fila = (id) => db.prepare('SELECT * FROM consultas WHERE id = ?').bind(id).first();
