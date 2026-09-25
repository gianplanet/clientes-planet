// ═══ VISTA DE PLANET ═══
// Una sola lista de consultas (las que nos hacen los clientes y las que les
// hacemos nosotros), Métricas, Nueva consulta y, para admins, Clientes y Usuarios.

let filtroCliente = 'Todos';          // cliente elegido en Consultas
let filtroEstado = 'pendiente';       // al entrar, lo que hay que atender
let busquedaPlanet = '';

// Las que nos hacen los clientes: las métricas miden solo esas
const recibidas = () => consultas.filter(c => c.direccion === 'cliente_a_planet');

function abrirVistaPlanet() {
  $('planet-name').textContent = sesion.nombre;
  $('planet-role').textContent = 'Planet · ' + (sesion.role === 'admin' ? 'Admin' : 'Usuario');
  $('planet-avatar').textContent = (sesion.nombre || '?')[0];
  $('planet-avatar').style.background = avatarColor(sesion.nombre);
  // Métricas, Clientes y Usuarios son cosa de admins
  ['admin-sep', 'metricas-btn', 'admin-clientes-btn', 'admin-btn'].forEach(id => { $(id).hidden = sesion.role !== 'admin'; });
  mostrarPantalla('screen-planet');
  acomodarIndicadores();
  if (!notasData.length) setNotas(local.leer(claveNotas()) || []);
  pintarNotas();
  cargarClientesRegistrados();
}

function pintarPlanet() {
  const primeraVez = !datosMostrados;
  datosMostrados = true;

  actualizarClientesNuevaConsulta();

  // Resumen (todas: las que nos hacen y las que les hacemos)
  const cuenta = g => consultas.filter(c => grupoPlanet(c.estado) === g).length;
  const pendientes = cuenta('pendiente');
  $('planet-stats').innerHTML = ORDEN_GRUPOS.map(g => `
    <div class="stat-card"><div class="stat-number" style="color:${GRUPOS[g].color}">${cuenta(g)}</div><div class="stat-label">${g === 'pendiente' ? 'Pendientes' : g === 'cerrado' ? 'Cerradas' : GRUPOS[g].label}</div></div>`).join('');
  rodarNumeros('planet-stats');

  // Globito del menú: lo que requiere atención de Planet
  ponerContador($('sb-consultas'), pendientes + cuenta('proceso'));

  $('planet-alert').innerHTML = avisosPlanet(consultas, pendientes);
  pintarFiltrosPlanet();
  pintarListaPlanet();

  if (primeraVez) entrada($('planet-consultas-list').children);
  marcarNovedades(consultas, 'tcard-');
}

function avisosPlanet(rec, pendientes) {
  const s = n => n > 1 ? 's' : '';
  const reabiertas = rec.filter(fueReabierta).length;
  // Las que esperan al cliente no cuentan como demoradas nuestras
  const demoradas = rec.filter(c => {
    const g = grupoPlanet(c.estado), alta = altaEnMs(c);
    return g !== 'cerrado' && g !== 'espera' && alta && Date.now() - alta >= HORAS_URGENTE * HORA_MS;
  }).length;
  let html = '';
  if (pendientes) html += `
    <div class="alert-banner alert-danger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span><strong>${pendientes} consulta${s(pendientes)} pendiente${s(pendientes)}</strong> sin atender</span>
    </div>`;
  if (reabiertas) html += `
    <div class="alert-banner alert-info">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      <span><strong>${reabiertas} consulta${s(reabiertas)} reabierta${s(reabiertas)}</strong> ${reabiertas > 1 ? 'volvieron' : 'volvió'} a la bandeja</span>
    </div>`;
  if (demoradas) html += `
    <div class="alert-banner alert-warning">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <span><strong>${demoradas} consulta${demoradas > 1 ? 's llevan' : ' lleva'} más de ${HORAS_URGENTE} h</strong> sin resolver</span>
    </div>`;
  return html;
}

