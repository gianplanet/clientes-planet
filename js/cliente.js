// ═══ VISTA DEL CLIENTE ═══
// Una sola lista con todas sus consultas: las que él nos hace y las que le
// hacemos nosotros (esas nacen en "Esperando tu respuesta"). Solapas por estado.

let busquedaCliente = '';

function abrirVistaCliente() {
  $('client-name').textContent = sesion.nombre;
  $('client-org').textContent = sesion.cliente;
  $('client-avatar').textContent = (sesion.nombre || '?')[0];
  $('client-avatar').style.background = avatarColor(sesion.nombre);
  mostrarPantalla('screen-client');
}

function pintarCliente() {
  avisarCierres(consultas);
  const primeraVez = !datosMostrados;
  datosMostrados = true;

  // Resumen (todas las consultas del cliente, las suyas y las nuestras)
  const cuenta = g => consultas.filter(c => grupoCliente(c.estado) === g).length;
  $('client-stats').innerHTML = [
    ['pendiente', 'Pendientes'], ['proceso', 'En proceso'], ['espera', 'Esperan tu respuesta'], ['cerrado', 'Cerradas']
  ].map(([g, label]) =>
    `<div class="stat-card"><div class="stat-number" style="color:${GRUPOS[g].color}">${cuenta(g)}</div><div class="stat-label">${label}</div></div>`).join('');
  rodarNumeros('client-stats');

  // Avisos: se separan las que esperan info nuestra de las que le preguntamos nosotros
  const esperan = consultas.filter(c => grupoCliente(c.estado) === 'espera');
  const nuestras = esperan.filter(c => c.direccion === 'planet_a_cliente').length;
  const suyas = esperan.length - nuestras;
  const plural = n => n > 1 ? 's' : '';
  const recienCerradas = consultas.filter(cerradaHacePoco).length;
  $('client-alert').innerHTML =
    (suyas ? avisoEspera(`Planet necesita info tuya en <strong>${suyas} consulta${plural(suyas)}</strong>`) : '') +
    (nuestras ? avisoEspera(`Planet te hizo <strong>${nuestras} consulta${plural(nuestras)}</strong> que espera${nuestras > 1 ? 'n' : ''} tu respuesta`) : '') +
    (recienCerradas ? `
      <div class="alert-banner alert-ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>
        <span>Planet resolvió <strong>${recienCerradas} consulta${plural(recienCerradas)}</strong></span>
        <button class="alert-cerrar" onclick="marcarTodosLosCierresVistos()" title="Entendido">✕</button>
      </div>` : '');

  armarListaCliente(consultas, 'client-list', 'No tenés consultas todavía');

  if (primeraVez) entrada(tarjetasDe('client-list'));
  marcarNovedades(consultas, 'card-');

  // Primera vez que el cliente entra (en este dispositivo): guía de cómo funciona
  if (!guiaVista() && !_guia) {
    setTimeout(() => {
      if (sesion && !esPlanet() && $('screen-client').classList.contains('active')
          && !$('modal-new-query').classList.contains('active') && !guiaVista()) iniciarGuia();
    }, 900);
  }
}

function avisoEspera(texto) {
  return `
    <div class="alert-banner alert-wait">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <span>${texto}</span>
    </div>`;
}

// ── SOLAPAS POR ESTADO ──
// Al entrar se abre la primera que tenga consultas: Esperan tu respuesta → Pendiente → En proceso.
const clientTabEstado = {};   // lista → 'espera' | 'pendiente' | 'proceso' | 'cerrado' | 'Todos'
const _listasCliente = {};
const SOLAPAS_CLIENTE = [
  { g: 'pendiente', icono: '⏳', label: 'Pendiente' },
  { g: 'proceso',   icono: '🔄', label: 'En proceso' },
  { g: 'espera',    icono: '💬', label: 'Esperan tu respuesta' },
  { g: 'cerrado',   icono: '✓',  label: 'Cerradas' }
];
function solapaInicial(lista) {
  const hay = g => lista.some(c => grupoCliente(c.estado) === g);
  return ['espera', 'pendiente', 'proceso'].find(hay) || 'cerrado';
}

