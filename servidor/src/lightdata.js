// ── LIGHTDATA: leer el estado y los datos de un envío ──────
//
// Lightdata no da una API oficial. Entramos a su panel como lo hace una
// persona: un login que deja una cookie de sesión (PHPSESSID), y después
// pedidos al mismo endpoint que usa el panel. Todo es la cuenta y los envíos
// del propio Planet.
//
// La clave NO vive acá: son secretos del Worker (wrangler secret put):
//   LIGHTDATA_USUARIO, LIGHTDATA_PASS
// La cookie se guarda en KV para no loguear en cada consulta; si se vence, se
// vuelve a entrar solo (Lightdata avisa con estadoLogin:false).
//
// Se puede buscar de dos formas, según lo que haya cargado el cliente:
//  - un número de tracking (solo dígitos) → búsqueda exacta.
//  - una dirección (tiene letras) → se busca por el campo "Destino dirección",
//    filtrando además por el cliente de la consulta para no traer envíos ajenos.

const BASE = 'https://planet.lightdata.com.ar';
const COOKIE_KV_KEY = 'ld:cookie';
const COOKIE_TTL_S = 60 * 30;   // media hora; si se vence antes, re-login solo

// Número de estado de Lightdata → texto para mostrar (g_estados_envios).
const ESTADOS = {
  0: 'Retirado', 1: 'En planta de procesamiento', 2: 'En camino al destinatario',
  3: 'Devolviendo a planta', 5: 'Entregado', 6: 'No entregado', 7: 'A retirar',
  8: 'Cancelado', 9: 'Entregado (2ª visita)', 10: 'No entregado (2ª visita)',
  11: 'En camino (2ª visita)', 12: 'En camino reprogramado', 13: 'No visitado',
  14: 'Devuelto al cliente', 15: 'Rechazado por el comprador', 16: 'Entregado en punto PickUp',
  22: 'Dirección incorrecta', 23: 'Robado / siniestrado', 30: 'Reprogramado por el comprador',
  31: 'Reprogramado por Meli',
};
const TODOS_LOS_ESTADOS = Object.keys(ESTADOS).join(',');

export function textoEstado(n) {
  return ESTADOS[n] ?? ('Estado ' + n);
}

// Saca la referencia (tracking o dirección) del asunto "referencia · cliente · tipo",
// quitando etiquetas del principio ("Tracking 123", "Venta N° 45"). Igual que el
// refDeAsunto del front (js/consultas.js), para que servidor y portal coincidan.
const ETIQUETAS_REF = /^(?:(?:tracking|seguimiento|env[ií]o|gu[ií]a|venta|pedido|orden|nro\.?|n[°º]|n[úu]m(?:ero)?\.?|#)(?![a-záéíóúñ])\s*[:\-–]?\s*)+/i;
export function referenciaDeAsunto(asunto) {
  const primera = (String(asunto || '').split(' · ')[0] || '').trim();
  const sinEtiqueta = primera.replace(ETIQUETAS_REF, '').trim();
  return /^\S*\d/.test(sinEtiqueta) ? sinEtiqueta : primera;
}

// Entra a Lightdata y devuelve la cookie de sesión (PHPSESSID=...).
async function loginLightdata(env) {
  const user = env.LIGHTDATA_USUARIO, pass = env.LIGHTDATA_PASS;
  if (!user || !pass) throw new Error('Faltan las credenciales de Lightdata en el Worker');
  const body = new URLSearchParams({ user, pass, pos: ',', mantener: '1' });
  const r = await fetch(BASE + '/system_user/process_login.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: body.toString(),
  });
  const cookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  const ses = cookies.map((c) => (c || '').split(';')[0]).find((c) => c.startsWith('PHPSESSID='));
  if (!ses) throw new Error('Lightdata no devolvió sesión (¿usuario o clave mal?)');
  return ses;
}

// Cookie de sesión: la cacheada en KV, o una nueva.
async function cookieVigente(env, forzar) {
  if (!forzar && env.IMAGENES) {
    const guardada = await env.IMAGENES.get(COOKIE_KV_KEY);
    if (guardada) return guardada;
  }
  const ses = await loginLightdata(env);
  if (env.IMAGENES) await env.IMAGENES.put(COOKIE_KV_KEY, ses, { expirationTtl: COOKIE_TTL_S });
  return ses;
}

// Un pedido al listado de envíos. `extra` pisa los filtros (tracking_number, cp, nombrecliente…).
async function pedirListado(cookie, extra, pagina = 1, porPagina = 20) {
  const filtros = {
    asignado: '2', nombrecliente: '', nombre: '', cp: '', estado: TODOS_LOS_ESTADOS,
    logisticaInversa: '2', fecha_desde: '01/01/2024', zonasdeentrega: '', origen: '',
    cadete: '', fecha_hasta: '31/12/2030', idml: '', tracking_number: '',
    tipo_fecha: '1', domicilio: '0', obs: '2', ...extra,
  };
  const body = new URLSearchParams();
  body.append('cantxpagina', String(porPagina)); body.append('pagina', String(pagina)); body.append('excel', '0');
  for (const k in filtros) body.append('filtros[' + k + ']', filtros[k]);
  body.append('elim', '0');
  const r = await fetch(BASE + '/modules/envios/listado/procesar_listado.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Cookie': cookie },
    body: body.toString(),
  });
  const txt = await r.text();
  if (r.status !== 200 || !txt) return { _fallo: true, status: r.status };
  try { return JSON.parse(txt); } catch { return { _fallo: true, status: r.status }; }
}

