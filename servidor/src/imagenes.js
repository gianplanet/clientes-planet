// Fotos adjuntas: se guardan en KV (1 GB gratis, sin tarjeta).
// Si algún día queda corto, se pasa a R2 cambiando solo este archivo.

import { ok, err, CORS } from './http.js';
import { deB64 } from './auth.js';

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;
const CLAVE_VALIDA = /^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/;

export async function subirImagen(env, p, origen) {
  if (!env.IMAGENES) return err('El almacenamiento de imágenes todavía no está activado');
  const mime = String(p.mime || '');
  const datos = p.data ?? p.datos;
  if (!datos) return err('Falta la imagen');
  if (!TIPOS[mime]) return err('Solo se pueden subir imágenes');

  let bytes;
  try { bytes = deB64(String(datos).replace(/^data:[^,]+,/, '')); }
  catch { return err('Imagen inválida'); }
  if (!bytes.length) return err('Imagen vacía');
  if (bytes.length > MAX_BYTES) return err('La imagen es demasiado grande (máx. 5 MB)');

  const clave = `${crypto.randomUUID()}.${TIPOS[mime]}`;
  await env.IMAGENES.put(clave, bytes, { metadata: { mime } });
  // Va la URL completa porque el portal vive en otro dominio (github.io)
  return ok({ id: `${origen}/img/${clave}` });
}

export async function servirImagen(env, url) {
  const clave = decodeURIComponent(url.pathname.slice('/img/'.length));
  if (!env.IMAGENES || !CLAVE_VALIDA.test(clave)) return new Response('No encontrada', { status: 404, headers: CORS });
  const { value, metadata } = await env.IMAGENES.getWithMetadata(clave, { type: 'arrayBuffer' });
  if (!value) return new Response('No encontrada', { status: 404, headers: CORS });
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.mime || 'image/jpeg',
      // Las imágenes nunca cambian: el navegador puede guardarlas para siempre
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...CORS,
    },
  });
}