function armarListaCliente(lista, contId, vacio) {
  _listasCliente[contId] = { lista };
  if (!lista.length) {
    $(contId).innerHTML = `<div class="empty-state"><p>${vacio}</p></div>${botonHistorial()}`;
    return;
  }
  const vista = clientTabEstado[contId] || (clientTabEstado[contId] = solapaInicial(lista));
  const n = g => lista.filter(c => grupoCliente(c.estado) === g).length;
  const chips = SOLAPAS_CLIENTE.map(t => {
    const act = vista === t.g;
    return `<button class="client-chip ${act ? 'active' : ''}" data-v="${t.g}" onclick="elegirSolapaCliente(${jsArg(contId)}, ${jsArg(t.g)}, this)" style="${estiloSolapa(t.g, act)}">${t.icono} ${t.label} <span class="cnt">${n(t.g)}</span></button>`;
  }).join('') +
    `<button class="client-chip ${vista === 'Todos' ? 'active' : ''}" data-v="Todos" onclick="elegirSolapaCliente(${jsArg(contId)}, 'Todos', this)">Todas <span class="cnt">${lista.length}</span></button>` + chipOrden();
  $(contId).innerHTML = `<div class="client-filter estado-chips">${chips}</div><div class="estado-lista"></div>`;
  pintarListaCliente(contId);
}

function pintarListaCliente(contId) {
  const guardada = _listasCliente[contId];
  const cont = guardada && $(contId).querySelector('.estado-lista');
  if (!cont) return;
  const lista = busquedaCliente ? guardada.lista.filter(c => coincide(c, busquedaCliente)) : guardada.lista;
  const vista = clientTabEstado[contId];
  const tope = cuantasVisibles(contId);
  const tarjetas = l => l.slice(0, tope).map(tarjetaCliente).join('') + botonVerMas(contId, l.length - Math.min(tope, l.length));
  _repintar[contId] = () => pintarListaCliente(contId);

  if (busquedaCliente) {
    // Buscando: todas las coincidencias, sin separar por estado
    const halladas = ordenar(lista);
    cont.innerHTML = (halladas.length
      ? `<div class="search-info">${halladas.length} resultado${halladas.length === 1 ? '' : 's'}</div>` + tarjetas(halladas)
      : `<div class="empty-state"><p>No encontramos consultas con “${esc(busquedaCliente)}”</p></div>`) + botonHistorial();
  } else if (vista !== 'Todos') {
    const deLaSolapa = ordenar(lista.filter(c => grupoCliente(c.estado) === vista));
    const t = SOLAPAS_CLIENTE.find(x => x.g === vista);
    cont.innerHTML = (deLaSolapa.length ? tarjetas(deLaSolapa) : `<div class="empty-state"><p>No hay consultas en “${esc(t ? t.label : vista)}”</p></div>`)
      + (vista === 'cerrado' ? botonHistorial() : '');
  } else {
    // Todas: agrupadas, con las cerradas al final
    let html = '', mostradas = 0;
    const seccion = (titulo, l, color) => {
      if (!l.length || mostradas >= tope) return;
      const parte = l.slice(0, tope - mostradas);
      mostradas += parte.length;
      const de = parte.length < l.length ? ` (${parte.length} de ${l.length})` : '';
      html += `<div class="section-label" style="${html ? 'margin-top:20px;' : ''}${color ? 'color:' + color : ''}">${titulo}${de}</div>`;
      html += parte.map(tarjetaCliente).join('');
    };
    const de = g => ordenar(lista.filter(c => grupoCliente(c.estado) === g));
    seccion('Esperan tu respuesta', de('espera'), 'var(--wait)');
    seccion('Pendientes', de('pendiente'));
    seccion('En proceso', de('proceso'));
    seccion('Cerradas', de('cerrado'));
    cont.innerHTML = html + botonVerMas(contId, lista.length - mostradas) + botonHistorial();
  }
  actualizarFab();
}

function elegirSolapaCliente(contId, vista, btn) {
  if (clientTabEstado[contId] === vista) return;
  reiniciarPagina(contId);
  const orden = ['pendiente', 'proceso', 'espera', 'cerrado', 'Todos'];
  const dir = orden.indexOf(vista) > orden.indexOf(clientTabEstado[contId]) ? 1 : -1;
  clientTabEstado[contId] = vista;
  btn.closest('.client-filter').querySelectorAll('.client-chip[data-v]').forEach(b => {
    const act = b === btn;
    b.classList.toggle('active', act);
    b.style.cssText = estiloSolapa(b.dataset.v, act);
  });
  pintarListaCliente(contId);
  entrada($(contId).querySelector('.estado-lista').children, `translateX(${20 * dir}px)`, 35);
}

// Lo que se anima al cargar: las tarjetas, no la barra de solapas
function tarjetasDe(contId) {
  const l = $(contId).querySelector('.estado-lista');
  return (l || $(contId)).children;
}

function buscarCliente(texto) {
  busquedaCliente = texto;
  Object.keys(_listasCliente).forEach(reiniciarPagina);
  const el = $('client-search');
  if (el.value !== texto) el.value = texto;
  el.closest('.search-row').classList.toggle('con-texto', !!texto);
  Object.keys(_listasCliente).forEach(pintarListaCliente);
}