// Detalle de un envío (dirección completa, entre-calles, historial, etc.).
async function pedirDetalle(cookie, did) {
  const r = await fetch(BASE + '/modules/envios/alta/controlador.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Cookie': cookie },
    body: 'operador=get&did=' + encodeURIComponent(did),
  });
  const txt = await r.text();
  if (r.status !== 200 || !txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// Datos cortos de una fila del listado (para la lista "hay varios").
function resumenFila(row) {
  return {
    tracking: row.tracking, did: row.did,
    estado: row.estado_envio, estadoTexto: textoEstado(row.estado_envio),
    destinatario: row.nombre || '', cp: row.cp || '', cliente: row.nombre_fantasia || '',
  };
}

// Arma el detalle "lindo" a partir de una fila + (si se pudo) el detalle completo.
function armarEnvio(row, det) {
  const h = (det && det.header) || {};
  const link = (row.did != null && h.didCliente != null)
    ? `${BASE}/tracking.php?token=${row.did}d54df4s8a${h.didCliente}` : '';
  const historial = ((det && det.historial) || []).map((x) => ({
    estado: Number(x.estado), estadoTexto: textoEstado(Number(x.estado)),
    fecha: x.fecha || '', quien: x.quien || '',
  }));
  return {
    encontrado: true,
    estado: row.estado_envio,
    estadoTexto: textoEstado(row.estado_envio),
    cliente: row.nombre_fantasia || '',
    destinatario: row.nombre || h.destination_receiver_name || '',
    telefono: h.destination_receiver_phone || '',
    direccion: h.destination_shipping_address_line || '',
    entreCalles: h.destination_comments || '',
    localidad: h.destination_city_name || '',
    provincia: h.destination_state_name || '',
    cp: row.cp || h.destination_shipping_zip_code || '',
    zona: row.zona || '',
    metodo: h.lead_time_shipping_method_name || row.lead_time_shipping_method_name || '',
    entregaEstimada: row.estimated_delivery_time_date_72 || '',
    bultos: h.bultos || '', peso: h.peso || '',
    observaciones: h.obs_manual || h.obs || '',
    actualizado: row.ultimaSinc || '',
    tracking: row.tracking, did: row.did,
    link, historial,
  };
}

// Busca un envío por referencia (tracking o dirección). Nunca tira error.
//   referencia: lo que cargó el cliente (número o dirección)
//   cliente:    nombre de la empresa (para acotar la búsqueda por dirección)
export async function buscarEnvio(env, referenciaCruda, cliente) {
  const referencia = String(referenciaCruda || '').trim();
  if (!referencia) return { encontrado: false, motivo: 'sin_referencia' };
  const esTracking = /^\d[\d\s.-]*$/.test(referencia);   // solo dígitos/espacios/.- → tracking
  const filtro = esTracking
    ? { tracking_number: referencia.replace(/\D+/g, '') }
    : { cp: referencia, nombrecliente: String(cliente || '') };

  try {
    let cookie = await cookieVigente(env, false);
    let data = await pedirListado(cookie, filtro);
    if (data._fallo || data.estadoLogin === false) {            // sesión vencida → reintento
      cookie = await cookieVigente(env, true);
      data = await pedirListado(cookie, filtro);
    }
    if (data._fallo) return { encontrado: false, motivo: 'lightdata_error' };

    const rows = data.rows || [];
    if (rows.length === 0) return { encontrado: false, motivo: 'no_esta', modo: esTracking ? 'tracking' : 'direccion' };
    // El filtro de tracking de Lightdata es "contiene", no exacto: un número
    // corto trae de más. Si hay uno idéntico al pedido, es ese.
    let row = rows[0];
    if (esTracking) {
      const exacto = rows.find((r) => String(r.tracking) === filtro.tracking_number);
      if (exacto) row = exacto;
      else if (rows.length > 1) return { encontrado: false, varios: true, candidatos: rows.slice(0, 10).map(resumenFila), total: rows.length };
    } else if (rows.length > 1) {
      return { encontrado: false, varios: true, candidatos: rows.slice(0, 10).map(resumenFila), total: rows.length };
    }
    const det = await pedirDetalle(cookie, row.did);   // info ampliada + historial (una llamada más)
    return armarEnvio(row, det);
  } catch (e) {
    return { encontrado: false, motivo: 'lightdata_error', detalle: String(e.message || e) };
  }
}

// Busca clientes de Lightdata por nombre fantasía (para el buscador del admin).
// Devuelve [{ nombre, codigo, did }]. Nunca tira error.
export async function buscarClientesLightdata(env, texto) {
  const q = String(texto || '').trim();
  if (q.length < 2) return { clientes: [] };
  const filtros = {
    codigo: '', fantasia: q, razon: '', usuariopresta: '', numero: '',
    usuarioml: '', usuarioshop: '', usuariotienda: '', usuariowoo: '',
    habilitado: '2', clienteFulfilllment: '2', num_vendedor: '',
  };
  async function pedir(cookie) {
    const body = new URLSearchParams(); body.append('cantxpagina', '15'); body.append('pagina', '1');
    for (const k in filtros) body.append('filtros[' + k + ']', filtros[k]);
    const r = await fetch(BASE + '/modules/clientes/listado/procesar_listado.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Cookie': cookie },
      body: body.toString(),
    });
    const txt = await r.text();
    if (r.status !== 200 || !txt) return { _fallo: true };
    try { return JSON.parse(txt); } catch { return { _fallo: true }; }
  }
  try {
    let cookie = await cookieVigente(env, false);
    let data = await pedir(cookie);
    if (data._fallo || data.estadoLogin === false) { cookie = await cookieVigente(env, true); data = await pedir(cookie); }
    if (data._fallo) return { clientes: [], error: true };
    const clientes = (data.rows || []).map((x) => ({
      nombre: x['cl.nombre_fantasia'] || '', codigo: x['cl.codigo'] || '', did: x['did'] || '',
    })).filter((c) => c.nombre);
    return { clientes };
  } catch (e) {
    return { clientes: [], error: true };
  }
}

