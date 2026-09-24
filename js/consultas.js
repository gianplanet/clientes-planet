// ═══ CONSULTAS: lo que comparten la vista del cliente y la de Planet ═══

// ── ESTADOS ──
// En la base se guarda un solo estado; cada lado lo ve con su propio nombre.
//   Abierto            → Planet: Pendiente       · Cliente: Pendiente
//   En proceso         → Planet: En proceso      · Cliente: En proceso
//   Esperando info     → Planet: Esperando info  · Cliente: Esperando tu respuesta
//   Respuesta cliente  → Planet: Pendiente       · Cliente: En proceso
//   Cerrado            → los dos: Cerrado
const GRUPOS = {
  pendiente: { label: 'Pendiente',      cls: 'status-Abierto',        stripe: 'urgent',  color: 'var(--warning)' },
  proceso:   { label: 'En proceso',     cls: 'status-En-proceso',     stripe: 'proceso', color: 'var(--info)' },
  espera:    { label: 'Esperando info', cls: 'status-Esperando-info', stripe: 'espera',  color: 'var(--wait)' },
  cerrado:   { label: 'Cerrado',        cls: 'status-Cerrado',        stripe: 'cerrado', color: 'var(--closed)' }
};
const ORDEN_GRUPOS = ['pendiente', 'proceso', 'espera', 'cerrado'];

function grupoPlanet(estado) {
  if (estado === 'En proceso') return 'proceso';
  if (estado === 'Esperando info') return 'espera';
  if (estado === 'Cerrado') return 'cerrado';
  return 'pendiente';   // Abierto y Respuesta cliente
}
function grupoCliente(estado) {
  if (estado === 'En proceso' || estado === 'Respuesta cliente') return 'proceso';
  if (estado === 'Esperando info') return 'espera';
  if (estado === 'Cerrado') return 'cerrado';
  return 'pendiente';
}
function badgeEstado(grupo, paraCliente) {
  const g = GRUPOS[grupo];
  const label = (paraCliente && grupo === 'espera') ? 'Esperando tu respuesta' : g.label;
  return `<span class="ticket-status ${g.cls}">${esc(label)}</span>`;
}
// Estilo de un botón de solapa que no está elegido (borde y letra del color del estado)
function estiloSolapa(grupo, activa) {
  return activa || !GRUPOS[grupo] ? '' : `border-color:${GRUPOS[grupo].color};color:${GRUPOS[grupo].color};`;
}

// ── ASUNTO: referencia · cliente · tipo de problema ──
const TIPOS_PROBLEMA = [
  'No entregado',
  'Demora en la entrega',
  'Dirección incorrecta / cambio de dirección',
  'Reprogramar entrega',
  'Paquete dañado',
  'Paquete faltante / extraviado',
  'Otro'
];
function llenarTiposDeProblema() {
  const html = '<option value="">-- Elegí el tipo de problema --</option>' +
    TIPOS_PROBLEMA.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  document.querySelectorAll('.tipo-select').forEach(sel => { sel.innerHTML = html; });
}
function armarAsunto(referencia, cliente, tipo) {
  // Las partes se separan con " · ": si la referencia trae ese símbolo lo
  // cambiamos por un guion, si no al copiar se cortaría justo ahí.
  const partes = [String(referencia).replace(/\s*·\s*/g, ' - ')];
  if (cliente) partes.push(cliente);
  partes.push(tipo);
  return partes.join(' · ');
}

