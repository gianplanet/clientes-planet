// Cobros contra entrega: los entregados de los clientes que cobran en la
// puerta (traídos de Lightdata) y cómo pagó cada uno (efectivo o transferencia).
//
// Lo de Lightdata se guarda una sola vez por envío: al traer, solo se pide el
// detalle de los que todavía no están. El plan gratis de Workers deja unos 50
// pedidos afuera por llamada, así que se trae de a tandas y la pantalla vuelve
// a pedir mientras falten. El listado se pide una vez por carga: lo que queda
// pendiente se guarda un rato en KV y las tandas siguientes lo toman de ahí.

import { ok, err } from './http.js';
import { texto, idValido, esVerdadero, DIA_MS } from './util.js';
import { entregadosDe, datosDeCobro, cookieLightdata } from './lightdata.js';

// Clientes con cobro, tal cual se llaman en Lightdata
export const CLIENTES_COBRO = ['HAPPE', 'Tienda Directa.ar'];
// 'debe' = se revisó y quedó sin pagar (o el chofer no lo rindió): se arrastra a los días siguientes
// 'mixto' = parte en efectivo y parte por transferencia (pago_efectivo + pago_transferencia);
//           si no llegan al monto, lo que falta cuenta como debe y también se arrastra
const FORMAS = ['efectivo', 'transferencia', 'debe', 'mixto'];
// Lo que sigue pendiente: sin marcar, debe, o mixto que no llega al monto
const SQL_PENDIENTE = `(c.forma IN ('', 'debe') OR (c.forma = 'mixto' AND c.pago_efectivo + c.pago_transferencia < c.monto))`;
const ARRASTRE_POR_DEFECTO_DIAS = 31;   // si no está configurado COBROS_DESDE
const VENTANA_DIAS = 30;          // un envío puede entregarse hasta un mes después de la venta
const DETALLES_POR_TANDA = 40;    // + las páginas del listado y el login, por debajo de los 50 pedidos
const PENDIENTES_TTL_S = 600;     // lo que quedó por traer, entre una tanda y la siguiente
const MAX_RANGO_DIAS = 62;

