/**
 * Portal Clientes Planet — servidor en Cloudflare Workers
 *
 * Reemplaza al Apps Script de Google, hablando exactamente el mismo idioma:
 * las mismas 16 acciones, los mismos parámetros y las mismas respuestas.
 * Por eso migrar el portal es cambiar una sola línea (la constante API).
 */

// ── CONSTANTES ─────────────────────────────────────────────
const SESSION_DAYS = 30;
const NOTA_COLORES = ['amarillo', 'rosa', 'verde', 'celeste', 'violeta'];
const NOTA_MAX_CHARS = 1000;
const PBKDF2_ITERACIONES = 100000;

const ADMIN_ONLY = ['usuarios', 'crear_usuario', 'editar_usuario', 'eliminar_usuario',
                    'crear_cliente', 'editar_cliente', 'eliminar_cliente', 'init'];
const PLANET_ONLY = ['cambiar_estado', 'clientes', 'notas', 'nota_guardar', 'nota_borrar', 'metricas'];

// ── RESPUESTAS ─────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function responder(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    // JSONP: el portal lo usa como respaldo cuando fetch falla
    return new Response(`${callback}(${json})`, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...CORS },
    });
  }
  return new Response(json, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

const ok = (data) => ({ ok: true, ...data });
const err = (msg) => ({ ok: false, error: msg });
const authErr = () => ({ ok: false, auth: false, error: 'Sesión vencida, ingresá de nuevo' });

// ── FECHAS (horario de Argentina, igual que antes) ─────────
function ahoraAR(soloFecha = false) {
  const f = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => f.find((p) => p.type === t).value;
  const fecha = `${g('day')}/${g('month')}/${g('year')}`;
  return soloFecha ? fecha : `${fecha} ${g('hour')}:${g('minute')}`;
}

// Pasa "23/09/2026 14:05" (hora de Argentina) a milisegundos.
// Lo usamos para medir tiempos sin depender del texto.
function msDeFechaAR(texto) {
  const m = String(texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  // Argentina es UTC-3 todo el año
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0) + 3, +(m[5] || 0));
}

// El tipo de problema es la última parte del asunto: "152089 · NUME · No entregado"
function tipoDeAsunto(asunto) {
  const partes = String(asunto || '').split(' · ');
  return partes.length > 1 ? partes[partes.length - 1].trim() : '';
}