// ── TARJETA ──
function tarjetaCliente(c) {
  const grupo = grupoCliente(c.estado);
  const cerrada = grupo === 'cerrado';
  // Las que preguntamos nosotros van con un borde violeta, para distinguirlas
  const dePlanet = c.direccion === 'planet_a_cliente';
  const estilo = (dePlanet && grupo !== 'espera' ? 'border-left: 3px solid var(--purple);' : '') + (cerrada ? 'opacity:0.7;' : '');
  const clases = 'consulta-card' + (grupo === 'espera' ? ' needs-reply' : '') + (cerradaHacePoco(c) ? ' recien-cerrada' : '')
    + (fueReabierta(c) ? ' reabierta' : '') + openClass('card-' + c.id);

  const mensajes = c.mensajes.map(m => `
      <div class="timeline-item">
        <span class="timeline-who">${esc(m.nombre)}</span>
        <span class="timeline-time">${esc(fmtFecha(m.fecha))}</span>
        ${m.texto ? `<p>${esc(m.texto)}</p>` : ''}
        ${imagenesMsgHtml(m.imagenes)}
      </div>`).join('');

  return `
    <div class="${clases}" style="${estilo}" id="card-${c.id}">
      <div class="consulta-header card-summary" onclick="toggleCard('card-${c.id}')">
        <div class="card-top">
          ${badgeEstado(grupo, true)}
          ${tagReabierta(c)}
          ${cerradaHacePoco(c) ? `<span class="tag-tiempo tag-cerrada">✓ Resuelta ${haceTanto(Date.now() - c.cerrado_en)}</span>` : ''}
          <span class="card-date">${esc(fmtFecha(c.fecha))}</span>
          ${botonCopiar(refDeAsunto(c.asunto), 'Copiar el tracking / referencia')}
          ${CHEVRON}
        </div>
        <div class="card-asunto">${esc(c.asunto)}</div>
      </div>
      <div class="consulta-detail"><div class="msgs-scroll" id="msgs-c${c.id}">${mensajes}</div></div>
      ${cerrada ? '<div class="reabrir-nota">Esta consulta está cerrada. Si escribís, se vuelve a abrir y la vemos de nuevo.</div>' : ''}
      <div class="img-previews reply-previews" id="prev-c${c.id}">${previasHtml('c' + c.id)}</div>
      <div class="reply-box">
        <button type="button" class="attach-btn" onclick="elegirImagenes('c${c.id}')" title="Adjuntar fotos">${CLIP_ICON}</button>
        <input type="text" placeholder="${textoRespuesta(grupo, true)}" id="reply-${c.id}" onkeydown="if(event.key==='Enter')responderCliente(${c.id}, this.nextElementSibling)">
        <button class="reply-send" onclick="responderCliente(${c.id}, this)" title="Enviar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>`;
}

// El "+" de nueva consulta se esconde mientras haya una consulta abierta,
// así no queda encima del botón de enviar
function actualizarFab() {
  const fab = document.querySelector('#screen-client .fab');
  if (fab) fab.classList.toggle('oculto', !!document.querySelector('#screen-client .consulta-card.open'));
}

// ── RESPONDER ──
async function responderCliente(id, btn) {
  const input = $('reply-' + id);
  const texto = input.value.trim();
  const clave = 'c' + id;
  if (input.disabled) return;
  if (!texto && !hayImagenes(clave)) { sacudir(input); input.focus(); return; }
  input.disabled = true;
  await volarAvion(btn);
  const listo = ocupado(btn);
  tarjetaOcupada('card-' + id, true);
  const terminar = () => { tarjetaOcupada('card-' + id, false); listo(); input.disabled = false; };

  const imagenes = hayImagenes(clave) ? await subirImagenes(clave, null) : [];
  if (!imagenes) return terminar();
  const params = { action: 'responder', id, texto };
  if (imagenes.length) params.imagenes = imagenes;
  const res = await api(params);
  terminar();

  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo enviar') + ' — tocá ↻ antes de reenviar');
  input.value = '';
  olvidarImagenes(clave);
  toast(res.reabierta ? '🔄 Consulta reabierta' : '✓ Mensaje enviado');
  aplicarLocal(id, { estado: res.estado }, { autor: sesion.usuario, nombre: sesion.nombre, fecha: ahoraTexto(), texto, imagenes });
  pintarCliente();
  refrescar();
}

