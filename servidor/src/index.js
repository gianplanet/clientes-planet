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
const PLANET_ONLY = ['cambiar_estado', 'clientes', 'notas', 'nota_guardar', 'nota_borrar'];

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

    case 'nueva_consulta': {
      const asunto = p.asunto || '';
      const cliente = esPlanet(me) ? (p.cliente || '') : me.cliente;
      const direccion = esPlanet(me) ? (p.direccion || 'cliente_a_planet') : 'cliente_a_planet';
      const mensaje = p.mensaje || '';
      if (!asunto || !cliente || !mensaje) return err('Faltan campos obligatorios');

      const fecha = ahoraAR();
      const estado = direccion === 'planet_a_cliente' ? 'Esperando info' : 'Abierto';
      const res = await db.prepare(
        `INSERT INTO consultas (fecha, asunto, cliente, direccion, estado, creado_por, nombre_creador, atendido_por, actualizado)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`
      ).bind(fecha, asunto, cliente, direccion, estado, me.usuario, me.nombre, Date.now()).run();

      const id = res.meta.last_row_id;
      const imgs = p.imagenes ? imagenesValidas(p.imagenes) : [];
      await db.prepare(
        'INSERT INTO mensajes (consulta_id, autor, nombre, fecha, texto, imagenes) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, me.usuario, me.nombre, fecha, mensaje, imgs.length ? JSON.stringify(imgs) : null).run();

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
      const ops = [
        db.prepare('INSERT INTO mensajes (consulta_id, autor, nombre, fecha, texto, imagenes) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, me.usuario, me.nombre, fecha, texto, imgs.length ? JSON.stringify(imgs) : null),
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
      }

      await db.batch(ops);
      return ok({});
    }

    case 'cambiar_estado': {
      const { id, estado, atendido_por } = p;
      if (!id || !estado) return err('Faltan campos');
      const res = atendido_por
        ? await db.prepare('UPDATE consultas SET estado = ?, atendido_por = ?, actualizado = ? WHERE id = ?')
            .bind(estado, atendido_por, Date.now(), id).run()
        : await db.prepare('UPDATE consultas SET estado = ?, actualizado = ? WHERE id = ?')
            .bind(estado, Date.now(), id).run();
      if (!res.meta.changes) return err('Consulta no encontrada');
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

    try {
      return responder(await manejar(action, p, env, url.origin), callback);
    } catch (e) {
      return responder(err('Error: ' + e.message), callback);
    }
  },
};
