// Levanta el servidor en esta computadora para las pruebas del portal:
// base de datos local nueva (con las migraciones) y usuarios de prueba.
// No toca nada de producción.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
// Rutas relativas a la raíz: la carpeta del proyecto tiene espacios en el nombre
const estado = '.wrangler/pruebas';
const config = 'servidor/wrangler.toml';
const wrangler = (args, opciones = {}) =>
  spawnSync('npx', ['wrangler', ...args, '--config', config], { cwd: raiz, shell: true, encoding: 'utf8', ...opciones });

// Mismo formato que servidor/src/auth.js
async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  const b64 = (b) => Buffer.from(b).toString('base64');
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

export const USUARIOS = [
  ['ana.planet', 'Ana', 'planet', '-', 'admin'],
  ['beto.planet', 'Beto', 'planet', '-', 'user'],
  ['nico.nume', 'Nico', 'cliente', 'NUME', 'user'],
  ['gabi.getbox', 'Gabi', 'cliente', 'GETBOX', 'user'],
  ['dani.dangelo', 'Dani', 'cliente', "D'Angelo", 'user'],
];
export const CLAVE = 'clave123';

rmSync(path.join(raiz, estado), { recursive: true, force: true });
mkdirSync(path.join(raiz, estado), { recursive: true });
const m = wrangler(['d1', 'migrations', 'apply', 'portal-planet', '--local', '--persist-to', estado]);
if (m.status !== 0) { console.error(m.stdout, m.stderr); process.exit(1); }

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sql = [];
for (const [u, n, t, c, r] of USUARIOS) {
  sql.push(`INSERT INTO usuarios VALUES (${q(u)}, ${q(n)}, ${q(await hash(CLAVE))}, ${q(t)}, ${q(c)}, ${q(r)});`);
}
for (const c of ['NUME', 'GETBOX', "D'Angelo"]) sql.push(`INSERT INTO clientes (nombre, fecha_alta) VALUES (${q(c)}, '24/09/2026');`);
const archivo = path.join(estado, 'datos.sql');
writeFileSync(archivo, sql.join('\n'));
const d = wrangler(['d1', 'execute', 'portal-planet', '--local', '--persist-to', estado, '--file', archivo]);
if (d.status !== 0) { console.error(d.stdout, d.stderr); process.exit(1); }

console.log('Base de prueba lista. Arrancando el servidor en http://127.0.0.1:8787');
spawn('npx', ['wrangler', 'dev', '--config', config, '--persist-to', estado, '--port', '8787', '--ip', '127.0.0.1'],
  { cwd: raiz, shell: true, stdio: 'inherit' });