// Palabras que la gente escribe adelante del dato y que Lightdata no entiende
// ("Tracking 152089", "Venta N° 4521"). Se sacan solo del principio.
const ETIQUETAS_REF = /^(?:(?:tracking|seguimiento|env[ií]o|gu[ií]a|venta|pedido|orden|nro\.?|n[°º]|n[úu]m(?:ero)?\.?|#)\s*[:\-–]?\s*)+/i;

// Lo que se copia de una consulta: lo que escribió el cliente, sin esas etiquetas
function refDeAsunto(asunto) {
  const primera = (String(asunto || '').split(' · ')[0] || '').trim();
  return primera.replace(ETIQUETAS_REF, '').trim() || primera;
}

// ── BOTONES "CARGANDO": evita que se toque varias veces mientras se guarda ──
function ocupado(btn, texto) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  btn.classList.add('btn-loading');
  btn.disabled = true;
  if (texto) btn.textContent = texto;
  return () => { btn.classList.remove('btn-loading'); btn.disabled = false; btn.innerHTML = original; };
}
function tarjetaOcupada(cardId, on) {
  const el = $(cardId);
  if (el) el.classList.toggle('card-busy', on);
}
function indicarActualizando(btnId, on) {
  const b = $(btnId);
  if (b) b.classList.toggle('spinning', on);
}

// ── TARJETAS QUE SE ABREN Y CIERRAN ──
// Las abiertas se recuerdan, así siguen abiertas al volver a dibujar la lista
const openCards = new Set();
function openClass(elId) { return openCards.has(elId) ? ' open' : ''; }

function toggleCard(elId) {
  const el = $(elId);
  if (!el) return;
  // Si el usuario seleccionó texto (para copiarlo), no abrimos ni cerramos
  const sel = window.getSelection && window.getSelection();
  if (sel && String(sel).trim().length > 0) return;
  const abrir = !el.classList.contains('open');
  const h0 = el.offsetHeight;
  el.classList.toggle('open', abrir);
  const h1 = el.offsetHeight;
  if (abrir) openCards.add(elId); else openCards.delete(elId);
  if (abrir) {
    alFinalDeLosMensajes(el);
    if (!esPlanet()) cierreVistoAlAbrir(elId.replace('card-', ''));
  }
  actualizarFab();
  if (SIN_MOVIMIENTO) return;
  // Al cerrar, el contenido sigue visible mientras la tarjeta se achica
  if (!abrir) el.classList.add('open');
  const turno = el._turno = (el._turno || 0) + 1;
  el.style.overflow = 'hidden';
  anim(el, { height: [h0 + 'px', h1 + 'px'] }, abrir ? { resorte: [240, 22], mantener: false } : { duracion: 220, mantener: false })
    .then(() => {
      if (el._turno !== turno) return;
      el.style.overflow = '';
      if (!abrir) el.classList.remove('open');
    });
  if (abrir) entrada(el.querySelectorAll('.timeline-item, .thread-msg, .status-actions, .thread-reply-bar, .reply-box'), 'translateY(8px)', 45);
}

// Al abrir una consulta se muestra lo último que se dijo
function alFinalDeLosMensajes(card) {
  const cont = card && card.querySelector('.msgs-scroll');
  if (!cont) return;
  const alFinal = () => { cont.scrollTop = cont.scrollHeight; };
  alFinal();                       // ya mismo
  requestAnimationFrame(alFinal);  // después de dibujar
  setTimeout(alFinal, 320);        // y al terminar la animación de apertura
}

// ── COPIAR (el tracking o la referencia, para pegar en Lightdata) ──
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
const CHEVRON = '<svg class="card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function botonCopiar(texto, titulo) {
  return `<button type="button" class="copy-btn" data-copiar="${esc(texto)}" title="${esc(titulo || 'Copiar')}">${COPY_ICON}</button>`;
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    // Navegadores viejos o sin permiso: copiamos con un campo auxiliar
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { toast('No se pudo copiar'); }
    ta.remove();
  }
  toast('✓ Copiado');
}

// El botón copiar no debe abrir ni cerrar la tarjeta
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.copy-btn');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  copiarTexto(b.dataset.copiar || '');
}, true);

// ── DE A 20 POR VEZ ──
// Con muchos clientes la lista se hace larguísima: se muestran de a 20 y el
// resto se agrega con "Ver más".
const PAGINA = 20;
const visibles = {};        // cuántas tarjetas se muestran en cada lista
const _repintar = {};       // cómo volver a dibujar cada lista
function cuantasVisibles(id) { return visibles[id] || PAGINA; }
function reiniciarPagina(id) { visibles[id] = PAGINA; }
function verMas(id) {
  visibles[id] = cuantasVisibles(id) + PAGINA;
  if (_repintar[id]) _repintar[id]();
}
function botonVerMas(id, restantes) {
  if (restantes <= 0) return '';
  const proximas = Math.min(PAGINA, restantes);
  return `<button class="ver-mas" onclick="verMas(${jsArg(id)})">Ver ${proximas} más <span>(${restantes} sin mostrar)</span></button>`;
}
// Al final de las cerradas: las de hace más de 60 días se piden aparte
function botonHistorial() {
  if (historialCompleto) return '';
  return '<button class="ver-mas ver-historial" onclick="cargarHistorial(this)">Ver historial completo <span>(cerradas de hace más de 60 días)</span></button>';
}