// Trae TODOS los clientes de Lightdata (para emparejarlos con los del portal).
// Devuelve [{ nombre, codigo, did }]. Nunca tira error.
export async function listarClientesLightdata(env) {
  const filtros = {
    codigo: '', fantasia: '', razon: '', usuariopresta: '', numero: '',
    usuarioml: '', usuarioshop: '', usuariotienda: '', usuariowoo: '',
    habilitado: '2', clienteFulfilllment: '2', num_vendedor: '',
  };
  async function pedir(cookie) {
    const body = new URLSearchParams(); body.append('cantxpagina', '5000'); body.append('pagina', '1');
    for (const k in filtros) body.append('filtros[' + k + ']', filtros[k]);
    const r = await fetch(BASE + '/modules/clientes/listado/procesar_listado.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Cookie': cookie },
      body: body.toString(),
    });
    const txt = await r.text();
    if (r.status !== 200 || !txt) return { _fallo: true };
    try { return JSON.parse(txt); } catch { return { _fallo: true }; }
  }
  try {
    let cookie = await cookieVigente(env, false);
    let data = await pedir(cookie);
    if (data._fallo || data.estadoLogin === false) { cookie = await cookieVigente(env, true); data = await pedir(cookie); }
    if (data._fallo) return { clientes: [], error: true };
    const clientes = (data.rows || []).map((x) => ({
      nombre: x['cl.nombre_fantasia'] || '', codigo: x['cl.codigo'] || '', did: x['did'] || '',
    })).filter((c) => c.nombre);
    return { clientes };
  } catch (e) {
    return { clientes: [], error: true };
  }
}

// Detalle de un envío puntual ya identificado por su did (para "hay varios" → elegir uno).
export async function detallePorDid(env, did) {
  try {
    let cookie = await cookieVigente(env, false);
    let det2 = await pedirDetalle(cookie, did);
    if (!det2 || !det2.header) {                 // sesión vencida → reintento
      cookie = await cookieVigente(env, true);
      det2 = await pedirDetalle(cookie, did);
    }
    if (!det2 || !det2.header) return { encontrado: false, motivo: 'lightdata_error' };
    const h = det2.header;
    // Fila mínima a partir del header para reusar armarEnvio.
    const row = {
      tracking: h.tracking_number, did, estado_envio: Number(h.estado_envio),
      nombre: h.destination_receiver_name, cp: h.destination_shipping_zip_code,
      nombre_fantasia: h.nombre_fantasia, ultimaSinc: (h.ultima_sincronizacion || '').replace('T', ' '),
    };
    return armarEnvio(row, det2);
  } catch (e) {
    return { encontrado: false, motivo: 'lightdata_error', detalle: String(e.message || e) };
  }
}

