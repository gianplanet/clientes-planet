/**
 * Portal Clientes Planet — servidor en Cloudflare Workers.
 *
 * Organización:
 *   acciones.js   qué acciones hay y quién puede usar cada una
 *   auth.js       contraseñas, sesiones, límite de intentos
 *   consultas.js  listar, crear, responder, cambiar estado
 *   metricas.js   números para la pantalla de métricas
 *   notas.js      post-its de Planet
 *   admin.js      usuarios y clientes
 *   imagenes.js   fotos adjuntas
 *   http.js / util.js  respuestas, fechas y ayudas chicas
 *
 * La estructura de la base está en migrations/ (se aplica con wrangler).
 */

import { CORS, responderJson, leerParametros, err } from './http.js';
import { ejecutar } from './acciones.js';
import { servirImagen } from './imagenes.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname.startsWith('/img/')) return servirImagen(env, url);

    const p = await leerParametros(request, url);
    if (!p.action) return responderJson(err('Falta el parámetro action'));

    const ctx = { origen: url.origin, ip: request.headers.get('CF-Connecting-IP') || '' };
    try {
      return responderJson(await ejecutar(String(p.action), p, env, ctx));
    } catch (e) {
      // El detalle queda en los registros de Cloudflare, no se le muestra al usuario
      console.error('Error en', p.action, e);
      return responderJson(err('Error interno del servidor. Probá de nuevo en unos segundos.'));
    }
  },
};
