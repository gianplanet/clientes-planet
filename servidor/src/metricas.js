// Métricas para Planet.
//
// Todos los tiempos son en HORAS CORRIDAS (reloj de pared), como se acordó:
// si una consulta entra un sábado a las 20, el reloj corre desde ese momento.
// Solo se miden las consultas que nos hacen los clientes (cliente_a_planet),
// y no entran las marcadas con excluir_metricas (la limpieza del 24/09).

import { ok } from './http.js';
import { DIA_MS, HORA_MS } from './util.js';

const HORAS_DEMORADA = 48;

const promedio = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
function mediana(a) {
  if (!a.length) return null;
  const o = a.slice().sort((x, y) => x - y);
  const m = Math.floor(o.length / 2);
  return Math.round(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
}
const resumen = (a) => ({ promedio: promedio(a), mediana: mediana(a), muestras: a.length });

// Tiempo que estuvimos esperando al cliente dentro de una conversación:
// la suma de los tramos "escribimos nosotros → contestó el cliente".
function esperaDelCliente(mensajes) {
  let total = 0;
  for (let i = 1; i < mensajes.length; i++) {
    if (mensajes[i - 1].equipo === 'planet' && mensajes[i].equipo === 'cliente') {
      const t = mensajes[i].creado_en - mensajes[i - 1].creado_en;
      if (t > 0) total += t;
    }
  }
  return total;
}

export async function metricas(db, p) {
  const ahora = Date.now();
  const dias = Math.max(0, Number(p.dias) || 0);          // 0 = desde siempre
  const desde = dias ? ahora - dias * DIA_MS : 0;
  const cliente = p.cliente && p.cliente !== 'Todos' ? String(p.cliente) : null;

  const filtro = `c.direccion = 'cliente_a_planet' AND c.excluir_metricas = 0${cliente ? ' AND c.cliente = ?' : ''}`;
  const valores = cliente ? [cliente] : [];
  const [rConsultas, rMensajes, rExcluidas] = await db.batch([
    db.prepare(
      `SELECT c.id, c.cliente, c.tipo, c.estado, c.creado_en, c.cerrado_en, c.cierre_aprox
       FROM consultas c WHERE ${filtro}`
    ).bind(...valores),
    db.prepare(
      `SELECT m.consulta_id, m.creado_en, m.equipo
       FROM mensajes m JOIN consultas c ON c.id = m.consulta_id
       WHERE ${filtro} ORDER BY m.consulta_id, m.creado_en, m.id`
    ).bind(...valores),
    db.prepare(
      `SELECT COUNT(*) AS n FROM consultas c
       WHERE c.excluir_metricas = 1 AND c.direccion = 'cliente_a_planet'${cliente ? ' AND c.cliente = ?' : ''}`
    ).bind(...valores),
  ]);
  const todas = rConsultas.results;

  const mensajesDe = new Map();
  for (const m of rMensajes.results) {
    if (!mensajesDe.has(m.consulta_id)) mensajesDe.set(m.consulta_id, []);
    mensajesDe.get(m.consulta_id).push(m);
  }
  const msgs = (id) => mensajesDe.get(id) || [];

  const nuevas = todas.filter((c) => (c.creado_en || 0) >= desde);
  const resueltas = todas.filter((c) => c.cerrado_en && c.cerrado_en >= desde);
  const abiertas = todas.filter((c) => c.estado !== 'Cerrado');

  // Tiempo de resolución: solo de las que tienen hora de cierre exacta
  const exacta = (c) => !c.cierre_aprox && c.creado_en;
  const exactas = resueltas.filter(exacta);
  const total = (c) => c.cerrado_en - c.creado_en;
  const nuestro = (c) => total(c) - esperaDelCliente(msgs(c.id));
  const tiemposRes = exactas.map(total).filter((t) => t >= 0);
  const tiemposNuestros = exactas.map(nuestro).filter((t) => t >= 0);

  // Primera respuesta nuestra a cada consulta nueva
  const primeras = [];
  let sinResponder = 0;
  for (const c of nuevas) {
    const primera = msgs(c.id).find((m) => m.equipo === 'planet' && m.creado_en >= (c.creado_en || 0));
    if (primera) primeras.push(primera.creado_en - (c.creado_en || primera.creado_en));
    else if (c.estado !== 'Cerrado') sinResponder++;
  }

  // Idas y vueltas dentro de las conversaciones
  const delCliente = [];   // escribimos nosotros → contestó el cliente
  const nuestras = [];     // escribió el cliente → contestamos nosotros
  for (const lista of mensajesDe.values()) {
    for (let i = 1; i < lista.length; i++) {
      const antes = lista[i - 1], despues = lista[i];
      const t = despues.creado_en - antes.creado_en;
      if (despues.creado_en < desde || t < 0) continue;
      if (antes.equipo === 'planet' && despues.equipo === 'cliente') delCliente.push(t);
      if (antes.equipo === 'cliente' && despues.equipo === 'planet') nuestras.push(t);
    }
  }

  // Tipos de consulta más frecuentes
  const cuentaTipos = new Map();
  for (const c of nuevas) {
    const t = (c.tipo || '').trim() || 'Sin tipo';
    cuentaTipos.set(t, (cuentaTipos.get(t) || 0) + 1);
  }
  const tipos = [...cuentaTipos].map(([tipo, cantidad]) => ({ tipo, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // Resumen por cliente
  const porCliente = new Map();
  const fila = (n) => {
    if (!porCliente.has(n)) porCliente.set(n, { cliente: n, nuevas: 0, resueltas: 0, tiempos: [], propios: [] });
    return porCliente.get(n);
  };
  for (const c of nuevas) fila(c.cliente).nuevas++;
  for (const c of resueltas) {
    const r = fila(c.cliente);
    r.resueltas++;
    if (exacta(c)) {
      r.tiempos.push(total(c));
      if (nuestro(c) >= 0) r.propios.push(nuestro(c));
    }
  }
  const clientes = [...porCliente.values()]
    .map((r) => ({ cliente: r.cliente, nuevas: r.nuevas, resueltas: r.resueltas, resolucion: mediana(r.tiempos), nuestro: mediana(r.propios) }))
    .sort((a, b) => b.nuevas - a.nuevas);

  const antiguedades = abiertas.map((c) => ahora - (c.creado_en || ahora));

  return ok({
    dias,
    cliente: cliente || 'Todos',
    generado: ahora,
    nuevas: nuevas.length,
    resueltas: resueltas.length,
    resolucion: { ...resumen(tiemposRes), aproximadas: resueltas.length - exactas.length },
    primeraRespuesta: { ...resumen(primeras), sinResponder },
    nuestrasRespuestas: resumen(nuestras),
    tiempoNuestro: resumen(tiemposNuestros),
    respuestaCliente: resumen(delCliente),
    abiertas: {
      cantidad: abiertas.length,
      antiguedadPromedio: promedio(antiguedades),
      antiguedadMaxima: antiguedades.length ? Math.max(...antiguedades) : null,
      masDe48h: antiguedades.filter((t) => t > HORAS_DEMORADA * HORA_MS).length,
    },
    tipos,
    clientes,
    excluidas: rExcluidas.results[0]?.n || 0,
  });
}
