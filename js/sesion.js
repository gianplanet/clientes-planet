// ═══ SESIÓN, DATOS Y ACTUALIZACIÓN AUTOMÁTICA ═══

let sesion = null;            // { usuario, nombre, team, cliente, role, token }
let consultas = [];           // todas las consultas cargadas (de Planet o del cliente)
let marcaCambios = 0;         // último cambio que ya está en pantalla (ms, lo da el servidor)
let historialCompleto = true; // false: hay cerradas viejas que todavía no se pidieron
let conHistorial = false;     // el usuario pidió ver también las cerradas viejas
let datosMostrados = false;   // ya hay consultas en pantalla (del cache o del servidor)

const esPlanet = () => !!sesion && sesion.team === 'planet';

// ── DATOS ──
// Cada consulta llega con sus mensajes. Acá se le agregan dos datos que se
// usan todo el tiempo (para ordenar y para buscar), así no se recalculan en
// cada tecla ni en cada comparación.
function prepararConsulta(c) {
  const msgs = c.mensajes || (c.mensajes = []);
  const fechas = [altaEnMs(c)].concat(msgs.map(m => fechaMs(m.fecha))).filter(fechaValida);
  c._actividad = fechas.length ? Math.max.apply(null, fechas) : 0;
  c._busqueda = normalizar([
    c.asunto, c.cliente, '#' + c.id, c.nombre_creador, c.atendido_por, c.estado,
    msgs.map(m => (m.nombre || '') + ' ' + (m.texto || '')).join(' ')
  ].join(' '));
  return c;
}

// Firma para saber si una consulta cambió desde la última vez que se dibujó
const firma = c => [c.actualizado, c.estado, (c.mensajes || []).length, c.atendido_por].join('|');

// Guarda lo que llegó del servidor. "completa": reemplaza todo; si no, es
// una actualización parcial (solo lo que cambió). Devuelve true si cambió algo.
function recibirConsultas(lista, completa) {
  lista = (lista || []).map(prepararConsulta);
  if (completa) {
    consultas = lista;
    return true;
  }
  const porId = new Map(consultas.map(c => [String(c.id), c]));
  let cambio = false;
  lista.forEach(c => {
    const antes = porId.get(String(c.id));
    if (antes && firma(antes) === firma(c)) return;
    // Una respuesta que salió antes de nuestro último cambio trae la consulta
    // como estaba: no pisa lo que ya se ve actualizado en pantalla. Vale para
    // una versión más vieja que la que ya tenemos y para un cambio nuestro que
    // el servidor todavía no confirmó (_base = la versión sobre la que se hizo).
    if (antes && c.actualizado && antes.actualizado && c.actualizado < antes.actualizado) return;
    if (antes && antes._base !== undefined && c.actualizado <= antes._base) return;
    porId.set(String(c.id), c);
    cambio = true;
  });
  if (cambio) consultas = Array.from(porId.values()).sort((a, b) => b.id - a.id);
  return cambio;
}

// Aplica en pantalla lo que el servidor ya confirmó, sin esperar a recargar.
// _base recuerda la versión del servidor sobre la que se hizo el cambio.
function aplicarLocal(id, cambios, mensaje) {
  const c = consultas.find(x => String(x.id) === String(id));
  if (!c) return;
  c._base = c.actualizado;
  const cambiaEstado = cambios.estado && cambios.estado !== c.estado;
  if (cambiaEstado) c.estado = cambios.estado;
  if (cambiaEstado && cambios.estado === 'Cerrado') c.cerrado_en = Date.now();
  // Quien mueve la consulta por primera vez queda como quien la atiende (igual que el servidor)
  if (cambiaEstado && cambios.atendido_por && !c.atendido_por) c.atendido_por = cambios.atendido_por;
  if (mensaje) c.mensajes.push(mensaje);
  prepararConsulta(c);
}

// ── CACHE LOCAL: muestra al instante lo de la última visita mientras se actualiza ──
const claveCache = () => 'planet_cache_' + (sesion ? sesion.usuario : '');
function guardarCache() { local.guardar(claveCache(), consultas.map(({ _actividad, _busqueda, ...c }) => c)); }