// ── MÉTRICAS: cada cambio queda anotado ────────────────────
// Sin esto no se puede saber cuánto tardó una consulta en resolverse,
// ni separar el tiempo nuestro del tiempo que esperamos al cliente.
function anotarEvento(db, { consultaId, evento, de = '', a = '', me }) {
  return db.prepare(
    `INSERT INTO eventos (consulta_id, evento, de_estado, a_estado, quien, nombre, equipo, cuando)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(consultaId, evento, de || '', a || '', me.usuario, me.nombre, me.team || '', Date.now());
}

// ── CONTRASEÑAS ────────────────────────────────────────────
// Antes se guardaban en texto plano en la planilla. Ahora se guarda
// solo un resumen irreversible: ni nosotros podemos leer la original.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derivar(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERACIONES, hash: 'SHA-256' },
    key, 256
  );
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(password, salt);
  return `pbkdf2$${PBKDF2_ITERACIONES}$${b64(salt)}$${b64(hash)}`;
}

async function verificarPassword(password, guardado) {
  if (!guardado || !guardado.startsWith('pbkdf2$')) return false;
  const [, iter, saltB64, hashB64] = guardado.split('$');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const calculado = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: deB64(saltB64), iterations: Number(iter), hash: 'SHA-256' },
    key, 256
  );
  // Comparación de tiempo constante: no revela cuántos caracteres coinciden
  const a = new Uint8Array(calculado);
  const b = deB64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── SESIONES ───────────────────────────────────────────────
async function crearSesion(db, usuario) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const expira = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.prepare('INSERT INTO sesiones (token, usuario, expira) VALUES (?, ?, ?)')
    .bind(token, usuario, expira).run();
  return token;
}

async function borrarSesion(db, token) {
  if (token) await db.prepare('DELETE FROM sesiones WHERE token = ?').bind(token).run();
}

// El usuario se lee siempre de la base, para que un cambio de rol o una baja apliquen al instante
async function usuarioDeSesion(db, token) {
  if (!token) return null;
  const fila = await db.prepare(
    `SELECT u.* FROM sesiones s
     JOIN usuarios u ON lower(u.usuario) = lower(s.usuario)
     WHERE s.token = ? AND s.expira > ?`
  ).bind(token, Date.now()).first();
  if (!fila) { await borrarSesion(db, token); return null; }
  return fila;
}

const esPlanet = (u) => u && u.team === 'planet';
const esAdmin = (u) => esPlanet(u) && u.role === 'admin';

// ── UTILIDADES ─────────────────────────────────────────────
const esVerdadero = (v) => v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';

// Acepta dos formatos:
//  - URL completa  → imagen nueva, guardada en Cloudflare
//  - id de Drive   → imagen vieja, de cuando el backend era Apps Script
function imagenesValidas(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((u) => typeof u === 'string' && (/^https:\/\//.test(u) || /^[\w-]{20,60}$/.test(u)))
    .slice(0, 10);
}

// Arma la lista de consultas con sus mensajes, igual que la devolvía Apps Script
async function listarConsultas(db, me, p) {
  const filtro = esPlanet(me) ? (p.cliente || null) : me.cliente;
  const sql = filtro
    ? 'SELECT * FROM consultas WHERE cliente = ? ORDER BY id DESC'
    : 'SELECT * FROM consultas ORDER BY id DESC';
  const stmt = filtro ? db.prepare(sql).bind(filtro) : db.prepare(sql);
  const { results: consultas } = await stmt.all();
  if (!consultas.length) return [];

  const ids = consultas.map((c) => c.id);
  const { results: msgs } = await db.prepare(
    `SELECT consulta_id, autor, nombre, fecha, texto, imagenes
     FROM mensajes WHERE consulta_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
  ).bind(...ids).all();

  const porConsulta = new Map();
  for (const m of msgs) {
    const msg = { autor: m.autor, nombre: m.nombre, fecha: m.fecha, texto: m.texto };
    if (m.imagenes) {
      try { const i = JSON.parse(m.imagenes); if (i.length) msg.imagenes = i; } catch {}
    }
    if (!porConsulta.has(m.consulta_id)) porConsulta.set(m.consulta_id, []);
    porConsulta.get(m.consulta_id).push(msg);
  }

  return consultas.map((c) => ({
    id: c.id, fecha: c.fecha, asunto: c.asunto, cliente: c.cliente,
    direccion: c.direccion, estado: c.estado, creado_por: c.creado_por,
    nombre_creador: c.nombre_creador, atendido_por: c.atendido_por || '',
    tipo: c.tipo || tipoDeAsunto(c.asunto),
    creado_en: c.creado_en || msDeFechaAR(c.fecha),
    cerrado_en: c.cerrado_en || null,
    cierre_aprox: c.cierre_aprox ? 1 : 0,
    mensajes: porConsulta.get(c.id) || [],
  }));
}

// Marca del último cambio visible para este usuario. Un cliente solo "ve"
// los cambios de su empresa. Se usa igual al cargar y al preguntar por
// novedades, para que las dos cuentas den lo mismo.
async function ultimoCambio(db, me) {
  const fila = esPlanet(me)
    ? await db.prepare('SELECT MAX(actualizado) u FROM consultas').first()
    : await db.prepare('SELECT MAX(actualizado) u FROM consultas WHERE cliente = ?').bind(me.cliente).first();
  return fila?.u || 0;
}

async function listarNotas(db, me) {
  const { results } = await db.prepare(
    'SELECT * FROM notas WHERE lower(autor) = lower(?) ORDER BY id'
  ).bind(me.usuario).all();
  return results.map((n) => ({
    id: n.id,
    texto: String(n.texto || ''),
    color: NOTA_COLORES.includes(n.color) ? n.color : 'amarillo',
    pin: esVerdadero(n.pin),
    min: esVerdadero(n.min),
    x: n.x === null ? null : Number(n.x),
    y: n.y === null ? null : Number(n.y),
    fecha: n.fecha,
    actualizado: n.actualizado || '',
  }));
}

// ── ACCIONES ───────────────────────────────────────────────
// ── PREPARAR LA BASE PARA LAS MÉTRICAS ─────────────────────
// Agrega las columnas nuevas, crea la tabla de eventos y completa lo que se
// puede de las consultas que ya existían. Corre sola la primera vez y queda
// marcada como hecha. Volver a correrla no rompe nada: todo es "si no existe".
const MARCA_METRICAS = 'migracion_metricas_v1';
let metricasListas = false;   // por isolate, para no leer KV en cada pedido

