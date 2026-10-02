// ═══ AVISOS AL TELÉFONO (Web Push) ═══
//
// Cada navegador que activa los avisos nos deja una "suscripción": una
// dirección del servicio de notificaciones de Google/Apple/Mozilla y dos
// claves. Para mandar un aviso hay que:
//   1. firmar un permiso (VAPID) que dice "este servidor puede escribirle", y
//   2. cifrar el texto con las claves de ese navegador, así nadie en el medio
//      puede leerlo (ni Google ni Apple).
// Todo eso está acá y no necesita ninguna librería: lo hace Web Crypto.
// Las recetas son las de los estándares RFC 8291 (cifrado) y RFC 8292 (VAPID).

const P256 = { name: 'ECDH', namedCurve: 'P-256' };
const texto = new TextEncoder();

export const aB64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const deB64url = (s) => Uint8Array.from(
  atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')),
  (c) => c.charCodeAt(0));

const unir = (...partes) => {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};

// HMAC-SHA256, que es con lo que se arma todo lo demás
async function hmac(clave, datos) {
  const k = await crypto.subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, datos));
}
// HKDF: de un secreto saca una clave del largo que haga falta
async function derivar(salt, secreto, info, largo) {
  const prk = await hmac(salt, secreto);
  return (await hmac(prk, unir(info, Uint8Array.of(1)))).slice(0, largo);
}

// ── CIFRADO DEL MENSAJE (RFC 8291) ──
// claveLocal y salt se pueden pasar para poder probar contra el ejemplo del
// estándar; en el uso normal se generan al azar en cada envío.
export async function cifrar(mensaje, p256dhB64, authB64, fijos = {}) {
  const suyaBytes = deB64url(p256dhB64);
  const suya = await crypto.subtle.importKey('raw', suyaBytes, P256, false, []);
  const mia = fijos.claveLocal || await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const miaBytes = new Uint8Array(await crypto.subtle.exportKey('raw', mia.publicKey));
  const salt = fijos.salt || crypto.getRandomValues(new Uint8Array(16));

  const compartido = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: suya }, mia.privateKey, 256));
  // El "ingrediente" sale del secreto compartido y de las dos claves públicas
  const info = unir(texto.encode('WebPush: info'), Uint8Array.of(0), suyaBytes, miaBytes);
  const ikm = await derivar(deB64url(authB64), compartido, info, 32);

  const cek = await derivar(salt, ikm, texto.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await derivar(salt, ikm, texto.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // El 2 al final marca que el mensaje terminó (así lo pide el estándar)
  const claro = unir(texto.encode(mensaje), Uint8Array.of(2));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, claro));

  const tamanio = new Uint8Array(4);
  new DataView(tamanio.buffer).setUint32(0, 4096);
  return unir(salt, tamanio, Uint8Array.of(miaBytes.length), miaBytes, cifrado);
}

// ── PERMISO FIRMADO (VAPID, RFC 8292) ──
async function permisoVapid(endpoint, privadaJwk, publica) {
  const { origin } = new URL(endpoint);
  const cabecera = aB64url(texto.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = aB64url(texto.encode(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 11 * 3600,
    sub: 'mailto:gianlucca.planet@gmail.com',
  })));
  const clave = await crypto.subtle.importKey('jwk', privadaJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clave, texto.encode(`${cabecera}.${cuerpo}`));
  return `vapid t=${cabecera}.${cuerpo}.${aB64url(firma)}, k=${publica}`;
}

// ── MANDAR UN AVISO A UN NAVEGADOR ──
// Devuelve 'ok', 'baja' (el navegador ya no existe: hay que borrarlo) o 'error'
export async function mandarA(sub, aviso, env) {
  if (!env.VAPID_PRIVADA || !env.VAPID_PUBLICA) return 'sin-claves';
  let privada;
  try { privada = JSON.parse(env.VAPID_PRIVADA); } catch { return 'sin-claves'; }

  const cuerpo = await cifrar(JSON.stringify(aviso), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
      Authorization: await permisoVapid(sub.endpoint, privada, env.VAPID_PUBLICA),
    },
    body: cuerpo,
  });
  if (res.status === 404 || res.status === 410) return 'baja';
  return res.ok ? 'ok' : 'error';
}

// ── A QUIÉN LE MANDAMOS ──
export async function avisarA(env, usuarios, aviso) {
  const db = env.DB;
  const lista = [...new Set((usuarios || []).filter(Boolean))];
  if (!lista.length || !env.VAPID_PRIVADA) return { enviados: 0, bajas: 0 };

  const huecos = lista.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT endpoint, p256dh, auth FROM suscripciones WHERE usuario IN (${huecos})`
  ).bind(...lista).all();
  if (!results.length) return { enviados: 0, bajas: 0 };

  const salidas = await Promise.all(results.map(async (s) => {
    try { return await mandarA(s, aviso, env); } catch { return 'error'; }
  }));
  // Los navegadores que ya no existen (desinstalados, permisos revocados) se borran
  const bajas = results.filter((_, i) => salidas[i] === 'baja').map((s) => s.endpoint);
  if (bajas.length) {
    await db.batch(bajas.map((e) => db.prepare('DELETE FROM suscripciones WHERE endpoint = ?').bind(e)));
  }
  return { enviados: salidas.filter((r) => r === 'ok').length, bajas: bajas.length };
}

// Los que tienen que enterarse: todo Planet, o la gente de esa empresa.
// Nunca le avisamos a quien acaba de escribir.
export async function destinatariosDe(db, { aPlanet, cliente, salvo }) {
  const consulta = aPlanet
    ? db.prepare("SELECT usuario FROM usuarios WHERE team = 'planet'")
    : db.prepare("SELECT usuario FROM usuarios WHERE team != 'planet' AND cliente = ?").bind(cliente);
  const { results } = await consulta.all();
  return results.map((r) => r.usuario).filter((u) => u !== salvo);
}

// Avisa sin hacer esperar a quien escribió: el Worker sigue trabajando después
// de contestar gracias a waitUntil.
export function avisarConsulta(ejecucion, env, datos) {
  const trabajo = (async () => {
    if (!env.VAPID_PRIVADA) return;
    const usuarios = await destinatariosDe(env.DB, datos);
    await avisarA(env, usuarios, { titulo: datos.titulo, cuerpo: datos.cuerpo, id: datos.id });
  })().catch((e) => console.error('aviso push', e));
  if (ejecucion && ejecucion.waitUntil) ejecucion.waitUntil(trabajo);
  return trabajo;
}

// ── SUSCRIPCIONES ──
export async function guardarSuscripcion(db, me, p) {
  const endpoint = String(p.endpoint || '');
  const p256dh = String(p.p256dh || '');
  const auth = String(p.auth || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return { ok: false, error: 'Suscripción inválida' };
  await db.prepare(
    `INSERT INTO suscripciones (endpoint, usuario, p256dh, auth, creado_en) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET usuario = excluded.usuario, p256dh = excluded.p256dh,
       auth = excluded.auth, creado_en = excluded.creado_en`
  ).bind(endpoint, me.usuario, p256dh, auth, Date.now()).run();
  return { ok: true };
}

export async function borrarSuscripcion(db, me, p) {
  await db.prepare('DELETE FROM suscripciones WHERE endpoint = ? AND usuario = ?')
    .bind(String(p.endpoint || ''), me.usuario).run();
  return { ok: true };
}