// ── CARGAR ──
function pintar() {
  if (!sesion) return;
  if (esPlanet()) pintarPlanet(); else pintarCliente();
}

function mostrarErrorDeCarga(error) {
  if (datosMostrados) return toast('No se pudo actualizar: ' + (error || 'error'));
  const listas = esPlanet() ? ['planet-consultas-list'] : ['client-list'];
  listas.forEach(id => { $(id).innerHTML = '<div class="empty-state"><p>Error: ' + esc(error) + '</p></div>'; });
}

// Trae todas las consultas (abiertas + cerradas recientes, o todo si se pidió el historial)
async function cargarTodo() {
  const planet = esPlanet();
  if (!datosMostrados) {
    if (planet) $('planet-consultas-list').innerHTML = esqueletoHtml(4);
    else $('client-list').innerHTML = esqueletoHtml(4);
  }
  const boton = planet ? 'planet-reload' : 'client-reload';
  const token = sesion.token;
  indicarActualizando(boton, true);
  const res = await api({ action: 'consultas', historial: conHistorial ? 1 : 0 });
  indicarActualizando(boton, false);
  if (!sesion || sesion.token !== token) return;   // cerró sesión (o entró otro) mientras cargaba
  if (!res.ok) return mostrarErrorDeCarga(res.error);
  usarPaquete(res);
}

// Lo que devuelve el servidor al entrar o al cargar todo
function usarPaquete(res) {
  _ultimaCargaCompleta = Date.now();
  marcaCambios = Number(res.ultimo) || 0;
  historialCompleto = res.historialCompleto !== false;
  recibirNotas(res.notas);
  recibirConsultas(res.consultas, true);
  guardarCache();
  pintar();
  mostrarResumenTurno();
}

// Post-its de Planet: solo se vuelven a dibujar si cambiaron (por ejemplo,
// editados desde otra computadora)
let _firmaNotas = '';
function recibirNotas(notas) {
  if (!Array.isArray(notas)) return;
  const f = JSON.stringify(notas);
  if (f === _firmaNotas) return;
  _firmaNotas = f;
  setNotas(notas);
}

// Pide solo lo que cambió desde la última vez. Es lo que corre cada 30 s y
// después de cada acción propia (responder, cambiar estado...).
// Si ya hay un pedido en camino, al terminar se hace otro: ese pedido pudo
// salir antes del cambio que acabamos de guardar.
let _refrescando = null, _otraVez = false;
function refrescar() {
  if (_refrescando) { _otraVez = true; return _refrescando; }
  _refrescando = (async () => {
    do { _otraVez = false; await pedirCambios(); } while (_otraVez && sesion);
  })().finally(() => { _refrescando = null; });
  return _refrescando;
}
async function pedirCambios() {
  if (!sesion) return;
  const token = sesion.token;
  const res = await api({ action: 'consultas', desde: marcaCambios });
  if (!sesion || sesion.token !== token || !res.ok) return;
  marcaCambios = Math.max(marcaCambios, Number(res.ultimo) || 0);
  recibirNotas(res.notas);
  if (recibirConsultas(res.consultas, false)) {
    guardarCache();
    pintar();
  }
}

// "Ver historial completo": trae también las cerradas viejas
async function cargarHistorial(btn) {
  conHistorial = true;
  const listo = ocupado(btn, 'Cargando historial…');
  await cargarTodo();
  listo();
}

// ── ACTUALIZACIÓN AUTOMÁTICA ──
// Cada 30 s el portal pregunta qué cambió. Si no cambió nada, el servidor
// casi no lee nada y el portal no vuelve a dibujar.
// Cada 10 minutos, en cambio, recarga todo: es la red de seguridad por si
// algún cambio se escapó (quien usa el portal lo deja abierto todo el día).
const REVISAR_CADA_MS = 30000;
const RECARGAR_TODO_CADA_MS = 10 * 60000;
let _revisarTimer = null;
let _ultimaCargaCompleta = 0;

