// ═══ POST-ITS DE PLANET ═══
// Cada usuario de Planet pega sus notas donde quiera sobre la pantalla y las arrastra (son personales).
// Con el pin quedan fijas en la pantalla y te siguen al bajar; sin pin quedan pegadas en ese lugar de la página.
// Se guardan en el servidor con su posición: x = fracción del ancho, y = píxeles desde arriba.
const NOTA_COLORES = ['amarillo', 'rosa', 'verde', 'celeste', 'violeta'];
const NOTA_ANCHO = 210;
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z"/></svg>';
const CRUZ_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ACHICAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const AGRANDAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const GRIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
let notasData = [];
let _notaTmp = 0;
let _repintarNotas = false;
let _arrastrando = false;
let _zNota = 1;

function claveNotas() { return 'planet_notas_' + (sesion ? sesion.usuario : ''); }
function notaPorId(id) { return notasData.find(n => String(n.id) === String(id)); }
function notaDe(el) { const c = el && el.closest('[data-id]'); return c ? notaPorId(c.dataset.id) : null; }
function elNota(n) { return n ? document.querySelector(`#notas-capa .postit[data-id="${n.id}"]`) : null; }
function capaNotas() { return $('notas-capa'); }
// Posición de la nota en la ventana, calculada con su lugar guardado (sin la inclinación ni animaciones)
function posEnVentana(el, n) {
  const o = origenCapa(), l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
  return n.pin ? { left: l, top: t } : { left: l + o.left - window.scrollX, top: t + o.top - window.scrollY };
}
function origenCapa() { const r = capaNotas().getBoundingClientRect(); return { left: r.left + window.scrollX, top: r.top + window.scrollY }; }

// Junta lo que llega del servidor con lo local: una nota que se está editando o guardando no se pisa
function setNotas(lista) {
  if (!Array.isArray(lista)) return;
  const locales = new Map(notasData.map(n => [String(n.id), n]));
  const nuevas = lista.map(n => {
    const l = locales.get(String(n.id));
    if (!l) return n;
    if (l._borrada) return null;
    if (l._sucio || l._guardando || l._creando) return l;
    return Object.assign(l, n);
  }).filter(Boolean);
  notasData.filter(n => String(n.id).indexOf('tmp') === 0).forEach(n => nuevas.push(n));
  notasData = nuevas;
  local.guardar(claveNotas(), lista);
  pintarNotas();
}

function htmlNota(n) {
  const h = String(n.id).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rot = ((h % 5) - 2) * 0.6;
  const colores = NOTA_COLORES.map(c =>
    `<button class="nota-color nota-${c}${n.color === c ? ' on' : ''}" onclick="notaColor(this,'${c}')" title="Color ${c}" aria-label="Color ${c}"></button>`).join('');
  const resumen = String(n.texto || '').trim().split('\n')[0];
  return `
    <div class="postit nota-${n.color || 'amarillo'}${n.pin ? ' fija' : ''}${n.min ? ' min' : ''}" data-id="${esc(String(n.id))}" style="--rot:${rot}deg" onpointerdown="traerAlFrente(this)">
      <div class="postit-barra" onpointerdown="arrastrarNota(event)" title="Arrastrá para mover la nota">
        <span class="postit-grip">${GRIP_ICON}</span>
        <button class="nota-btn nota-pin${n.pin ? ' on' : ''}" onclick="notaPin(this)" aria-pressed="${n.pin ? 'true' : 'false'}"
          title="${n.pin ? 'Quitar el pin (vuelve a quedar pegada en la página)' : 'Fijar en la pantalla (te sigue al bajar)'}">${PIN_ICON}</button>
        <button class="nota-btn" onclick="notaMin(this)" title="${n.min ? 'Agrandar' : 'Achicar'}">${n.min ? AGRANDAR_ICON : ACHICAR_ICON}</button>
        <button class="nota-btn" onclick="notaBorrar(this)" title="Borrar nota">${CRUZ_ICON}</button>
      </div>
      <textarea class="postit-texto" placeholder="Escribí tu nota..." aria-label="Texto de la nota" oninput="notaEscribir(this)" onblur="notaGuardarYa(this)">${esc(n.texto || '')}</textarea>
      <div class="postit-resumen" onclick="notaMin(this)" title="Tocá para agrandar">${resumen ? esc(resumen) : '<i style="opacity:.6">(nota vacía)</i>'}</div>
      <div class="postit-pie">
        <div class="nota-colores">${colores}</div>
        <span class="nota-estado"></span>
      </div>
    </div>`;
}

// Coloca la nota en su lugar, sin dejar que quede fuera de la pantalla
function ubicarNota(el, n) {
  const capa = capaNotas();
  if (!el || !n || !capa || !capa.offsetWidth) return;
  const W = n.pin ? window.innerWidth : capa.offsetWidth;
  const w = el.offsetWidth || NOTA_ANCHO;
  const x = n.x == null || isNaN(n.x) ? 0.72 : Number(n.x);
  const y = n.y == null || isNaN(n.y) ? 110 : Number(n.y);
  el.style.left = Math.min(Math.max(8, x * W), Math.max(8, W - w - 8)) + 'px';
  el.style.top = (n.pin ? Math.min(Math.max(8, y), window.innerHeight - 48) : Math.max(8, y)) + 'px';
}