// ── FILTROS ──
function pintarFiltrosPlanet() {
  const chip = (g, icono) => {
    const act = filtroEstado === g;
    return `<button class="client-chip ${act ? 'active' : ''}" onclick="elegirEstado(${jsArg(g)})" style="${estiloSolapa(g, act)}">${icono} ${GRUPOS[g].label}</button>`;
  };
  $('planet-estado-filter').innerHTML =
    chip('pendiente', '⏳') + chip('proceso', '🔄') + chip('espera', '💬') + chip('cerrado', '✓') +
    `<button class="client-chip ${filtroEstado === 'Todos' ? 'active' : ''}" onclick="elegirEstado('Todos')">Todos</button>` + chipOrden();

  // Hasta 6 clientes van como botones; con más, un desplegable
  const nombres = [...new Set(consultas.map(c => c.cliente))].sort();
  if (nombres.length > 6) {
    const cuenta = n => consultas.filter(c => c.cliente === n).length;
    $('planet-filter').innerHTML = `
      <select class="cliente-select" onchange="elegirCliente(this.value)">
        <option value="Todos"${filtroCliente === 'Todos' ? ' selected' : ''}>Todos los clientes (${consultas.length})</option>
        ${nombres.map(n => `<option value="${esc(n)}"${filtroCliente === n ? ' selected' : ''}>${esc(n)} (${cuenta(n)})</option>`).join('')}
      </select>`;
  } else {
    $('planet-filter').innerHTML = nombres.concat('Todos').map(n =>
      `<button class="client-chip ${filtroCliente === n ? 'active' : ''}" onclick="elegirCliente(${jsArg(n)})">${esc(n)}</button>`).join('');
  }
}

function elegirCliente(nombre) {
  filtroCliente = nombre;
  cambiarFiltro();
}
function elegirEstado(g) {
  filtroEstado = g;
  cambiarFiltro();
}
function cambiarFiltro() {
  reiniciarPagina('planet-consultas-list');
  pintarFiltrosPlanet();
  pintarListaPlanet();
  entrada($('planet-consultas-list').children, 'translateY(8px)', 30);
}

// ── BUSCADOR ──
function buscarPlanet(texto) {
  busquedaPlanet = texto;
  reiniciarPagina('planet-consultas-list');
  const el = $('planet-search');
  if (el.value !== texto) el.value = texto;
  el.closest('.search-row').classList.toggle('con-texto', !!texto);
  pintarListaPlanet();
}

// ── LISTA ──
function pintarListaPlanet() {
  let lista = consultas;
  if (filtroCliente !== 'Todos') lista = lista.filter(c => c.cliente === filtroCliente);
  if (filtroEstado !== 'Todos') lista = lista.filter(c => grupoPlanet(c.estado) === filtroEstado);
  if (busquedaPlanet) lista = lista.filter(c => coincide(c, busquedaPlanet));

  const info = $('planet-search-info');
  info.hidden = !busquedaPlanet;
  info.textContent = busquedaPlanet ? `${lista.length} resultado${lista.length === 1 ? '' : 's'} para “${busquedaPlanet}”` : '';

  const cont = $('planet-consultas-list');
  _repintar['planet-consultas-list'] = pintarListaPlanet;
  const verHistorial = busquedaPlanet || filtroEstado === 'cerrado' || filtroEstado === 'Todos';
  if (!lista.length) {
    const conFiltro = filtroCliente !== 'Todos' || filtroEstado !== 'Todos' || busquedaPlanet;
    cont.innerHTML = `<div class="empty-state"><p>No hay consultas${conFiltro ? ' con ese filtro' : ''}</p></div>` + (verHistorial ? botonHistorial() : '');
    return;
  }
  cont.innerHTML = listaPorGrupos(lista, 'planet-consultas-list') + (verHistorial ? botonHistorial() : '');
}

