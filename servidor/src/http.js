// Respuestas del servidor: siempre JSON, con permiso para que el portal
// (que vive en github.io) pueda leerlas.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function responderJson(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export const ok = (data = {}) => ({ ok: true, ...data });
export const err = (msg) => ({ ok: false, error: msg });
export const authErr = () => ({ ok: false, auth: false, error: 'Sesión vencida, ingresá de nuevo' });

// Los parámetros llegan en el cuerpo (POST, lo normal) o en la URL (GET,
// como mandaba la versión anterior del portal). Si vienen en los dos, gana
// el cuerpo.
export async function leerParametros(request, url) {
  const p = Object.fromEntries(url.searchParams);
  if (request.method !== 'POST') return p;
  try {
    const cuerpo = await request.json();
    if (cuerpo && typeof cuerpo === 'object') Object.assign(p, cuerpo);
  } catch {
    // cuerpo vacío o que no es JSON: nos quedamos con lo de la URL
  }
  return p;
}