function pintarNotas() {
  const capa = capaNotas();
  if (!capa) return;
  // No se repinta mientras se arrastra o se escribe (se perdería el foco); se repinta después
  const escribiendo = capa.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
  if (_arrastrando || escribiendo || !capa.offsetWidth) { _repintarNotas = true; return; }
  _repintarNotas = false;
  capa.innerHTML = notasData.filter(n => !n._borrada).map(htmlNota).join('');
  capa.querySelectorAll('.postit').forEach(el => ubicarNota(el, notaDe(el)));
}
document.addEventListener('focusout', e => {
  const capa = capaNotas();
  if (!_repintarNotas || !capa || !capa.contains(e.target)) return;
  setTimeout(() => { if (!capa.contains(document.activeElement)) pintarNotas(); }, 0);
});
window.addEventListener('resize', () => {
  document.querySelectorAll('#notas-capa .postit').forEach(el => ubicarNota(el, notaDe(el)));
});

function traerAlFrente(el) { if (el) el.style.zIndex = ++_zNota; }

// Arrastrar desde la barra de arriba (mouse o dedo)
function arrastrarNota(e) {
  if (e.target.closest('button')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = e.currentTarget.closest('.postit'), n = notaDe(el);
  if (!n) return;
  e.preventDefault();
  traerAlFrente(el);
  const r = posEnVentana(el, n), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const o = origenCapa();
  let movio = false;
  _arrastrando = true;
  el.classList.add('arrastrando');
  const mover = ev => {
    movio = true;
    const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - el.offsetWidth);
    const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 40);
    if (n.pin) { el.style.left = left + 'px'; el.style.top = top + 'px'; }
    else { el.style.left = (left + window.scrollX - o.left) + 'px'; el.style.top = (top + window.scrollY - o.top) + 'px'; }
  };
  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    window.removeEventListener('pointercancel', soltar);
    el.classList.remove('arrastrando');
    _arrastrando = false;
    if (movio) {
      const W = n.pin ? window.innerWidth : capaNotas().offsetWidth;
      n.x = parseFloat(el.style.left) / W;
      n.y = parseFloat(el.style.top);
      guardarNota(n, { x: n.x.toFixed(4), y: Math.round(n.y) });
    }
    if (_repintarNotas) pintarNotas();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
  window.addEventListener('pointercancel', soltar);
}

function estadoNota(n, texto) {
  const el = elNota(n);
  const e = el && el.querySelector('.nota-estado');
  if (!e) return;
  e.textContent = texto;
  clearTimeout(e._t);
  if (texto === 'Guardado ✓') e._t = setTimeout(() => { e.textContent = ''; }, 1800);
}

async function guardarNota(n, campos) {
  if (n._creando) await n._creando;
  if (n._borrada || String(n.id).indexOf('tmp') === 0) return;
  n._guardando = (n._guardando || 0) + 1;
  if ('texto' in campos) estadoNota(n, 'Guardando…');
  const res = await api(Object.assign({ action: 'nota_guardar', id: n.id }, campos));
  n._guardando--;
  if (res.ok) {
    if ('texto' in campos) estadoNota(n, n._sucio ? 'Sin guardar…' : 'Guardado ✓');
  } else {
    if ('texto' in campos) { n._sucio = true; estadoNota(n, 'No se guardó'); }
    toast('No se pudo guardar la nota: ' + (res.error || 'error'));
  }
}

async function nuevaNota() {
  const capa = capaNotas();
  if (!capa || !capa.offsetWidth) return;
  const k = notasData.filter(n => !n._borrada).length % 5;
  const o = origenCapa();
  const n = {
    id: 'tmp' + (++_notaTmp), texto: '', color: NOTA_COLORES[k], pin: false, min: false,
    x: Math.max(0, window.innerWidth - NOTA_ANCHO - 40 - k * 22) / capa.offsetWidth,
    y: window.scrollY - o.top + 90 + k * 26
  };
  notasData.push(n);
  capa.insertAdjacentHTML('beforeend', htmlNota(n));
  const el = elNota(n);
  ubicarNota(el, n);
  traerAlFrente(el);
  anim(el, { transform: ['scale(0.5) rotate(-8deg)', 'scale(1) rotate(' + el.style.getPropertyValue('--rot') + ')'], opacity: [0, 1] },
    { resorte: [300, 17], mantener: false });
  el.querySelector('.postit-texto').focus({ preventScroll: true });
  n._creando = api({ action: 'nota_guardar', texto: '', color: n.color, x: n.x.toFixed(4), y: Math.round(n.y) }).then(res => {
    if (!res.ok) {
      n._borrada = true;
      notasData = notasData.filter(x => x !== n);
      const e = elNota(n); if (e) e.remove();
      toast('No se pudo crear la nota: ' + (res.error || 'error'));
      return;
    }
    const e = elNota(n);
    n.id = res.id;
    if (e) e.dataset.id = String(res.id);
    // Si mientras tanto llegó la misma nota desde el servidor, queda una sola
    notasData = notasData.filter(x => x === n || String(x.id) !== String(n.id));
  });
  await n._creando;
  n._creando = null;
  if (n._borrada) {
    if (String(n.id).indexOf('tmp') !== 0) api({ action: 'nota_borrar', id: n.id });
    return;
  }
  if (n._sucio) notaGuardarYa(elNota(n));
}