// Lista agrupada: Pendientes → En proceso → Esperando info → Cerradas
function listaPorGrupos(lista, contId) {
  const titulos = {
    pendiente: 'Pendientes — requieren atención',
    proceso: 'En proceso',
    espera: 'Esperando al cliente',
    cerrado: 'Cerradas'
  };
  const tope = cuantasVisibles(contId);
  let mostradas = 0, html = '';
  ORDEN_GRUPOS.forEach(g => {
    const delGrupo = ordenar(lista.filter(c => grupoPlanet(c.estado) === g));
    if (!delGrupo.length || mostradas >= tope) return;
    const parte = delGrupo.slice(0, tope - mostradas);
    mostradas += parte.length;
    const color = g === 'pendiente' ? 'var(--danger)' : g === 'cerrado' ? '' : GRUPOS[g].color;
    const de = parte.length < delGrupo.length ? ` (${parte.length} de ${delGrupo.length})` : '';
    html += `<div class="section-label" style="${html ? 'margin-top:20px;' : ''}${color ? 'color:' + color : ''}">${titulos[g]}${de}</div>`;
    html += parte.map(tarjetaPlanet).join('');
  });
  return html + botonVerMas(contId, lista.length - mostradas);
}

// ── TARJETA ──
// Qué se puede hacer con una consulta según en qué grupo está
const ACCIONES_ESTADO = {
  pendiente: [['En proceso', 'btn-proceso', 'Tomar → En proceso'], ['Cerrado', 'btn-cerrar', 'Cerrar']],
  proceso: [['Cerrado', 'btn-cerrar', 'Cerrar']],
  espera: [['En proceso', 'btn-proceso', 'Retomar → En proceso'], ['Cerrado', 'btn-cerrar', 'Cerrar']],
  cerrado: [['En proceso', 'btn-proceso', 'Reabrir']],
};

function tarjetaPlanet(c) {
  const grupo = grupoPlanet(c.estado);
  const cerrada = grupo === 'cerrado';
  const cardId = 'tcard-' + c.id;
  // Las que preguntamos nosotros se marcan; las del cliente son lo habitual
  const nuestra = c.direccion === 'planet_a_cliente';

  const mensajes = c.mensajes.map(m => {
    const quien = m.nombre || m.autor || '?';
    return `
        <div class="thread-msg">
          <div class="thread-avatar" style="background:${avatarColor(quien)}">${esc(quien[0])}</div>
          <div class="thread-content">
            <div class="thread-meta">
              <span class="thread-name">${esc(quien)}</span>
              <span class="thread-time">${esc(fmtFecha(m.fecha))}</span>
            </div>
            ${m.texto ? `<div class="thread-text">${esc(m.texto)}</div>` : ''}
            ${imagenesMsgHtml(m.imagenes)}
          </div>
        </div>`;
  }).join('');

  // También se puede escribir en una cerrada: ese mensaje la reabre
  const respuesta = `
      <div class="img-previews thread-previews" id="prev-p${c.id}">${previasHtml('p' + c.id)}</div>
      <div class="thread-reply-bar">
        <button type="button" class="attach-btn" onclick="elegirImagenes('p${c.id}')" title="Adjuntar fotos">${CLIP_ICON}</button>
        <input class="thread-reply-input" placeholder="${textoRespuesta(grupo, false)}" id="preply-${c.id}" onkeydown="if(event.key==='Enter')responderPlanet(${c.id}, false, this.nextElementSibling)">
        <button class="thread-reply-btn" onclick="responderPlanet(${c.id}, false, this)" title="${cerrada ? 'Envía el mensaje y reabre la consulta' : 'Envía el mensaje; la consulta queda En proceso'}">${cerrada ? 'Enviar y reabrir' : 'Enviar'}</button>
        ${cerrada ? '' : `<button class="thread-reply-btn btn-wait" onclick="responderPlanet(${c.id}, true, this)" title="Envía el mensaje y pasa la consulta a Esperando info">Enviar y pedir info</button>`}
      </div>`;

  const acciones = ACCIONES_ESTADO[grupo].map(([estado, cls, texto]) =>
    `<button class="status-btn ${cls}" onclick="cambiarEstado(${c.id}, ${jsArg(estado)}, this)">${texto}</button>`).join('');

  return `
    <div class="ticket-card${fueReabierta(c) ? ' reabierta' : ''}${openClass(cardId)}" id="${cardId}">
      <div class="ticket-stripe ${GRUPOS[grupo].stripe}"></div>
      <div class="ticket-body">
        <div class="card-summary" onclick="toggleCard('${cardId}')">
          <div class="card-top">
            ${badgeEstado(grupo, false)}
            ${nuestra ? '<span class="ticket-direction-tag dir-outgoing">→ Nuestra consulta</span>' : ''}
            <span class="card-date">${esc(fmtFecha(c.fecha))}</span>
            ${c.estado === 'Respuesta cliente' ? '<span class="tag-respondio">💬 Respondió el cliente</span>' : ''}
            ${tagReabierta(c)}
            ${tagTiempo(c, grupo)}
            <span class="ticket-client-tag" style="--tono:${tonoCliente(c.cliente)}">${esc(c.cliente)}</span>
            ${botonCopiar(refDeAsunto(c.asunto), 'Copiar el tracking / referencia')}
            ${CHEVRON}
          </div>
          <div class="card-asunto">${esc(c.asunto)}</div>
        </div>
        <div class="ticket-details">
          <div class="ticket-footer" style="margin-bottom:6px;">
            <span class="ticket-tracking">#${c.id}</span>
            <span class="ticket-who">${c.nombre_creador ? 'Crea: ' + esc(c.nombre_creador) : ''}${c.atendido_por ? ' · Atiende: ' + esc(c.atendido_por) : ''}</span>
          </div>
          <div class="ticket-thread"><div class="msgs-scroll" id="msgs-p${c.id}">${mensajes}</div>${respuesta}</div>
          <div class="status-actions">${acciones}</div>
        </div>
      </div>
    </div>`;
}