// No interrumpe a alguien que está en el medio de algo: al volver a dibujar
// se borraría lo que está escribiendo o eligiendo.
function estaOcupado() {
  if (document.querySelector('.modal-overlay.active, #lightbox.active')) return true;
  const foco = document.activeElement;
  if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName) && !foco.classList.contains('search-input')) return true;
  // Respuestas a medio escribir (del cliente o de Planet) o con fotos adjuntas
  if ([...document.querySelectorAll('input[id^="reply-"], input[id^="preply-"]')].some(i => i.value.trim())) return true;
  return Object.keys(imgsPendientes).some(k => /^[cp]\d+$/.test(k) && imgsPendientes[k].length);
}

async function revisarNovedades() {
  if (!sesion || document.hidden || estaOcupado()) return;
  if (Date.now() - _ultimaCargaCompleta > RECARGAR_TODO_CADA_MS) await cargarTodo();
  else await refrescar();
}

function arrancarRevision() {
  pararRevision();
  _revisarTimer = setInterval(revisarNovedades, REVISAR_CADA_MS);
}
function pararRevision() {
  if (_revisarTimer) { clearInterval(_revisarTimer); _revisarTimer = null; }
}
// Con la pestaña en segundo plano no pregunta; al volver, revisa en el acto
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarNovedades(); });

// ── ENTRAR Y SALIR ──
async function entrar() {
  const usuario = $('login-user').value.trim();
  const password = $('login-pass').value.trim();
  const error = $('login-error'), btn = $('login-btn');
  if (!usuario || !password) {
    error.textContent = 'Completá usuario y contraseña';
    error.style.display = 'block';
    sacudirVacios(['login-user', 'login-pass']);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Ingresando...';
  error.style.display = 'none';
  const lento = setTimeout(() => { btn.textContent = 'Conectando con el servidor...'; }, 6000);
  const res = await api({ action: 'login', usuario, password });
  clearTimeout(lento);
  btn.disabled = false;
  btn.textContent = 'Ingresar';

  if (!res.ok) {
    error.textContent = res.error || 'Error al ingresar';
    error.style.display = 'block';
    sacudir(document.querySelector('.login-form'));
    return;
  }
  sesion = Object.assign({}, res.user, { token: res.token });
  local.guardar('planet_user', sesion);
  abrirVista();
  pedirResumenDeTurno(true);
  usarPaquete(res);
  arrancarRevision();
}

function salir(sesionYaInvalida) {
  pararRevision();
  if (sesion && sesionYaInvalida !== true) api({ action: 'logout' });
  local.borrar(claveCache());
  local.borrar(claveNotas());
  local.borrar('planet_user');
  sesion = null;
  consultas = [];
  marcaCambios = 0;
  historialCompleto = true;
  conHistorial = false;
  datosMostrados = false;
  olvidarPantalla();
  $('login-user').value = '';
  $('login-pass').value = '';
  mostrarPantalla('screen-login');
}

// Limpia todo lo que quedó en memoria de la persona anterior
function olvidarPantalla() {
  _turnoPendiente = false;
  _vistos = null;
  _estadosVistos = {};
  _firmaNotas = '';
  notasData = [];
  _clientesCargados = false;
  if (capaNotas()) capaNotas().innerHTML = '';
  if (_guia) { _guia.root.remove(); _guia = null; }
  [clientTabEstado, _numsPrevios, imgsPendientes, visibles].forEach(o => Object.keys(o).forEach(k => delete o[k]));
  openCards.clear();
}

// Arma la pantalla que corresponde (Planet o cliente)
function abrirVista() {
  if (esPlanet()) abrirVistaPlanet(); else abrirVistaCliente();
}

// Al abrir el portal: si quedó una sesión guardada, entra directo mostrando
// lo de la última visita y lo actualiza por detrás.
function entrarConSesionGuardada() {
  const guardada = local.leer('planet_user');
  if (!guardada || !guardada.token) { local.borrar('planet_user'); return; }
  sesion = guardada;
  abrirVista();
  pedirResumenDeTurno(false);
  const cache = local.leer(claveCache());
  if (cache) { recibirConsultas(cache, true); pintar(); }
  cargarTodo();
  arrancarRevision();
}