const diaValido = (v) => {
  const s = texto(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z')) ? s : '';
};
const sumarDias = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
// "29/10/2026 20:48" → "2026-10-29"
const diaDeFechaAR = (s) => {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

function rango(p) {
  const desde = diaValido(p.desde), hasta = diaValido(p.hasta);
  if (!desde || !hasta) return { error: 'Faltan las fechas' };
  if (desde > hasta) return { error: 'La fecha "desde" es posterior a "hasta"' };
  if ((Date.parse(hasta) - Date.parse(desde)) / DIA_MS > MAX_RANGO_DIAS) return { error: 'Elegí un rango de hasta dos meses' };
  return { desde, hasta };
}

// Comienzo de un día de Argentina (UTC-3) en ms
const msDia = (dia) => Date.parse(dia + 'T00:00:00-03:00');

// ── LEER ───────────────────────────────────────────────────
// Los cobros del rango (la plata cuenta en el día de ENTREGA), y además:
//  · pendientes: de días anteriores, sin marcar o que deben. Se arrastran hasta
//    que se marquen, pero solo desde COBROS_DESDE (el día que se empezó a usar
//    el portal: lo de antes se llevó en papel y no tiene marcas).
//  · cobradosDespues: de días anteriores que se marcaron como pagados dentro del
//    rango. Se muestran para saber qué entró, pero suman en su día de entrega.
export async function listarCobros(db, env, p) {
  const r = rango(p);
  if (r.error) return err(r.error);
  const arrastreDesde = diaValido(env.COBROS_DESDE) || sumarDias(r.desde, -ARRASTRE_POR_DEFECTO_DIAS);
  const columnas = `c.did, c.cliente, c.tracking, c.destinatario, c.direccion, c.chofer, c.monto, c.entregado, c.dia,
            c.forma, c.pago_efectivo, c.pago_transferencia, c.marcado_por, c.marcado_en,
            COALESCE(u.nombre, c.marcado_por) AS marcado_nombre
     FROM cobros c LEFT JOIN usuarios u ON lower(u.usuario) = lower(c.marcado_por)`;
  const orden = 'ORDER BY c.chofer, c.dia, c.entregado';
  const [rango_, pend, despues] = await db.batch([
    db.prepare(`SELECT ${columnas} WHERE c.dia BETWEEN ? AND ? ${orden}`).bind(r.desde, r.hasta),
    db.prepare(`SELECT ${columnas} WHERE c.dia < ? AND c.dia >= ? AND ${SQL_PENDIENTE} ${orden}`)
      .bind(r.desde, arrastreDesde),
    db.prepare(`SELECT ${columnas} WHERE c.dia < ? AND c.forma IN ('efectivo', 'transferencia', 'mixto') AND NOT ${SQL_PENDIENTE}
                AND c.marcado_en >= ? AND c.marcado_en < ? ${orden}`)
      .bind(r.desde, msDia(r.desde), msDia(r.hasta) + DIA_MS),
  ]);
  return ok({
    cobros: rango_.results, pendientes: pend.results, cobradosDespues: despues.results,
    arrastreDesde, clientes: CLIENTES_COBRO,
  });
}

// ── TRAER DE LIGHTDATA ─────────────────────────────────────
// Los entregados de los clientes con cobro que todavía no están guardados.
// Devuelve [{ did, cliente, tracking, chofer }], o null si Lightdata no contestó.
async function pendientesDeLightdata(db, env, r) {
  const filas = [];
  for (const cliente of CLIENTES_COBRO) {
    const res = await entregadosDe(env, cliente, sumarDias(r.desde, -VENTANA_DIAS), r.hasta);
    if (res.error) return null;
    for (const row of res.rows) {
      if (idValido(row.did)) filas.push({ did: Number(row.did), cliente, tracking: texto(row.tracking, 60), chofer: texto(row.namecadete, 150) });
    }
  }
  // Los que ya están guardados no se vuelven a pedir (D1: hasta 100 valores por consulta)
  const guardados = new Set();
  for (let i = 0; i < filas.length; i += 90) {
    const parte = filas.slice(i, i + 90).map((f) => f.did);
    const { results } = await db.prepare(`SELECT did FROM cobros WHERE did IN (${parte.map(() => '?').join(',')})`)
      .bind(...parte).all();
    for (const x of results) guardados.add(Number(x.did));
  }
  return { pendientes: filas.filter((f) => !guardados.has(f.did)), revisados: filas.length };
}

// Una tanda: guarda hasta DETALLES_POR_TANDA de los que faltan. Con `seguir`,
// toma lo pendiente de la tanda anterior en vez de volver a listar.
// Devuelve cuántos guardó y cuántos quedan.
export async function traerCobros(db, env, p) {
  const r = rango(p);
  if (r.error) return err(r.error);
  const kv = env.IMAGENES;
  const clave = `cobros:pendientes:${r.desde}:${r.hasta}`;

  let lista = esVerdadero(p.seguir) && kv ? await kv.get(clave, 'json') : null;
  let revisados = null;
  if (!Array.isArray(lista)) {
    const res = await pendientesDeLightdata(db, env, r);
    if (!res) return err('No se pudo leer Lightdata. Probá de nuevo en un rato.');
    lista = res.pendientes;
    revisados = res.revisados;
  }

  const tanda = lista.slice(0, DETALLES_POR_TANDA);
  const resto = lista.slice(DETALLES_POR_TANDA);
  let cookie = await cookieLightdata(env, false);
  let datos = await Promise.all(tanda.map((f) => datosDeCobro(cookie, f.did)));
  if (tanda.length && datos.every((d) => !d)) {      // ninguno contestó: seguro venció la sesión
    cookie = await cookieLightdata(env, true);
    datos = await Promise.all(tanda.map((f) => datosDeCobro(cookie, f.did)));
  }

  const ahora = Date.now();
  const ops = [];
  tanda.forEach((f, i) => {
    const d = datos[i];
    const dia = d && diaDeFechaAR(d.entregado);
    if (!dia) return;
    ops.push(db.prepare(
      `INSERT OR IGNORE INTO cobros (did, cliente, tracking, destinatario, direccion, chofer, monto, entregado, dia, traido_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(f.did, f.cliente, f.tracking, texto(d.destinatario, 150), texto(d.direccion, 300), f.chofer,
           d.monto, texto(d.entregado, 20), dia, ahora));
  });
  if (ops.length) await db.batch(ops);
  if (kv) {
    if (resto.length) await kv.put(clave, JSON.stringify(resto), { expirationTtl: PENDIENTES_TTL_S });
    else await kv.delete(clave);
  }
  return ok({
    guardados: ops.length,
    sinDatos: tanda.length - ops.length,   // Lightdata no contestó: se reintentan en la próxima carga
    faltan: resto.length,
    revisados,
  });
}

// ── MARCAR LA FORMA DE PAGO ────────────────────────────────
// Monto en pesos: entero >= 0, o null si no es un número
const pesos = (v) => {
  const n = Math.round(Number(v === '' || v === null || v === undefined ? 0 : v));
  return Number.isFinite(n) && n >= 0 && n <= 1e10 ? n : null;
};
// Cómo queda escrito en el historial: "mixto:20000+10000" o la forma sola
const textoMarca = (forma, ef, tr) => (forma === 'mixto' ? `mixto:${ef}+${tr}` : forma);

export async function marcarCobro(db, me, p) {
  const did = idValido(p.did);
  if (!did) return err('Falta el envío');
  let forma = p.forma ? String(p.forma) : '';
  if (forma && !FORMAS.includes(forma)) return err('La forma de pago tiene que ser efectivo, transferencia, mixto o debe');
  const actual = await db.prepare('SELECT forma, monto, pago_efectivo, pago_transferencia FROM cobros WHERE did = ?').bind(did).first();
  if (!actual) return err('Ese cobro no está cargado');

  let ef = 0, tr = 0;
  if (forma === 'mixto') {
    ef = pesos(p.efectivo); tr = pesos(p.transferencia);
    if (ef === null || tr === null) return err('Los montos tienen que ser números');
    if (ef + tr === 0) return err('Poné cuánto pagó en efectivo y/o por transferencia');
    if (ef + tr > actual.monto) return err(`Entre efectivo y transferencia se pasan del total ($${actual.monto.toLocaleString('es-AR')})`);
    // Todo de una sola forma: queda como esa forma
    if (ef + tr === actual.monto && tr === 0) { forma = 'efectivo'; ef = 0; }
    else if (ef + tr === actual.monto && ef === 0) { forma = 'transferencia'; tr = 0; }
  }
  const antes = textoMarca(actual.forma, actual.pago_efectivo, actual.pago_transferencia);
  const despues = textoMarca(forma, ef, tr);
  if (antes === despues) return ok();
  const ahora = Date.now();
  await db.batch([
    db.prepare('UPDATE cobros SET forma = ?, pago_efectivo = ?, pago_transferencia = ?, marcado_por = ?, marcado_en = ? WHERE did = ?')
      .bind(forma, ef, tr, forma ? me.usuario : '', forma ? ahora : 0, did),
    db.prepare('INSERT INTO cobros_cambios (did, antes, despues, usuario, cuando) VALUES (?, ?, ?, ?, ?)')
      .bind(did, antes, despues, me.usuario, ahora),
  ]);
  return ok({ forma, pago_efectivo: ef, pago_transferencia: tr, marcado_por: me.usuario, marcado_nombre: me.nombre, marcado_en: ahora });
}