// ── RESPONDER Y CAMBIAR ESTADO ──
async function responderPlanet(id, pedirInfo, btn) {
  const input = $('preply-' + id);
  const texto = input.value.trim();
  const clave = 'p' + id;
  if (input.disabled) return;
  if (!texto && !hayImagenes(clave)) {
    toast(pedirInfo ? 'Escribí qué info necesitás del cliente' : 'Escribí un mensaje');
    sacudir(input); input.focus(); return;
  }
  const cardId = 'tcard-' + id;
  input.disabled = true;
  const listo = ocupado(btn, 'Enviando...');
  tarjetaOcupada(cardId, true);
  const terminar = () => { tarjetaOcupada(cardId, false); listo(); input.disabled = false; };

  const imagenes = hayImagenes(clave) ? await subirImagenes(clave, btn) : [];
  if (!imagenes) return terminar();
  const params = { action: 'responder', id, texto };
  if (imagenes.length) params.imagenes = imagenes;
  if (pedirInfo) params.esperar_info = '1';
  const res = await api(params);
  terminar();

  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo enviar') + ' — tocá ↻ antes de reenviar');
  input.value = '';
  olvidarImagenes(clave);
  toast(res.reabierta ? '🔄 Consulta reabierta' : pedirInfo ? '✓ Mensaje enviado · Esperando info del cliente' : '✓ Mensaje enviado');
  aplicarLocal(id, { estado: res.estado, atendido_por: sesion.nombre },
    { autor: sesion.usuario, nombre: sesion.nombre, fecha: ahoraTexto(), texto, imagenes });
  pintarPlanet();
  refrescar();
}

async function cambiarEstado(id, estado, btn) {
  const cardId = 'tcard-' + id;
  const listo = ocupado(btn, estado === 'Cerrado' ? 'Cerrando...' : 'Guardando...');
  tarjetaOcupada(cardId, true);
  const res = await api({ action: 'cambiar_estado', id, estado });
  tarjetaOcupada(cardId, false);
  listo();
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo cambiar'));
  toast('✓ Estado cambiado a ' + GRUPOS[grupoPlanet(estado)].label);
  aplicarLocal(id, { estado, atendido_por: sesion.nombre });
  pintarPlanet();
  refrescar();
}

