// Métricas para Planet.
//
// Todos los tiempos son en HORAS CORRIDAS (reloj de pared), como se acordó:
// si una consulta entra un sábado a las 20, el reloj corre desde ese momento.
// Solo se miden las consultas que nos hacen los clientes (cliente_a_planet),
// y no entran las marcadas con excluir_metricas (la limpieza del 24/09).
//
// EXCEPCIÓN — el tiempo de respuesta POR PERSONA: ahí el reloj se pausa fuera
// del turno de cada uno (Facundo 8-17, Mario 17-23, configurable en Admin), así
// a nadie se le cuenta la noche ni las horas del turno del otro.

import { ok } from './http.js';
import { DIA_MS, HORA_MS } from './util.js';

const HORAS_DEMORADA = 48;
const OFFSET_AR = 3 * HORA_MS;   // Argentina es UTC-3 todo el año

const promedio = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
function mediana(a) {
  if (!a.length) return null;
  const o = a.slice().sort((x, y) => x - y);
  const m = Math.floor(o.length / 2);
  return Math.round(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
}
const resumen = (a) => ({ promedio: promedio(a), mediana: mediana(a), muestras: a.length });

// Milisegundos de un intervalo [a, b] (ms UTC) que caen dentro del turno diario
// de alguien (horas de Argentina). Suma día por día, así una espera que cruza la
// medianoche solo cuenta las horas del turno de cada jornada.
// Sin turno válido (desde/hasta nulos o desde>=hasta) devuelve el intervalo entero
// = horas corridas, igual que el resto de las métricas.
function dentroDeTurno(a, b, desde, hasta) {
  if (!(b > a)) return 0;
  if (desde == null || hasta == null || !(hasta > desde)) return b - a;
  const aAR = a - OFFSET_AR, bAR = b - OFFSET_AR;   // llevado a "reloj argentino"
  let total = 0;
  for (let d = Math.floor(aAR / DIA_MS); d <= Math.floor(bAR / DIA_MS); d++) {
    const ini = d * DIA_MS + desde * HORA_MS;
    const fin = d * DIA_MS + hasta * HORA_MS;
    const lo = Math.max(aAR, ini), hi = Math.min(bAR, fin);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

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
  const [rConsultas, rMensajes, rCierres, rEquipo, rExcluidas] = await db.batch([
    db.prepare(
      `SELECT c.id, c.cliente, c.tipo, c.estado, c.creado_en, c.cerrado_en, c.cierre_aprox, c.reabierta_en
       FROM consultas c WHERE ${filtro}`
    ).bind(...valores),
    db.prepare(
      `SELECT m.consulta_id, m.creado_en, m.equipo, m.autor, m.nombre
       FROM mensajes m JOIN consultas c ON c.id = m.consulta_id
       WHERE ${filtro} ORDER BY m.consulta_id, m.creado_en, m.id`
    ).bind(...valores),
    // Quién cerró cada consulta (para el tiempo de cierre por persona).
    db.prepare(
      `SELECT e.consulta_id, e.quien, e.nombre, e.cuando
       FROM eventos e JOIN consultas c ON c.id = e.consulta_id
       WHERE ${filtro} AND e.a_estado = 'Cerrado'`
    ).bind(...valores),
    db.prepare(`SELECT usuario, nombre, turno_desde, turno_hasta FROM usuarios WHERE team = 'planet'`),
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

  // Quién cerró cada consulta: el evento de cierre que coincide con la hora de
  // cierre guardada (si se reabrió y cerró varias veces, el último).
  const cierrePorConsulta = new Map();
  for (const e of rCierres.results) {
    const prev = cierrePorConsulta.get(e.consulta_id);
    if (!prev || e.cuando > prev.cuando) cierrePorConsulta.set(e.consulta_id, e);
  }

  // ── Personas del equipo (atribución por autor + turno) ─────
  const personas = new Map();
  const turnos = new Map();   // usuario → { desde, hasta, nombre }
  for (const u of rEquipo.results) turnos.set(u.usuario, { desde: u.turno_desde, hasta: u.turno_hasta, nombre: u.nombre });
  const persona = (usuario, nombre) => {
    if (!personas.has(usuario)) {
      const t = turnos.get(usuario);
      personas.set(usuario, {
        usuario, nombre: (t && t.nombre) || nombre || usuario,
        turno_desde: t ? t.desde : null, turno_hasta: t ? t.hasta : null,
        respuestas: [], cerradas: [], nuestroCerradas: [], tipos: new Map(),
      });
    }
    return personas.get(usuario);
  };
  // Que aparezcan desde el arranque los del equipo (aunque no tengan actividad).
  for (const u of rEquipo.results) persona(u.usuario, u.nombre);

  const turnoDe = (usuario) => {
    const t = turnos.get(usuario);
    return t ? [t.desde, t.hasta] : [null, null];
  };

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

  // Idas y vueltas dentro de las conversaciones.
  // Cada respuesta nuestra se le anota a quien la escribió, con el reloj recortado
  // a SU turno (si no tiene turno, en horas corridas).
  const delCliente = [];   // escribimos nosotros → contestó el cliente
  const nuestras = [];     // escribió el cliente → contestamos nosotros
  for (const lista of mensajesDe.values()) {
    for (let i = 1; i < lista.length; i++) {
      const antes = lista[i - 1], despues = lista[i];
      const t = despues.creado_en - antes.creado_en;
      if (despues.creado_en < desde || t < 0) continue;
      if (antes.equipo === 'planet' && despues.equipo === 'cliente') delCliente.push(t);
      if (antes.equipo === 'cliente' && despues.equipo === 'planet') {
        nuestras.push(t);
        const [d, h] = turnoDe(despues.autor);
        persona(despues.autor, despues.nombre).respuestas.push(dentroDeTurno(antes.creado_en, despues.creado_en, d, h));
      }
    }
    // Tipo de consulta: se lo lleva quien dio la PRIMERA respuesta de Planet.
    const consultaId = lista[0] && lista[0].consulta_id;
    const c = consultaId && todas.find((x) => x.id === consultaId);
    if (c && (c.creado_en || 0) >= desde) {
      const primera = lista.find((m) => m.equipo === 'planet');
      if (primera) {
        const pr = persona(primera.autor, primera.nombre);
        const tipo = (c.tipo || '').trim() || 'Sin tipo';
        pr.tipos.set(tipo, (pr.tipos.get(tipo) || 0) + 1);
      }
    }
  }

  // Tiempo de cierre (de inicio a cerrada): se lo lleva quien la cerró.
  // No se recorta por turno: es un lapso largo que cruza varios turnos.
  for (const c of resueltas) {
    if (!exacta(c)) continue;
    const ev = cierrePorConsulta.get(c.id);
    if (!ev || !ev.quien) continue;
    const pr = persona(ev.quien, ev.nombre);
    if (total(c) >= 0) pr.cerradas.push(total(c));
    if (nuestro(c) >= 0) pr.nuestroCerradas.push(nuestro(c));
  }

  // Tipos de consulta más frecuentes (del equipo entero)
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

  // Resumen por persona (sale ordenado: primero los que más respondieron).
  const equipoResumen = [...personas.values()]
    .map((r) => ({
      usuario: r.usuario,
      nombre: r.nombre,
      turno: r.turno_desde != null && r.turno_hasta != null ? { desde: r.turno_desde, hasta: r.turno_hasta } : null,
      respuesta: resumen(r.respuestas),
      cerradas: r.cerradas.length,
      cierre: mediana(r.cerradas),
      cierreNuestro: mediana(r.nuestroCerradas),
      tipos: [...r.tipos].map(([tipo, cantidad]) => ({ tipo, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
    }))
    .filter((r) => r.respuesta.muestras || r.cerradas || r.turno)   // con actividad o con turno puesto
    .sort((a, b) => (b.respuesta.muestras || 0) - (a.respuesta.muestras || 0) || (b.cerradas - a.cerradas));

  // Una consulta reabierta no arrastra la antigüedad vieja: el reloj vuelve a cero al reabrirse.
  const desdeCuando = (c) => Math.max(c.creado_en || 0, c.reabierta_en || 0) || ahora;
  const antiguedades = abiertas.map((c) => ahora - desdeCuando(c));

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
    equipo: equipoResumen,
    excluidas: rExcluidas.results[0]?.n || 0,
  });
}