// ── BUSCAR Y ORDENAR ──
// ¿La consulta tiene todas las palabras buscadas? (en el asunto, el cliente, el número o los mensajes)
function coincide(c, q) {
  if (!q) return true;
  return normalizar(q).split(/\s+/).filter(Boolean).every(p => c._busqueda.indexOf(p) >= 0);
}

let ordenNuevasPrimero = local.leer('planet_orden', 1) !== 0;   // true: más recientes arriba
// Por última actividad (último mensaje o alta); a igualdad, por número
function ordenar(lista) {
  const signo = ordenNuevasPrimero ? -1 : 1;
  return lista.slice().sort((a, b) => signo * ((a._actividad - b._actividad) || (a.id - b.id)));
}
function chipOrden() {
  return `<button class="client-chip orden-chip" onclick="cambiarOrden()" title="Cambiar el orden: por última actividad">${textoOrden()}</button>`;
}
function textoOrden() { return ordenNuevasPrimero ? '↓ Más recientes' : '↑ Más antiguas'; }
function cambiarOrden() {
  ordenNuevasPrimero = !ordenNuevasPrimero;
  local.guardar('planet_orden', ordenNuevasPrimero ? 1 : 0);
  toast(ordenNuevasPrimero ? 'Primero las más recientes' : 'Primero las más antiguas');
  pintar();
}

// ── NOVEDADES: consultas nuevas o con mensajes nuevos entran resaltadas ──
let _vistos = null;  // id → { n: cantidad de mensajes, estado }
function marcarNovedades(lista, prefijo) {
  const antes = _vistos;
  _vistos = new Map(lista.map(c => [String(c.id), { n: c.mensajes.length, estado: c.estado }]));
  if (!antes) return;
  lista.forEach(c => {
    const id = String(c.id), el = $(prefijo + id);
    if (!el) return;
    const a = antes.get(id), ahora = _vistos.get(id);
    if (!a) return resaltar(el);
    if (ahora.n > a.n && el.classList.contains('open')) {
      const msgs = el.querySelectorAll('.timeline-item, .thread-msg');
      entrada(Array.from(msgs).slice(-(ahora.n - a.n)), 'translateY(8px) scale(0.97)', 60);
    } else if (ahora.n > a.n || ahora.estado !== a.estado) {
      resaltar(el);
    }
  });
}

// ── AVISOS POR TIEMPO (horas corridas, igual que las métricas) ──
const HORAS_DEMORA = 24;    // amarillo
const HORAS_URGENTE = 48;   // rojo

// Cuándo entró la consulta; 0 si no se sabe (no inventamos una antigüedad)
function altaEnMs(c) {
  const primero = (c.mensajes || [])[0];
  return fechaMs(Number(c.creado_en)) || fechaMs(c.fecha) || (primero ? fechaMs(primero.fecha) : 0);
}

function tagTiempo(c, grupo) {
  if (grupo === 'cerrado') return '';
  const alta = altaEnMs(c);
  if (!alta) return '';
  const edad = Date.now() - alta;
  if (grupo === 'espera') {
    return edad >= HORAS_URGENTE * HORA_MS
      ? `<span class="tag-tiempo espera">⏳ ${fmtDuracion(edad)} esperando al cliente</span>` : '';
  }
  if (edad >= HORAS_URGENTE * HORA_MS) return `<span class="tag-tiempo urgente">⏰ ${fmtDuracion(edad)} sin resolver</span>`;
  if (edad >= HORAS_DEMORA * HORA_MS) return `<span class="tag-tiempo demora">⏰ ${fmtDuracion(edad)} abierta</span>`;
  return '';
}

// Una consulta que estaba cerrada y volvió a abrirse: se marca mientras siga abierta
function fueReabierta(c) { return !!c.reabierta_en && c.estado !== 'Cerrado'; }
function tagReabierta(c) {
  if (!fueReabierta(c)) return '';
  const cuando = fechaMs(Number(c.reabierta_en));
  return `<span class="tag-tiempo tag-reabierta">🔄 Reabierta${cuando ? ' ' + haceTanto(Date.now() - cuando) : ''}</span>`;
}

// ── HTML COMÚN DE LOS MENSAJES ──
function textoRespuesta(grupo, paraCliente) {
  if (grupo === 'cerrado') return 'Escribí para reabrir esta consulta…';
  if (paraCliente) return grupo === 'espera' ? 'Escribí la info que pide Planet...' : 'Responder...';
  return 'Responder... (podés pegar fotos con Ctrl+V)';
}