// ── NUEVA CONSULTA A UN CLIENTE ──
let clientesRegistrados = [];   // los dados de alta en "Clientes"
let _clientesCargados = false;

async function cargarClientesRegistrados() {
  if (_clientesCargados) return;
  _clientesCargados = true;
  const res = await api({ action: 'clientes' });
  if (!res.ok) { _clientesCargados = false; return; }
  clientesRegistrados = res.clientes || [];
  actualizarClientesNuevaConsulta();
  llenarEmpresasUsuario();
}

// La lista de clientes del formulario. Solo se vuelve a armar si cambió, y
// sin perder el cliente elegido: antes la actualización automática lo
// devolvía al primero y la consulta se podía ir al cliente equivocado.
function actualizarClientesNuevaConsulta() {
  const sel = $('pnq-cliente');
  const nombres = clientesRegistrados.length
    ? clientesRegistrados.map(c => c.nombre).sort()
    : [...new Set(consultas.map(c => c.cliente))].filter(Boolean).sort();
  const firmaLista = nombres.join('\n');
  if (sel.dataset.lista === firmaLista) return;
  const elegido = sel.value;
  sel.innerHTML = '<option value="">-- Elegí el cliente --</option>' +
    nombres.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.dataset.lista = firmaLista;
  if (nombres.includes(elegido)) sel.value = elegido;
}

async function enviarNuevaConsultaPlanet() {
  const cliente = $('pnq-cliente').value;
  const referencia = $('pnq-ref').value.trim();
  const tipo = $('pnq-tipo').value;
  const mensaje = $('pnq-mensaje').value.trim();
  if (!referencia || !tipo || !mensaje || !cliente) {
    toast('Completá el cliente, el tracking o referencia, el tipo de problema y el mensaje');
    sacudirVacios(['pnq-cliente', 'pnq-ref', 'pnq-tipo', 'pnq-mensaje']);
    return;
  }
  const btn = $('pnq-send');
  if (btn.disabled) return;
  const listo = ocupado(btn, 'Enviando...');
  toast.cargando(hayImagenes('pnq') ? 'Subiendo fotos…' : 'Enviando consulta…');

  const imagenes = hayImagenes('pnq') ? await subirImagenes('pnq', btn) : [];
  if (!imagenes) return listo();
  const res = await api({
    action: 'nueva_consulta', asunto: armarAsunto(referencia, cliente, tipo), tipo, cliente,
    direccion: 'planet_a_cliente', mensaje, imagenes
  });
  listo();

  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo enviar'));
  ['pnq-cliente', 'pnq-ref', 'pnq-tipo', 'pnq-mensaje'].forEach(id => { $(id).value = ''; });
  olvidarImagenes('pnq');
  toast('✓ Consulta #' + res.id + ' enviada', { desc: cliente + ' la va a ver en su portal.' });
  // Queda en la misma lista, esperando al cliente: la mostramos ahí
  filtroEstado = 'espera';
  filtroCliente = 'Todos';
  irA('planet-consultas');
  cambiarFiltro();
  refrescar();
}

// ── MENÚ LATERAL ──
function irA(id) {
  const btn = document.querySelector(`.sidebar-item[data-seccion="${id}"]`);
  const yaEstaba = $(id).classList.contains('active');
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b === btn));
  moverIndicador(btn.closest('.sidebar'), btn, true);
  document.querySelectorAll('#screen-planet .planet-sub').forEach(s => s.classList.toggle('active', s.id === id));
  if (!yaEstaba) anim($(id), { opacity: [0, 1], transform: ['translateY(8px)', 'none'] }, { duracion: 320, mantener: false });
  if (id === 'planet-usuarios') cargarUsuarios();
  if (id === 'planet-clientes') cargarClientes();
  if (id === 'planet-metricas') cargarMetricas();
}