async function prepararMetricas(env) {
  if (metricasListas) return null;
  const db = env.DB;
  if (env.IMAGENES && (await env.IMAGENES.get(MARCA_METRICAS))) {
    metricasListas = true;
    return null;
  }

  const columnas = async (tabla) => {
    const { results } = await db.prepare(`PRAGMA table_info(${tabla})`).all();
    return results.map((c) => c.name);
  };

  const agregadas = [];
  for (const [tabla, col, tipoSql] of [
    ['consultas', 'tipo', "TEXT NOT NULL DEFAULT ''"],
    ['consultas', 'creado_en', 'INTEGER NOT NULL DEFAULT 0'],
    ['consultas', 'cerrado_en', 'INTEGER'],
    ['consultas', 'cierre_aprox', 'INTEGER NOT NULL DEFAULT 0'],
    ['mensajes', 'creado_en', 'INTEGER NOT NULL DEFAULT 0'],
    ['mensajes', 'equipo', "TEXT NOT NULL DEFAULT ''"],
  ]) {
    if (!(await columnas(tabla)).includes(col)) {
      await db.prepare(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipoSql}`).run();
      agregadas.push(`${tabla}.${col}`);
    }
  }

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS eventos (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       consulta_id INTEGER NOT NULL,
       evento      TEXT NOT NULL,
       de_estado   TEXT NOT NULL DEFAULT '',
       a_estado    TEXT NOT NULL DEFAULT '',
       quien       TEXT NOT NULL DEFAULT '',
       nombre      TEXT NOT NULL DEFAULT '',
       equipo      TEXT NOT NULL DEFAULT '',
       cuando      INTEGER NOT NULL
     )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_eventos_consulta ON eventos(consulta_id, cuando)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_eventos_cuando ON eventos(cuando)').run();

  // Completar lo que se pueda de las consultas viejas (solo columnas nuevas)
  const { results: viejas } = await db.prepare(
    'SELECT id, fecha, asunto, estado, actualizado, tipo, creado_en FROM consultas'
  ).all();
  const arreglos = [];
  for (const c of viejas) {
    // De las cerradas viejas no sabemos el momento exacto del cierre: usamos el
    // último cambio como aproximación y lo dejamos marcado como aproximado.
    const cerrado = c.estado === 'Cerrado' ? (c.actualizado || null) : null;
    arreglos.push(
      db.prepare('UPDATE consultas SET tipo = ?, creado_en = ?, cerrado_en = ?, cierre_aprox = ? WHERE id = ?')
        .bind(c.tipo || tipoDeAsunto(c.asunto), c.creado_en || msDeFechaAR(c.fecha), cerrado, cerrado ? 1 : 0, c.id)
    );
  }

  const { results: msgs } = await db.prepare(
    `SELECT m.id, m.fecha, COALESCE(u.team, '') AS team
     FROM mensajes m LEFT JOIN usuarios u ON u.usuario = m.autor
     WHERE m.creado_en = 0 OR m.equipo = ''`
  ).all();
  for (const m of msgs) {
    arreglos.push(
      db.prepare('UPDATE mensajes SET creado_en = ?, equipo = ? WHERE id = ?')
        .bind(msDeFechaAR(m.fecha), m.team || '', m.id)
    );
  }

  for (let k = 0; k < arreglos.length; k += 50) await db.batch(arreglos.slice(k, k + 50));

  if (env.IMAGENES) await env.IMAGENES.put(MARCA_METRICAS, String(Date.now()));
  metricasListas = true;
  return { agregadas, consultas: viejas.length, mensajes: msgs.length };
}

async function manejar(action, p, env, origen) {
  const db = env.DB;

  // Todo salvo login exige sesión válida
  let me = null;
  if (action !== 'login') {
    me = await usuarioDeSesion(db, p.token);
    if (!me) return authErr();
    if (ADMIN_ONLY.includes(action) && !esAdmin(me)) return err('No tenés permiso para esta acción');
    if (PLANET_ONLY.includes(action) && !esPlanet(me)) return err('No tenés permiso para esta acción');
  }

  switch (action) {
    // ── LOGIN ──
    case 'login': {
      const usuario = (p.usuario || '').trim().toLowerCase();
      const password = (p.password || '').trim();
      if (!usuario || !password) return err('Faltan credenciales');

      const user = await db.prepare('SELECT * FROM usuarios WHERE lower(usuario) = ?')
        .bind(usuario).first();
      if (!user || !(await verificarPassword(password, user.password_hash))) {
        return err('Usuario o contraseña incorrectos');
      }

      await db.prepare('DELETE FROM sesiones WHERE expira < ?').bind(Date.now()).run();
      const token = await crearSesion(db, String(user.usuario).toLowerCase());
      return ok({
        token,
        consultas: await listarConsultas(db, user, {}),
        ultimo: await ultimoCambio(db, user),
        notas: esPlanet(user) ? await listarNotas(db, user) : undefined,
        user: {
          usuario: user.usuario, nombre: user.nombre, team: user.team,
          cliente: user.cliente, role: user.role,
        },
      });
    }

    case 'logout':
      await borrarSesion(db, p.token);
      return ok({});

    // ── CONSULTAS ──
    case 'consultas': {
      const res = ok({
        consultas: await listarConsultas(db, me, p),
        ultimo: await ultimoCambio(db, me),
      });
      if (esPlanet(me)) res.notas = await listarNotas(db, me);
      return res;
    }

    // Pregunta barata que el portal hace cada 30 s: devuelve solo la marca
    // del último cambio. Lee una fila (va por índice), no las 97 consultas
    // con sus 225 mensajes. Recién si la marca cambió, el portal pide todo.
    case 'novedades':
      return ok({ ultimo: await ultimoCambio(db, me) });


    // ── MÉTRICAS ──
    // Todos los tiempos son en HORAS CORRIDAS (reloj de pared), como se acordó:
    // si una consulta entra un sábado a las 20, el reloj corre desde ese momento.
    case 'metricas': {
      const dias = Math.max(0, Number(p.dias) || 0);          // 0 = desde siempre
      const desde = dias ? Date.now() - dias * 86400000 : 0;
      const cliente = p.cliente && p.cliente !== 'Todos' ? p.cliente : null;

      // Solo las consultas que nos hacen los clientes (las que enviamos nosotros
      // se miden distinto y no entran acá)
      const sql = `SELECT id, cliente, tipo, asunto, estado, creado_en, cerrado_en, cierre_aprox
                   FROM consultas WHERE direccion = 'cliente_a_planet'${cliente ? ' AND cliente = ?' : ''}`;
      const { results: todas } = await (cliente ? db.prepare(sql).bind(cliente) : db.prepare(sql)).all();
      const sqlMsgs = `SELECT m.consulta_id, m.creado_en, m.equipo
         FROM mensajes m JOIN consultas c ON c.id = m.consulta_id
         WHERE c.direccion = 'cliente_a_planet'${cliente ? ' AND c.cliente = ?' : ''}
         ORDER BY m.consulta_id, m.creado_en, m.id`;
      const { results: msgs } = await (cliente ? db.prepare(sqlMsgs).bind(cliente) : db.prepare(sqlMsgs)).all();

      const porConsulta = new Map();
      for (const m of msgs) {
        if (!porConsulta.has(m.consulta_id)) porConsulta.set(m.consulta_id, []);
        porConsulta.get(m.consulta_id).push(m);
      }

      const promedio = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
      const mediana = (a) => {
        if (!a.length) return null;
        const o = a.slice().sort((x, y) => x - y);
        const m = Math.floor(o.length / 2);
        return Math.round(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2);
      };

      const nuevas = todas.filter((c) => (c.creado_en || 0) >= desde);
      const resueltas = todas.filter((c) => c.cerrado_en && c.cerrado_en >= desde);
      const abiertas = todas.filter((c) => c.estado !== 'Cerrado');
      const ahora = Date.now();

      // Tiempo de resolución: solo de las que tienen cierre exacto
      const exactas = resueltas.filter((c) => !c.cierre_aprox && c.creado_en);
      const tiemposRes = exactas.map((c) => c.cerrado_en - c.creado_en).filter((t) => t >= 0);

      // Primera respuesta nuestra y respuesta del cliente
      const primeras = [];
      const delCliente = [];
      const nuestras = [];
      let sinResponder = 0;
      for (const c of nuevas) {
        const lista = porConsulta.get(c.id) || [];
        const nuestra = lista.find((m) => m.equipo === 'planet' && m.creado_en >= (c.creado_en || 0));
        if (nuestra) primeras.push(nuestra.creado_en - (c.creado_en || nuestra.creado_en));
        else if (c.estado !== 'Cerrado') sinResponder++;
      }
      for (const [, lista] of porConsulta) {
        for (let i = 1; i < lista.length; i++) {
          const antes = lista[i - 1], ahoraMsg = lista[i];
          if (ahoraMsg.creado_en < desde) continue;
          const t = ahoraMsg.creado_en - antes.creado_en;
          if (t < 0) continue;
          // Nosotros escribimos y después contestó el cliente
          if (antes.equipo === 'planet' && ahoraMsg.equipo === 'cliente') delCliente.push(t);
          // El cliente escribió y después contestamos nosotros
          if (antes.equipo === 'cliente' && ahoraMsg.equipo === 'planet') nuestras.push(t);
        }
      }

      // Tiempo que nos llevó a NOSOTROS cerrar la consulta: el tiempo total
      // menos todo lo que estuvimos esperando una respuesta del cliente.
      const esperaDelCliente = (id) => {
        const lista = porConsulta.get(id) || [];
        let total = 0;
        for (let i = 1; i < lista.length; i++) {
          if (lista[i - 1].equipo === 'planet' && lista[i].equipo === 'cliente') {
            const t = lista[i].creado_en - lista[i - 1].creado_en;
            if (t > 0) total += t;
          }
        }
        return total;
      };
      const tiemposNuestros = exactas
        .map((c) => (c.cerrado_en - c.creado_en) - esperaDelCliente(c.id))
        .filter((t) => t >= 0);

      // Tipos de consulta más frecuentes
      const cuentaTipos = new Map();
      for (const c of nuevas) {
        const t = (c.tipo || 'Sin tipo').trim() || 'Sin tipo';
        cuentaTipos.set(t, (cuentaTipos.get(t) || 0) + 1);
      }
      const tipos = [...cuentaTipos.entries()]
        .map(([tipo, cantidad]) => ({ tipo, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);

      // Resumen por cliente
      const porCliente = new Map();
      for (const c of nuevas) {
        const r = porCliente.get(c.cliente) || { cliente: c.cliente, nuevas: 0, resueltas: 0, tiempos: [], propios: [] };
        r.nuevas++;
        porCliente.set(c.cliente, r);
      }
      for (const c of resueltas) {
        const r = porCliente.get(c.cliente) || { cliente: c.cliente, nuevas: 0, resueltas: 0, tiempos: [], propios: [] };
        r.resueltas++;
        if (!c.cierre_aprox && c.creado_en) {
          r.tiempos.push(c.cerrado_en - c.creado_en);
          const propio = (c.cerrado_en - c.creado_en) - esperaDelCliente(c.id);
          if (propio >= 0) r.propios.push(propio);
        }
        porCliente.set(c.cliente, r);
      }
      const clientes = [...porCliente.values()]
        .map((r) => ({
          cliente: r.cliente, nuevas: r.nuevas, resueltas: r.resueltas,
          resolucion: mediana(r.tiempos), nuestro: mediana(r.propios || []),
        }))
        .sort((a, b) => b.nuevas - a.nuevas);

      const antiguedades = abiertas.map((c) => ahora - (c.creado_en || ahora));

      return ok({
        dias,
        cliente: cliente || 'Todos',
        generado: ahora,
        nuevas: nuevas.length,
        resueltas: resueltas.length,
        resolucion: { promedio: promedio(tiemposRes), mediana: mediana(tiemposRes), muestras: tiemposRes.length, aproximadas: resueltas.length - exactas.length },
        primeraRespuesta: { promedio: promedio(primeras), mediana: mediana(primeras), muestras: primeras.length, sinResponder },
        nuestrasRespuestas: { promedio: promedio(nuestras), mediana: mediana(nuestras), muestras: nuestras.length },
        tiempoNuestro: { promedio: promedio(tiemposNuestros), mediana: mediana(tiemposNuestros), muestras: tiemposNuestros.length },
        respuestaCliente: { promedio: promedio(delCliente), mediana: mediana(delCliente), muestras: delCliente.length },
        abiertas: { cantidad: abiertas.length, antiguedadPromedio: promedio(antiguedades), antiguedadMaxima: antiguedades.length ? Math.max(...antiguedades) : null, masDe48h: antiguedades.filter((t) => t > 48 * 3600000).length },
        tipos,
        clientes,
      });
    }

    case 'nueva_consulta': {
      const asunto = p.asunto || '';
      const cliente = esPlanet(me) ? (p.cliente || '') : me.cliente;
      const direccion = esPlanet(me) ? (p.direccion || 'cliente_a_planet') : 'cliente_a_planet';
      const mensaje = p.mensaje || '';
      if (!asunto || !cliente || !mensaje) return err('Faltan campos obligatorios');

      const fecha = ahoraAR();
      const ahora = Date.now();
      const tipo = (p.tipo || tipoDeAsunto(asunto) || '').trim();
      const estado = direccion === 'planet_a_cliente' ? 'Esperando info' : 'Abierto';
      const res = await db.prepare(
        `INSERT INTO consultas (fecha, asunto, cliente, direccion, estado, creado_por, nombre_creador, atendido_por, actualizado, tipo, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`
      ).bind(fecha, asunto, cliente, direccion, estado, me.usuario, me.nombre, ahora, tipo, ahora).run();

      const id = res.meta.last_row_id;
      const imgs = p.imagenes ? imagenesValidas(p.imagenes) : [];
      await db.batch([
        db.prepare('INSERT INTO mensajes (consulta_id, autor, nombre, fecha, texto, imagenes, creado_en, equipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, me.usuario, me.nombre, fecha, mensaje, imgs.length ? JSON.stringify(imgs) : null, ahora, me.team || ''),
        anotarEvento(db, { consultaId: id, evento: 'creada', a: estado, me }),
      ]);

      return ok({ id });
    }

    case 'responder': {
      const id = p.id;
      const texto = p.texto || '';
      const imgs = p.imagenes ? imagenesValidas(p.imagenes) : [];
      if (!id || (!texto && !imgs.length)) return err('Faltan campos');

      const c = await db.prepare('SELECT * FROM consultas WHERE id = ?').bind(id).first();
      if (!c) return err('Consulta no encontrada');
      // Un cliente solo responde consultas de su empresa
      if (!esPlanet(me) && c.cliente !== me.cliente) return err('Consulta no encontrada');
      if (c.estado === 'Cerrado') return err('La consulta está cerrada');

      const fecha = ahoraAR();
      const ahora = Date.now();
      const ops = [
        db.prepare('INSERT INTO mensajes (consulta_id, autor, nombre, fecha, texto, imagenes, creado_en, equipo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, me.usuario, me.nombre, fecha, texto, imgs.length ? JSON.stringify(imgs) : null, ahora, me.team || ''),
        anotarEvento(db, { consultaId: id, evento: 'mensaje', de: c.estado, me }),
        // Marca la consulta como cambiada, para que los demás lo vean sin recargar
        db.prepare('UPDATE consultas SET actualizado = ? WHERE id = ?').bind(Date.now(), id),
      ];

      // Flujo de estados (igual que antes):
      //  - Planet responde pidiendo info      → Esperando info
      //  - Planet responde sin pedir info     → En proceso
      //  - El cliente responde                → Respuesta cliente (salvo que nadie la haya tomado)
      let nuevoEstado = null;
      if (esPlanet(me)) {
        if (String(p.esperar_info) === '1') nuevoEstado = 'Esperando info';
        else if (['Abierto', 'Respuesta cliente', 'Respondido'].includes(c.estado)) nuevoEstado = 'En proceso';
        if (nuevoEstado && !c.atendido_por) {
          ops.push(db.prepare('UPDATE consultas SET atendido_por = ? WHERE id = ?').bind(me.nombre, id));
        }
      } else if (c.estado !== 'Abierto') {
        nuevoEstado = 'Respuesta cliente';
      }
      if (nuevoEstado && nuevoEstado !== c.estado) {
        ops.push(db.prepare('UPDATE consultas SET estado = ? WHERE id = ?').bind(nuevoEstado, id));
        ops.push(anotarEvento(db, { consultaId: id, evento: 'estado', de: c.estado, a: nuevoEstado, me }));
      }

      await db.batch(ops);
      return ok({});
    }

    case 'cambiar_estado': {
      const { id, estado, atendido_por } = p;
      if (!id || !estado) return err('Faltan campos');
      const antes = await db.prepare('SELECT estado FROM consultas WHERE id = ?').bind(id).first();
      if (!antes) return err('Consulta no encontrada');

      const ahora = Date.now();
      // Al cerrar se guarda el momento exacto (es lo que mide el tiempo de resolución).
      // Si se reabre, se borra para no dejar un cierre falso.
      const cierre = estado === 'Cerrado' ? ahora : null;
      const ops = [
        atendido_por
          ? db.prepare('UPDATE consultas SET estado = ?, atendido_por = ?, actualizado = ?, cerrado_en = ? WHERE id = ?')
              .bind(estado, atendido_por, ahora, cierre, id)
          : db.prepare('UPDATE consultas SET estado = ?, actualizado = ?, cerrado_en = ? WHERE id = ?')
              .bind(estado, ahora, cierre, id),
      ];
      if (estado !== antes.estado) {
        ops.push(anotarEvento(db, { consultaId: id, evento: 'estado', de: antes.estado, a: estado, me }));
      }
      await db.batch(ops);
      return ok({});
    }

    // ── NOTAS (post-its personales de Planet) ──
    case 'notas':
      return ok({ notas: await listarNotas(db, me) });

    case 'nota_guardar': {
      const ahora = ahoraAR();
      const num = (v) => (v === undefined || v === '' || isNaN(Number(v))) ? undefined : Number(v);
      const texto = p.texto !== undefined ? String(p.texto).slice(0, NOTA_MAX_CHARS) : undefined;
      const color = p.color !== undefined ? (NOTA_COLORES.includes(p.color) ? p.color : 'amarillo') : undefined;
      const pin = p.pin !== undefined ? (esVerdadero(p.pin) ? 1 : 0) : undefined;
      const min = p.min !== undefined ? (esVerdadero(p.min) ? 1 : 0) : undefined;
      const x = num(p.x), y = num(p.y);

      if (!p.id) {
        const res = await db.prepare(
          `INSERT INTO notas (texto, color, pin, autor, nombre_autor, fecha, actualizado, actualizado_por, x, y, min)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(texto || '', color || 'amarillo', pin ?? 0, me.usuario, me.nombre,
               ahora, ahora, me.nombre, x ?? null, y ?? null, min ?? 0).run();
        return ok({ id: res.meta.last_row_id, fecha: ahora });
      }

      const nota = await db.prepare('SELECT autor FROM notas WHERE id = ?').bind(p.id).first();
      if (!nota) return err('La nota ya no existe');
      if (String(nota.autor).toLowerCase() !== String(me.usuario).toLowerCase()) {
        return err('Esa nota no es tuya');
      }

      // Solo se tocan los campos que llegaron
      const cambios = { texto, color, pin, min, x, y };
      const sets = [], vals = [];
      for (const [k, v] of Object.entries(cambios)) {
        if (v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      sets.push('actualizado = ?'); vals.push(ahora);
      await db.prepare(`UPDATE notas SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, p.id).run();
      return ok({ id: p.id, actualizado: ahora });
    }

    case 'nota_borrar': {
      const nota = await db.prepare('SELECT autor FROM notas WHERE id = ?').bind(p.id).first();
      if (!nota) return ok({});  // ya no estaba: da igual
      if (String(nota.autor).toLowerCase() !== String(me.usuario).toLowerCase()) {
        return err('Esa nota no es tuya');
      }
      await db.prepare('DELETE FROM notas WHERE id = ?').bind(p.id).run();
      return ok({});
    }

    // ── USUARIOS (solo admin) ──
    case 'usuarios': {
      const { results } = await db.prepare(
        'SELECT usuario, nombre, team, cliente, role FROM usuarios ORDER BY usuario'
      ).all();
      return ok({ usuarios: results });
    }

    case 'crear_usuario': {
      const usuario = (p.usuario || '').trim().toLowerCase();
      const { nombre, password } = p;
      if (!usuario || !nombre || !password) return err('Faltan campos');
      const existe = await db.prepare('SELECT 1 FROM usuarios WHERE lower(usuario) = ?').bind(usuario).first();
      if (existe) return err('El usuario ya existe');
      await db.prepare(
        'INSERT INTO usuarios (usuario, nombre, password_hash, team, cliente, role) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(usuario, nombre, await hashPassword(password),
             p.team || 'cliente', p.cliente || '-', p.role || 'user').run();
      return ok({});
    }

    case 'editar_usuario': {
      const usuario = (p.usuario || '').trim().toLowerCase();
      if (!usuario) return err('Falta usuario');
      const existe = await db.prepare('SELECT 1 FROM usuarios WHERE lower(usuario) = ?').bind(usuario).first();
      if (!existe) return err('Usuario no encontrado');

      const sets = [], vals = [];
      for (const f of ['nombre', 'team', 'cliente', 'role']) {
        if (p[f] !== undefined && p[f] !== null && p[f] !== '') { sets.push(`${f} = ?`); vals.push(p[f]); }
      }
      if (p.password) { sets.push('password_hash = ?'); vals.push(await hashPassword(p.password)); }
      if (sets.length) {
        await db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE lower(usuario) = ?`)
          .bind(...vals, usuario).run();
      }
      return ok({});
    }

    case 'eliminar_usuario': {
      const usuario = (p.usuario || '').trim().toLowerCase();
      if (!usuario) return err('Falta usuario');
      if (usuario === String(me.usuario).toLowerCase()) return err('No podés eliminar tu propio usuario');
      const res = await db.prepare('DELETE FROM usuarios WHERE lower(usuario) = ?').bind(usuario).run();
      if (!res.meta.changes) return err('Usuario no encontrado');
      return ok({});
    }

    // ── CLIENTES ──
    case 'clientes': {
      const { results } = await db.prepare('SELECT * FROM clientes ORDER BY id').all();
      return ok({ clientes: results });
    }

    case 'crear_cliente': {
      const nombre = (p.nombre || '').trim();
      if (!nombre) return err('Falta el nombre del cliente');
      const existe = await db.prepare('SELECT 1 FROM clientes WHERE lower(nombre) = lower(?)').bind(nombre).first();
      if (existe) return err('Ya existe un cliente con ese nombre');
      const res = await db.prepare(
        `INSERT INTO clientes (nombre, contacto, telefono, email, direccion, notas, fecha_alta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(nombre, p.contacto || '', p.telefono || '', p.email || '',
             p.direccion || '', p.notas || '', ahoraAR(true)).run();
      return ok({ id: res.meta.last_row_id });
    }

    case 'editar_cliente': {
      if (!p.id) return err('Falta id del cliente');
      const sets = [], vals = [];
      for (const f of ['nombre', 'contacto', 'telefono', 'email', 'direccion', 'notas']) {
        if (p[f] !== undefined && p[f] !== null) { sets.push(`${f} = ?`); vals.push(p[f]); }
      }
      if (!sets.length) return ok({});
      const res = await db.prepare(`UPDATE clientes SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...vals, p.id).run();
      if (!res.meta.changes) return err('Cliente no encontrado');
      return ok({});
    }

    case 'eliminar_cliente': {
      if (!p.id) return err('Falta id del cliente');
      const res = await db.prepare('DELETE FROM clientes WHERE id = ?').bind(p.id).run();
      if (!res.meta.changes) return err('Cliente no encontrado');
      return ok({});
    }

    // ── IMÁGENES ──
    case 'subir_imagen': {
      if (!env.IMAGENES) return err('El almacenamiento de imágenes todavía no está activado');
      const mime = String(p.mime || '');
      const datos = p.data ?? p.datos;   // el portal lo manda como "data"
      if (!datos) return err('Falta la imagen');
      if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return err('Solo se pueden subir imágenes');

      let bytes;
      try { bytes = deB64(String(datos).replace(/^data:[^,]+,/, '')); }
      catch { return err('Imagen inválida'); }
      if (!bytes.length) return err('Imagen vacía');
      if (bytes.length > 5 * 1024 * 1024) return err('La imagen es demasiado grande (máx. 5 MB)');

      const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const clave = `${crypto.randomUUID()}.${ext}`;
      // El tipo va como metadato para poder devolverlo al servirla
      await env.IMAGENES.put(clave, bytes, { metadata: { mime } });

      // El portal guarda esto tal cual en el mensaje. Va la URL completa
      // porque el portal vive en otro dominio (github.io).
      return ok({ id: `${origen}/img/${clave}` });
    }

    case 'init':
      return ok({ message: 'La base ya está creada con schema.sql' });

    default:
      return err('Accion no reconocida: ' + action);
  }
}

// ── ENTRADA ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Servir una imagen guardada
    if (url.pathname.startsWith('/img/')) {
      if (!env.IMAGENES) return new Response('No encontrada', { status: 404 });
      const { value, metadata } = await env.IMAGENES.getWithMetadata(
        decodeURIComponent(url.pathname.slice(5)), { type: 'arrayBuffer' }
      );
      if (!value) return new Response('No encontrada', { status: 404 });
      return new Response(value, {
        headers: {
          'Content-Type': metadata?.mime || 'image/jpeg',
          // Las imágenes nunca cambian: el navegador puede guardarlas para siempre
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...CORS,
        },
      });
    }

    // Parámetros: por query (GET) o por cuerpo JSON (POST, para imágenes)
    let p = Object.fromEntries(url.searchParams);
    if (request.method === 'POST') {
      try { p = { ...p, ...(await request.json()) }; } catch {}
    }

    const callback = p.callback;
    const action = p.action || '';
    if (!action) return responder(err('Falta el parámetro action'), callback);

    // La primera vez que arranca con la versión nueva, prepara la base
    try {
      const hecho = await prepararMetricas(env);
      if (hecho) console.log('Métricas listas:', JSON.stringify(hecho));
    } catch (e) {
      console.log('Aviso: no se pudo preparar las métricas:', e.message);
    }

    try {
      return responder(await manejar(action, p, env, url.origin), callback);
    } catch (e) {
      return responder(err('Error: ' + e.message), callback);
    }
  },
};
