// Antes de cada archivo de pruebas: la estructura de migrations/.
// Antes de cada prueba: todas las tablas vacías, para que no se pisen entre sí.
import { beforeEach } from 'vitest';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.MIGRACIONES);

const TABLAS = ['usuarios', 'consultas', 'mensajes', 'eventos', 'clientes', 'notas', 'sesiones', 'intentos_login'];
beforeEach(async () => {
  await env.DB.batch(TABLAS.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});