// ── RESUMEN DE TURNO ──
// Cuando alguien de Planet entra (arranca el turno) le mostramos cómo está la
// bandeja: lo que falta atender, lo que lleva demasiado y lo que se reabrió.
// No se repite si vuelve a entrar al rato: es para el cambio de turno.
const HORAS_TURNO = 6;
const claveTurno = () => 'turno_visto_' + (sesion ? sesion.usuario : '');
let _turnoPendiente = false;

// recienEntro: puso usuario y contraseña. Si no, es la sesión que quedó abierta.
function pedirResumenDeTurno(recienEntro) {
  if (!esPlanet()) return;
  _turnoPendiente = recienEntro || Date.now() - (local.leer(claveTurno(), 0) || 0) > HORAS_TURNO * HORA_MS;
}

function resumenDeTurno() {
  const ahora = Date.now();
  const edad = c => { const alta = altaEnMs(c); return alta ? ahora - alta : 0; };
  const por = g => consultas.filter(c => grupoPlanet(c.estado) === g);
  const pendientes = por('pendiente'), proceso = por('proceso'), espera = por('espera');
  const atender = pendientes.concat(proceso);
  return {
    pendientes, proceso, espera,
    reabiertas: consultas.filter(fueReabierta),
    viejas: atender.filter(c => edad(c) >= HORAS_URGENTE * HORA_MS),
    masVieja: atender.reduce((m, c) => Math.max(m, edad(c)), 0)
  };
}

function mostrarResumenTurno() {
  if (!_turnoPendiente || !esPlanet()) return;
  _turnoPendiente = false;
  local.guardar(claveTurno(), Date.now());

  const r = resumenDeTurno();
  // Si no hay nada esperando por nosotros no le tapamos la pantalla con una ventana
  if (!r.pendientes.length && !r.proceso.length && !r.reabiertas.length) {
    return toast('✓ Todo al día', { desc: 'No hay consultas esperando respuesta nuestra.' });
  }

  const dias = HORAS_URGENTE / 24;
  const fila = (n, color, titulo, detalle) => !n ? '' : `
    <div class="turno-fila">
      <span class="turno-num" style="color:${color}">${n}</span>
      <div class="turno-texto"><strong>${titulo}</strong>${detalle ? `<span>${detalle}</span>` : ''}</div>
    </div>`;

  let detalle = '';
  if (r.viejas.length) detalle = `${r.viejas.length} lleva${r.viejas.length > 1 ? 'n' : ''} más de ${dias} días${r.masVieja ? ' · la más vieja, ' + haceTanto(r.masVieja) : ''}`;
  else if (r.masVieja) detalle = 'la más vieja, ' + haceTanto(r.masVieja);

  $('turno-titulo').textContent = 'Hola, ' + (sesion.nombre || '') + ' 👋';
  $('turno-sub').textContent = 'Así está la bandeja ahora:';
  $('turno-filas').innerHTML =
    fila(r.pendientes.length, 'var(--warning)', 'Pendientes sin atender', detalle) +
    fila(r.proceso.length, 'var(--info)', 'En proceso', 'ya las tomó alguien') +
    fila(r.reabiertas.length, 'var(--purple)', r.reabiertas.length > 1 ? 'Reabiertas' : 'Reabierta', 'el cliente volvió a escribir') +
    fila(r.espera.length, 'var(--wait)', 'Esperando al cliente', 'no hace falta hacer nada');
  $('turno-acciones').innerHTML = `
    <button class="turno-despues" onclick="cerrarResumenTurno()">Después</button>
    <button class="btn-primary" onclick="irAPendientesDelTurno()">${r.pendientes.length ? 'Ver las pendientes' : 'Ver la bandeja'}</button>`;
  abrirModal('modal-turno');
}

function cerrarResumenTurno() { cerrarModal('modal-turno'); }

function irAPendientesDelTurno() {
  cerrarResumenTurno();
  filtroCliente = 'Todos';
  filtroEstado = consultas.some(c => grupoPlanet(c.estado) === 'pendiente') ? 'pendiente' : 'Todos';
  irA('planet-consultas');
  cambiarFiltro();
}
