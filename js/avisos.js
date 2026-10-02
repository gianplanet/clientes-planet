// ═══ AVISOS AL TELÉFONO ═══
// Cada dispositivo los activa por separado: el navegador nos da una
// "dirección" para escribirle y la guardamos en el servidor. Si la persona
// los apaga o borra el portal, el servidor se entera sola la próxima vez que
// intenta avisarle y la da de baja.

const SOPORTA_AVISOS = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const ES_IPHONE = /iphone|ipad|ipod/i.test(navigator.userAgent);
// En iPhone, Apple solo permite avisos si el portal está agregado a la pantalla de inicio
const INSTALADO = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

let _sw = null;          // el ayudante que muestra los avisos
let _clavePush = '';     // clave pública del servidor

async function prepararAvisos() {
  if (!SOPORTA_AVISOS) return null;
  if (!_sw) _sw = await navigator.serviceWorker.register('sw.js').catch(() => null);
  return _sw;
}

// Al entrar: si ya los tenía activados, renovamos la suscripción sin molestar.
// La dirección que da el navegador puede cambiar sola y, si no la renovamos,
// los avisos dejan de llegar sin que nadie se entere.
async function renovarAvisos() {
  if (!SOPORTA_AVISOS || Notification.permission !== 'granted') return;
  const reg = await prepararAvisos();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await guardarSuscripcion(sub);
}

async function claveDelServidor() {
  if (_clavePush) return _clavePush;
  const res = await api({ action: 'push_clave' });
  _clavePush = (res.ok && res.clave) || '';
  return _clavePush;
}

function aBytes(base64) {
  const limpio = base64.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = limpio.padEnd(Math.ceil(limpio.length / 4) * 4, '=');
  return Uint8Array.from(atob(relleno), (c) => c.charCodeAt(0));
}

function datosDe(sub) {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth };
}

async function guardarSuscripcion(sub) {
  return api(Object.assign({ action: 'push_alta' }, datosDe(sub)));
}

// ── LA VENTANA DE AVISOS ──
function abrirAvisos() {
  pintarAvisos();
  abrirModal('modal-avisos');
}
function cerrarAvisos() { cerrarModal('modal-avisos'); }

async function pintarAvisos() {
  const cont = $('avisos-cuerpo');
  const texto = (t) => `<p class="avisos-texto">${t}</p>`;

  if (!SOPORTA_AVISOS) {
    cont.innerHTML = texto('Este navegador no puede mostrar avisos. Probá desde Chrome en Android o desde la computadora.');
    return;
  }
  if (ES_IPHONE && !INSTALADO) {
    cont.innerHTML = `
      ${texto('En iPhone, Apple solo deja mandar avisos si antes agregás el portal a la pantalla de inicio. Son dos pasos y se hace una sola vez:')}
      <ol class="avisos-pasos">
        <li>Tocá el botón de compartir de Safari (el cuadradito con la flecha para arriba).</li>
        <li>Elegí <strong>Agregar a inicio</strong> y confirmá.</li>
        <li>Abrí el portal desde el ícono nuevo y volvé acá para activarlos.</li>
      </ol>`;
    return;
  }
  if (Notification.permission === 'denied') {
    cont.innerHTML = texto('Los avisos están bloqueados para esta página. Hay que permitirlos desde la configuración del navegador (el candadito al lado de la dirección) y volver a entrar.');
    return;
  }

  const reg = await prepararAvisos();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    cont.innerHTML = `
      ${texto('Los avisos están <strong>activados</strong> en este dispositivo. Te vamos a avisar cuando haya novedades en tus consultas, aunque tengas el portal cerrado.')}
      <div class="avisos-botones">
        <button class="btn-chico peligro" onclick="desactivarAvisos(this)">Desactivar</button>
        <button class="btn-chico primario" onclick="probarAviso(this)">Probar</button>
      </div>`;
    return;
  }
  cont.innerHTML = `
    ${texto('Activalos y te avisamos en este dispositivo cuando haya novedades en tus consultas, aunque tengas el portal cerrado.')}
    <div class="avisos-botones">
      <button class="btn-send" onclick="activarAvisos(this)">Activar los avisos</button>
    </div>`;
}

async function activarAvisos(btn) {
  const listo = ocupado(btn, 'Activando...');
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return toast('No se activaron: el navegador no dio permiso');
    const clave = await claveDelServidor();
    if (!clave) return toast('Error: el servidor todavía no tiene configurados los avisos');
    const reg = await prepararAvisos();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(clave) });
    const res = await guardarSuscripcion(sub);
    if (!res.ok) return toast('Error: ' + (res.error || 'no se pudo guardar'));
    toast('✓ Avisos activados en este dispositivo');
  } catch (e) {
    toast('No se pudieron activar: ' + (e && e.message ? e.message : 'error del navegador'));
  } finally {
    listo();
    pintarAvisos();
  }
}

async function desactivarAvisos(btn) {
  const listo = ocupado(btn, 'Desactivando...');
  const reg = await prepararAvisos();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    await api({ action: 'push_baja', endpoint: sub.endpoint });
    await sub.unsubscribe().catch(() => {});
  }
  listo();
  toast('Avisos desactivados en este dispositivo');
  pintarAvisos();
}

async function probarAviso(btn) {
  const listo = ocupado(btn, 'Mandando...');
  const res = await api({ action: 'push_prueba' });
  listo();
  toast(res.ok ? '✓ Aviso enviado: fijate en la pantalla' : 'Error: ' + (res.error || 'no se pudo'));
}

// Si tocan el aviso con el portal ya abierto, el ayudante nos avisa cuál era
if (SOPORTA_AVISOS) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const id = e.data && e.data.abrirConsulta;
    if (id) irAConsulta(id);
  });
}

// Abre la consulta que vino en el aviso (o en la dirección, al abrir el portal)
function irAConsulta(id) {
  const tarjeta = $('card-' + id) || $('tcard-' + id);
  if (!tarjeta) {
    // Puede estar en otra solapa: mostramos todas y reintentamos
    if (esPlanet()) { filtroEstado = 'Todos'; cambiarFiltro(); }
    else { Object.keys(clientTabEstado).forEach(k => { clientTabEstado[k] = 'Todos'; }); pintarCliente(); }
  }
  const el = $('card-' + id) || $('tcard-' + id);
  if (!el) return;
  if (!el.classList.contains('open')) toggleCard(el.id);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Al entrar, si el aviso abrió el portal con ?c=123, vamos a esa consulta
function abrirConsultaDeLaDireccion() {
  const id = new URLSearchParams(location.search).get('c');
  if (!id) return;
  history.replaceState(null, '', location.pathname);
  setTimeout(() => irAConsulta(id), 600);
}