// ── NUEVA CONSULTA ──
function abrirNuevaConsultaCliente() {
  const ov = $('modal-new-query');
  ov.classList.add('active');
  anim(ov, { opacity: [0, 1] }, { duracion: 220, mantener: false });
  anim(ov.querySelector('.modal-content'), { transform: ['translateY(100%)', 'translateY(0)'] }, { resorte: [230, 21], mantener: false });
  ['nq-ref', 'nq-tipo', 'nq-mensaje'].forEach(id => { $(id).value = ''; });
  olvidarImagenes('nq');
}
function cerrarNuevaConsultaCliente() {
  const ov = $('modal-new-query'), cont = ov.querySelector('.modal-content');
  if (!ov.classList.contains('active') || ov._cerrando) return;
  ov._cerrando = true;
  Promise.all([
    anim(cont, { transform: ['translateY(0)', 'translateY(100%)'] }, { duracion: 240, easing: 'cubic-bezier(.4,0,1,1)', mantener: false, fill: 'forwards' }),
    anim(ov, { opacity: [1, 0] }, { duracion: 240, mantener: false, fill: 'forwards' })
  ]).then(() => {
    ov.classList.remove('active');
    ov._cerrando = false;
    [ov, cont].forEach(e => e.getAnimations().forEach(a => a.cancel()));
  });
}

async function enviarNuevaConsultaCliente() {
  const referencia = $('nq-ref').value.trim();
  const tipo = $('nq-tipo').value;
  const mensaje = $('nq-mensaje').value.trim();
  if (!referencia || !tipo || !mensaje) {
    toast('Completá el tracking o referencia, el tipo de problema y el mensaje');
    sacudirVacios(['nq-ref', 'nq-tipo', 'nq-mensaje']);
    return;
  }
  const btn = $('nq-send');
  if (btn.disabled) return;
  const listo = ocupado(btn, 'Enviando...');
  toast.cargando(hayImagenes('nq') ? 'Subiendo fotos…' : 'Enviando consulta…');

  const imagenes = hayImagenes('nq') ? await subirImagenes('nq', btn) : [];
  if (!imagenes) return listo();
  const res = await api({
    action: 'nueva_consulta', asunto: armarAsunto(referencia, sesion.cliente, tipo), tipo, mensaje, imagenes
  });
  listo();

  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo crear'));
  olvidarImagenes('nq');
  cerrarNuevaConsultaCliente();
  // Que la vea enseguida: queda en la solapa Pendiente
  if (clientTabEstado['client-list'] !== 'Todos') clientTabEstado['client-list'] = 'pendiente';
  toast('✓ Consulta #' + res.id + ' creada', { desc: 'Planet ya la puede ver. Te avisamos acá cuando respondan.' });
  refrescar();
}

// ── AVISOS DE "RESUELTA" ──
// Si mientras el cliente tiene el portal abierto le cierran una consulta, se lo avisamos en el momento
let _estadosVistos = {};
function avisarCierres(lista) {
  const nuevos = {};
  lista.forEach(c => { nuevos[c.id] = c.estado; });
  lista.forEach(c => {
    const antes = _estadosVistos[c.id];
    if (antes && antes !== 'Cerrado' && c.estado === 'Cerrado') toast('✓ Planet resolvió tu consulta: ' + refDeAsunto(c.asunto));
  });
  _estadosVistos = nuevos;
}

// El aviso verde se muestra hasta que el cliente lo ve: al abrir la consulta o
// al cerrar el aviso de arriba. Las de cierre estimado no se avisan.
const HORAS_CIERRE_RECIENTE = 48;
const claveCierresVistos = () => 'cierres_vistos_' + (sesion ? sesion.usuario : '');
const cierresVistos = () => local.leer(claveCierresVistos(), []);

function marcarCierreVisto(id) {
  const vistos = cierresVistos();
  if (vistos.includes(String(id))) return false;
  vistos.push(String(id));
  local.guardar(claveCierresVistos(), vistos.slice(-200));   // alcanza con los últimos 200
  return true;
}
function marcarTodosLosCierresVistos() {
  consultas.filter(cerradaHacePoco).forEach(c => marcarCierreVisto(c.id));
  pintarCliente();
}
function cierreVistoAlAbrir(id) {
  const c = consultas.find(x => String(x.id) === String(id));
  if (c && cerradaHacePoco(c) && marcarCierreVisto(id)) setTimeout(pintarCliente, 1200);
}
function cerradaHacePoco(c) {
  if (c.estado !== 'Cerrado' || !fechaValida(Number(c.cerrado_en)) || c.cierre_aprox) return false;
  if (cierresVistos().includes(String(c.id))) return false;
  return Date.now() - c.cerrado_en <= HORAS_CIERRE_RECIENTE * HORA_MS;
}