function notaEscribir(ta) {
  const n = notaDe(ta);
  if (!n) return;
  n.texto = ta.value;
  n._sucio = true;
  estadoNota(n, 'Sin guardar…');
  clearTimeout(n._timer);
  n._timer = setTimeout(() => notaGuardarYa(ta), 900);
}
function notaGuardarYa(el) {
  const n = notaDe(el);
  if (!n || !n._sucio || n._creando) return;
  clearTimeout(n._timer);
  n._sucio = false;
  guardarNota(n, { texto: n.texto });
  // Actualiza el resumen que se ve cuando la nota está achicada
  const e = elNota(n), linea = String(n.texto || '').trim().split('\n')[0];
  const r = e && e.querySelector('.postit-resumen');
  if (r) r.innerHTML = linea ? esc(linea) : '<i style="opacity:.6">(nota vacía)</i>';
}

// Pin: fija la nota en la pantalla (te sigue al bajar) o la vuelve a pegar en la página, sin que salte de lugar
function notaPin(btn) {
  const n = notaDe(btn), el = elNota(n);
  if (!n || !el) return;
  const r = posEnVentana(el, n), o = origenCapa();
  n.pin = !n.pin;
  if (n.pin) { n.x = r.left / window.innerWidth; n.y = r.top; }
  else { n.x = (r.left + window.scrollX - o.left) / capaNotas().offsetWidth; n.y = r.top + window.scrollY - o.top; }
  el.classList.toggle('fija', n.pin);
  btn.classList.toggle('on', n.pin);
  btn.setAttribute('aria-pressed', n.pin ? 'true' : 'false');
  btn.title = n.pin ? 'Quitar el pin (vuelve a quedar pegada en la página)' : 'Fijar en la pantalla (te sigue al bajar)';
  ubicarNota(el, n);
  anim(btn, { transform: ['scale(0.5) rotate(-30deg)', 'none'] }, { resorte: [420, 14], mantener: false });
  toast(n.pin ? '📎 Nota fijada: te sigue al bajar' : '📎 Nota pegada en la página');
  guardarNota(n, { pin: n.pin ? '1' : '0', x: n.x.toFixed(4), y: Math.round(n.y) });
}

function notaMin(btn) {
  const n = notaDe(btn), el = elNota(n);
  if (!n || !el) return;
  n.min = !n.min;
  const h0 = el.offsetHeight, w0 = el.offsetWidth;
  el.classList.toggle('min', n.min);
  const b = el.querySelector('.postit-barra .nota-btn:nth-of-type(2)');
  if (b) { b.innerHTML = n.min ? AGRANDAR_ICON : ACHICAR_ICON; b.title = n.min ? 'Agrandar' : 'Achicar'; }
  anim(el, { height: [h0 + 'px', el.offsetHeight + 'px'], width: [w0 + 'px', el.offsetWidth + 'px'] }, { resorte: [300, 24], mantener: false });
  ubicarNota(el, n);
  if (!n.min) el.querySelector('.postit-texto').focus({ preventScroll: true });
  guardarNota(n, { min: n.min ? '1' : '0' });
}

function notaColor(btn, color) {
  const n = notaDe(btn), el = elNota(n);
  if (!n || n.color === color) return;
  n.color = color;
  if (el) {
    NOTA_COLORES.forEach(c => el.classList.toggle('nota-' + c, c === color));
    el.querySelectorAll('.nota-color').forEach(b => b.classList.toggle('on', b.classList.contains('nota-' + color)));
  }
  guardarNota(n, { color });
}

async function notaBorrar(btn) {
  const n = notaDe(btn);
  if (!n) return;
  if (String(n.texto || '').trim() && !confirm('¿Borrar esta nota?')) return;
  n._borrada = true;
  clearTimeout(n._timer);
  const el = elNota(n);
  if (el) {
    await anim(el, { transform: ['none', 'scale(0.5) rotate(10deg)'], opacity: [1, 0] }, { duracion: 220, mantener: false, fill: 'forwards' });
    el.remove();
  }
  notasData = notasData.filter(x => x !== n);
  if (n._creando) return;  // se borra en el servidor cuando termine de crearse
  const res = await api({ action: 'nota_borrar', id: n.id });
  if (!res.ok) toast('No se pudo borrar la nota: ' + (res.error || 'error'));
}
