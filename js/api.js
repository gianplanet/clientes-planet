// ═══ CONEXIÓN CON EL SERVIDOR ═══
// Servidor en Cloudflare (código en servidor/). Responde en ~200 ms; los
// tiempos de espera de abajo son de sobra, por si el celular tiene mala señal.
const API = 'https://portal-planet.gianlucca-planet.workers.dev';

const API_ESPERA_MS = 30000;         // mensajes y cambios (no se reintentan)
const API_ESPERA_LECTURA_MS = 12000; // lecturas (se reintentan)
const API_ESPERA_FOTO_MS = 90000;    // subir una foto

// Acciones que solo leen: si tardan, se pueden repetir sin riesgo.
// Las que escriben NO se repiten nunca: podrían mandar dos veces el mismo mensaje.
// (Las métricas no: pueden tardar, y es mejor esperarlas una vez con el tiempo largo.)
const API_REINTENTABLES = ['consultas', 'clientes', 'usuarios', 'notas'];

// Fallas pasajeras (reintentar: true): en una lectura, se vuelve a probar
const RES_TARDO = () => ({ ok: false, reintentar: true, error: 'El servidor tardó demasiado en responder. Probá de nuevo en unos segundos.' });
const RES_CAIDO = () => ({ ok: false, reintentar: true, error: 'El servidor no pudo atender el pedido en este momento. Probá de nuevo en unos segundos.' });
const RES_SIN_CONEXION = () => ({ ok: false, reintentar: true, error: 'Error de conexión. Revisá internet y probá de nuevo.' });

// Todos los pedidos van por POST con el cuerpo en JSON: así nada queda en la
// dirección web (ni la contraseña, ni el token), y los mensajes largos entran.
async function api(params) {
  const reintentable = API_REINTENTABLES.includes(params.action);
  const espera = params.action === 'subir_imagen' ? API_ESPERA_FOTO_MS
    : reintentable ? API_ESPERA_LECTURA_MS : API_ESPERA_MS;
  const cuerpo = Object.assign({}, params);
  if (sesion && sesion.token && !cuerpo.token) cuerpo.token = sesion.token;

  let res;
  for (let intento = 1; intento <= (reintentable ? 3 : 1); intento++) {
    if (intento > 1) await new Promise(r => setTimeout(r, 800 * intento));
    res = await pedido(cuerpo, espera);
    if (!res.reintentar) break;
  }
  // Sesión vencida o inválida: volver al login (si sigue siendo la misma sesión)
  if (res.auth === false && sesion && sesion.token === cuerpo.token) {
    salir(true);
    toast(res.error || 'Sesión vencida, ingresá de nuevo');
  }
  return res;
}

async function pedido(cuerpo, espera) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), espera);
  try {
    // Sin cabeceras extra: así el navegador no hace una consulta previa (CORS)
    const r = await fetch(API, { method: 'POST', body: JSON.stringify(cuerpo), signal: ctrl.signal });
    try { return await r.json(); }
    catch (e) { return RES_CAIDO(); }   // no vino JSON: página de error de Cloudflare
  } catch (e) {
    return e.name === 'AbortError' ? RES_TARDO() : RES_SIN_CONEXION();
  } finally {
    clearTimeout(timer);
  }
}