// ── COBROS CONTRA ENTREGA ──────────────────────────────────
// Para la sección Cobros: los entregados de un cliente y, de cada uno, cuánto
// había que cobrar y cuándo se entregó.

const ESTADOS_ENTREGADO = ['5', '9', '16'];   // entregado, 2ª visita, punto PickUp
const POR_PAGINA = 500;
const MAX_PAGINAS = 10;

// Lightdata avisa que la sesión venció de varias formas ({estadoLogin:false},
// {estado:false, mensaje:"relogin"}…)
const sesionVencida = (d) => !d || d._fallo || d.estadoLogin === false || d.estado === false
  || /login/i.test(String(d.mensaje || ''));

// "aaaa-mm-dd" → "dd/mm/aaaa", como lo piden los filtros del panel
const fechaPanel = (iso) => iso.split('-').reverse().join('/');

// Filas entregadas de un cliente con fecha de VENTA entre desde y hasta
// ("aaaa-mm-dd"). El filtro de fecha del panel no sirve para el día de entrega:
// ese sale del historial (ver datosDeCobro). Devuelve { rows, cookie } o { error }.
// La 1ª página dice cuántas hay; las demás se piden todas juntas.
export async function entregadosDe(env, cliente, desde, hasta) {
  try {
    const filtro = {
      nombrecliente: cliente, estado: ESTADOS_ENTREGADO.join(','),
      fecha_desde: fechaPanel(desde), fecha_hasta: fechaPanel(hasta), tipo_fecha: '1',
    };
    // Desde la 2ª página `rows` puede venir como objeto en vez de lista
    const filasDe = (d) => (Array.isArray(d.rows) ? d.rows : Object.values(d.rows || {}));
    let cookie = await cookieVigente(env, false);
    let primera = await pedirListado(cookie, filtro, 1, POR_PAGINA);
    if (sesionVencida(primera)) {
      cookie = await cookieVigente(env, true);
      primera = await pedirListado(cookie, filtro, 1, POR_PAGINA);
    }
    if (sesionVencida(primera)) return { error: true };
    const rows = filasDe(primera);
    const paginas = Math.min(Number(primera.totalPaginas) || 1, MAX_PAGINAS);
    const resto = await Promise.all(Array.from({ length: paginas - 1 }, (_, i) => pedirListado(cookie, filtro, i + 2, POR_PAGINA)));
    for (const d of resto) {
      if (sesionVencida(d)) return { error: true };
      rows.push(...filasDe(d));
    }
    // Si Lightdata trajo menos de lo que dice tener (p. ej. corta el tamaño de
    // página por su cuenta), mejor avisar que dar una lista con huecos
    const total = Number(primera.cantidadRegistros);
    if (Number.isFinite(total) && rows.length < total) return { error: true, detalle: `incompleto: ${rows.length} de ${total}` };
    return { rows, cookie };
  } catch (e) {
    return { error: true, detalle: String(e.message || e) };
  }
}

// La cookie de sesión vigente (para seguir pidiendo detalles sin volver a listar)
export const cookieLightdata = (env, forzar) => cookieVigente(env, !!forzar);

// Monto a cobrar, fecha de entrega y dirección de un envío.
// El monto está en `Acobranzas` ("Total a cobrar"): `monto_total_a_cobrar`
// viene en 0 y el valor declarado no siempre está cargado.
// Devuelve null si Lightdata no contestó o el envío no tiene entrega.
export async function datosDeCobro(cookie, did) {
  const det = await pedirDetalle(cookie, did).catch(() => null);
  if (!det || !det.header) return null;
  const h = det.header;
  const cobranzas = Array.isArray(det.Acobranzas) ? det.Acobranzas : [];
  const deCobro = cobranzas.filter((c) => /cobrar/i.test(String(c.nombre || '')));
  const monto = (deCobro.length ? deCobro : cobranzas)
    .reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const entregas = (det.historial || []).filter((x) => ESTADOS_ENTREGADO.includes(String(x.estado)));
  const entrega = entregas[entregas.length - 1];
  if (!entrega || !entrega.fecha) return null;
  let direccion = String(h.destination_shipping_address_line || '').trim();
  const localidad = String(h.destination_city_name || '').trim();
  if (localidad && !direccion.toLowerCase().includes(localidad.toLowerCase())) direccion += (direccion ? ', ' : '') + localidad;
  return {
    monto: Math.round(monto),
    entregado: String(entrega.fecha),                 // "29/10/2026 20:48" (hora de Argentina)
    direccion,
    destinatario: String(h.destination_receiver_name || '').trim(),
  };
}
