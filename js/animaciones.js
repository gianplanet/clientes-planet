// ═══ ANIMACIONES Y AVISOS ═══
// Sin librerías: animaciones del navegador + curvas de "resorte" (rebote suave).
const SIN_MOVIMIENTO = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
const LINEAR_OK = !!(window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));
const _resortes = {};

// Simula un resorte y lo convierte en una curva CSS linear(); devuelve { easing, duracion }
function resorte(rigidez = 260, freno = 22) {
  const k = rigidez + ':' + freno;
  if (_resortes[k]) return _resortes[k];
  let x = 0, v = 0, t = 0;
  const dt = 1 / 240, pts = [0];
  while (t < 2.5) {
    v += (-rigidez * (x - 1) - freno * v) * dt;
    x += v * dt; t += dt;
    pts.push(x);
    if (t > 0.2 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
  }
  const paso = Math.max(1, Math.round(pts.length / 60)), s = [];
  for (let i = 0; i < pts.length; i += paso) s.push(pts[i].toFixed(4));
  s.push('1');
  return _resortes[k] = {
    easing: LINEAR_OK ? `linear(${s.join(',')})` : 'cubic-bezier(.34,1.4,.64,1)',
    duracion: Math.round(t * 1000)
  };
}
if (LINEAR_OK) document.documentElement.style.setProperty('--ease-spring', resorte(170, 20).easing);

// Anima un elemento. mantener=true deja aplicado el valor final; false vuelve a su estilo normal.
function anim(el, kf, o = {}) {
  if (!el || !el.animate) return Promise.resolve();
  el.getAnimations().forEach(a => {
    const deCss = (window.CSSAnimation && a instanceof CSSAnimation) || (window.CSSTransition && a instanceof CSSTransition);
    if (!deCss) a.cancel();
  });
  if (o.mantener !== false) for (const p in kf) el.style[p] = kf[p][kf[p].length - 1];
  if (SIN_MOVIMIENTO) return Promise.resolve();
  let duracion = o.duracion || 300, easing = o.easing || EASE_OUT;
  if (o.resorte) { const r = resorte(...o.resorte); duracion = r.duracion; easing = r.easing; }
  const a = el.animate(kf, { duration: duracion, delay: o.retraso || 0, easing, fill: o.fill || 'backwards' });
  return a.finished.then(() => {}, () => {});
}
function esperar(ms) { return new Promise(r => setTimeout(r, SIN_MOVIMIENTO ? 0 : ms)); }

// Los elementos entran uno detrás del otro
function entrada(elems, desde = 'translateY(10px)', paso = 40) {
  Array.from(elems || []).slice(0, 14).forEach((e, i) => {
    const op = getComputedStyle(e).opacity;
    anim(e, { opacity: [0, op], transform: [desde, 'none'] }, { duracion: 380, retraso: i * paso, mantener: false });
  });
}
// Tiembla para avisar que falta algo
function sacudir(el) {
  anim(el, { transform: ['translateX(0)', 'translateX(-7px)', 'translateX(6px)', 'translateX(-4px)', 'translateX(2px)', 'translateX(0)'] },
    { duracion: 420, easing: 'ease-out', mantener: false });
}
function sacudirVacios(ids) {
  ids.forEach(id => { const el = $(id); if (el && !String(el.value || '').trim()) sacudir(el); });
}
// Salta (para contadores que suben)
function saltar(el) { anim(el, { transform: ['scale(0.4)', 'scale(1)'] }, { resorte: [500, 14], mantener: false }); }
// Resalta una tarjeta nueva o con novedades
function resaltar(el) {
  if (!el) return;
  anim(el, { transform: ['scale(0.97)', 'none'] }, { resorte: [300, 20], mantener: false });
  el.classList.remove('card-nueva'); void el.offsetWidth; el.classList.add('card-nueva');
  el.addEventListener('animationend', () => el.classList.remove('card-nueva'), { once: true });
}

// ── Aviso "líquido": nace como un punto, se estira y abre la explicación debajo ──
const TOAST_ICONOS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 11v6M12 7h.01"/></svg>',
  load: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>'
};
const TOAST_TITULOS = { success: 'Listo', error: 'No se pudo completar', warn: 'Falta completar', info: 'Aviso' };

// Convierte los textos de siempre ("✓ Mensaje enviado", "Error: ...") en tipo + título + detalle
function armarToast(msg) {
  let s = String(msg || '').trim(), tipo = 'info', titulo = s, desc = '';
  if (/^✓/.test(s)) { tipo = 'success'; s = s.replace(/^✓\s*/, ''); }
  else if (/^📎/.test(s)) { tipo = 'info'; s = s.replace(/^📎\s*/, ''); }
  else if (/^(Error|No se pudo|No podés)/i.test(s)) tipo = 'error';
  else if (/^(Completá|Ingresá|Escribí|Máximo|Solo se|Sesión vencida)/i.test(s)) tipo = 'warn';
  else if (/(creada|creado|enviada|actualizado|eliminado|cambiado)/i.test(s)) tipo = 'success';
  titulo = s;
  let partes = s.split(' — ');
  titulo = partes[0];
  const extra = partes.slice(1).join('. ');
  const dosPuntos = titulo.indexOf(': ');
  if (dosPuntos > 0 && dosPuntos < 32) { desc = titulo.slice(dosPuntos + 2); titulo = titulo.slice(0, dosPuntos); }
  else if (titulo.indexOf(' · ') > 0) { const i = titulo.indexOf(' · '); desc = titulo.slice(i + 3); titulo = titulo.slice(0, i); }
  if (titulo === 'Error') titulo = TOAST_TITULOS.error;
  if (extra) desc = (desc ? desc.replace(/\.?$/, '. ') : '') + extra.charAt(0).toUpperCase() + extra.slice(1);
  if (titulo.length > 34 && !desc) { desc = titulo; titulo = TOAST_TITULOS[tipo]; }
  return { tipo, titulo, desc };
}

let _t = null, _tCadena = Promise.resolve(), _tGen = 0;
function toast(msg, opciones) { mostrarToast(Object.assign(armarToast(msg), opciones || {})); }
toast.cargando = titulo => mostrarToast({ tipo: 'load', titulo, desc: '', fijo: true });

function mostrarToast(o) {
  const gen = ++_tGen;
  _tCadena = _tCadena.then(() => pasoToast(o, gen)).catch(() => {});
}
function hostToast() {
  let h = document.querySelector('.sl-host');
  if (!h) {
    h = document.createElement('div');
    h.className = 'sl-host';
    h.setAttribute('role', 'status');
    h.setAttribute('aria-live', 'polite');
    document.body.appendChild(h);
  }
  return h;
}
async function pasoToast(o, gen) {
  if (!_t) {
    const el = document.createElement('div');
    el.className = 'sl';
    el.innerHTML = '<div class="sl-goo"><div class="sl-head"></div><div class="sl-body"></div></div>' +
      '<div class="sl-content"><div class="sl-row"><span class="sl-badge"></span><span class="sl-title"></span></div></div>' +
      '<div class="sl-desc"></div>';
    hostToast().appendChild(el);
    _t = { el, ancho: 36, cuerpo: false };
    anim(el, { transform: ['scale(0.3)', 'scale(1)'], opacity: [0, 1] }, { resorte: [400, 22] });
    await esperar(80);
  } else if (_t.cuerpo) {
    await cerrarCuerpoToast();
  }
  await cabezaToast(o.tipo, o.titulo);
  if (o.desc) { await esperar(100); await abrirCuerpoToast(o.desc); }
  if (!o.fijo) {
    const dura = (o.tipo === 'error' ? 4500 : 2600) + (o.desc ? 1200 : 0);
    setTimeout(() => {
      if (gen === _tGen) _tCadena = _tCadena.then(() => (gen === _tGen ? cerrarToast() : null)).catch(() => {});
    }, dura);
  }
}
async function cabezaToast(tipo, titulo) {
  const el = _t.el, q = s => el.querySelector(s);
  el.className = 'sl t-' + tipo;
  q('.sl-badge').innerHTML = TOAST_ICONOS[tipo] || TOAST_ICONOS.info;
  q('.sl-title').textContent = titulo;
  const w = Math.ceil(q('.sl-row').getBoundingClientRect().width);
  anim(q('.sl-title'), { opacity: [0, 1], transform: ['translateX(-6px)', 'none'] }, { duracion: 260, retraso: 110 });
  await anim(q('.sl-head'), { width: [_t.ancho + 'px', w + 'px'] }, { resorte: [320, 24] });
  _t.ancho = w;
}
async function abrirCuerpoToast(desc) {
  const el = _t.el, d = el.querySelector('.sl-desc'), body = el.querySelector('.sl-body');
  const dw = Math.max(_t.ancho, Math.min(320, window.innerWidth - 32));
  d.style.width = dw + 'px';
  d.textContent = desc;
  const h = Math.ceil(d.getBoundingClientRect().height) + 20;
  _t.cuerpo = true;
  anim(d, { opacity: [0, 1], transform: ['translateX(-50%) translateY(-6px)', 'translateX(-50%)'] }, { duracion: 280, retraso: 130 });
  await anim(body, { width: [_t.ancho + 'px', dw + 'px'], height: ['0px', h + 'px'] }, { resorte: [260, 22] });
}
async function cerrarCuerpoToast() {
  const el = _t.el, body = el.querySelector('.sl-body');
  anim(el.querySelector('.sl-desc'), { opacity: [1, 0] }, { duracion: 140 });
  await anim(body, { width: [body.style.width || _t.ancho + 'px', _t.ancho + 'px'], height: [body.style.height || '0px', '0px'] }, { duracion: 220 });
  _t.cuerpo = false;
}
async function cerrarToast() {
  if (!_t) return;
  if (_t.cuerpo) await cerrarCuerpoToast();
  const el = _t.el;
  anim(el.querySelector('.sl-title'), { opacity: [1, 0] }, { duracion: 140 });
  await anim(el.querySelector('.sl-head'), { width: [_t.ancho + 'px', '36px'] }, { duracion: 220 });
  await anim(el, { transform: ['scale(1)', 'scale(0.4)'], opacity: [1, 0] }, { duracion: 180 });
  el.remove();
  _t = null;
}

// ── Esqueleto brillante mientras cargan las consultas ──
function esqueletoHtml(n = 3) {
  const a = [86, 72, 80], b = [52, 40, 60];
  let h = '<div class="skel-list" aria-label="Cargando...">';
  for (let i = 0; i < n; i++) {
    h += `<div class="skel-card"><div class="skel-top"><span class="skel" style="width:78px;height:18px;border-radius:10px"></span><span class="skel" style="width:96px"></span></div>` +
      `<span class="skel" style="width:${a[i % 3]}%"></span><span class="skel" style="width:${b[i % 3]}%"></span></div>`;
  }
  return h + '</div>';
}

// ── Pestañas y menú lateral: el fondo azul se desliza hasta la opción elegida ──
function moverIndicador(barra, activo, animar) {
  if (!barra || !activo || !activo.offsetWidth) return;
  let ind = barra.querySelector(':scope > .tab-ind');
  if (!ind) { ind = document.createElement('div'); ind.className = 'tab-ind'; barra.prepend(ind); }
  barra.classList.add('has-ind');
  const vertical = barra.classList.contains('sidebar');
  const tr = vertical ? `translateY(${activo.offsetTop}px)` : `translateX(${activo.offsetLeft}px)`;
  const prop = vertical ? 'height' : 'width';
  const tam = (vertical ? activo.offsetHeight : activo.offsetWidth) + 'px';
  if (!animar || !ind.style.transform) { ind.style.transform = tr; ind.style[prop] = tam; return; }
  anim(ind, { transform: [ind.style.transform, tr], [prop]: [ind.style[prop], tam] }, { resorte: [300, 26] });
}
function acomodarIndicadores() {
  document.querySelectorAll('.sidebar').forEach(b => moverIndicador(b, b.querySelector('.sidebar-item.active'), false));
}
window.addEventListener('resize', acomodarIndicadores);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(acomodarIndicadores);

// ── Números que ruedan como un cuentakilómetros ──
const _numsPrevios = {};
function rodarNumeros(contId) {
  const cont = $(contId);
  if (!cont) return;
  const els = Array.from(cont.querySelectorAll('.stat-number'));
  const prev = _numsPrevios[contId];
  _numsPrevios[contId] = els.map(e => e.textContent.trim());
  if (SIN_MOVIMIENTO) return;
  els.forEach((el, i) => {
    const s = el.textContent.trim(), p = prev ? prev[i] : null;
    if (!/^\d+$/.test(s) || p === s) return;
    const desde = (p && p.length === s.length) ? p : '0'.repeat(s.length);
    const tira = '0123456789'.split('').map(d => `<span>${d}</span>`).join('');
    el.classList.add('rodando');
    el.innerHTML = `<span class="sr-only">${s}</span>` + s.split('').map((d, k) =>
      `<span class="dg" aria-hidden="true"><span class="strip" style="transform:translateY(-${desde[k]}em)">${tira}</span></span>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('.strip').forEach((st, k) => {
        st.style.transitionDelay = (k * 80) + 'ms';
        st.style.transform = `translateY(-${s[k]}em)`;
      });
    }));
  });
}

// ── Contadores (globitos) que saltan cuando suben ──
function ponerContador(el, n) {
  if (!el) return;
  const antes = el.dataset.prev === undefined ? null : Number(el.dataset.prev);
  el.textContent = n;
  el.dataset.prev = n;
  if (antes !== null && n > antes) saltar(el);
}

// ── Onda que sale desde el dedo al tocar un botón ──
document.addEventListener('pointerdown', e => {
  if (SIN_MOVIMIENTO) return;
  const b = e.target.closest('.btn-primary, .btn-send, .reply-send, .thread-reply-btn, .fab, .status-btn, .client-chip, .icon-btn');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), tam = Math.max(r.width, r.height) * 2;
  const o = document.createElement('span');
  o.className = 'ripple';
  o.style.cssText = `width:${tam}px;height:${tam}px;left:${e.clientX - r.left - tam / 2}px;top:${e.clientY - r.top - tam / 2}px`;
  b.appendChild(o);
  o.animate({ transform: ['scale(0)', 'scale(1)'], opacity: [0.3, 0] }, { duration: 600, easing: 'ease-out' }).finished
    .then(() => o.remove(), () => o.remove());
});

// El avioncito del botón Enviar sale volando
function volarAvion(btn) {
  const svg = btn && btn.querySelector('svg');
  if (!svg) return Promise.resolve();
  return anim(svg, { transform: ['none', 'translate(16px,-16px) rotate(8deg)'], opacity: [1, 0] },
    { duracion: 200, easing: 'cubic-bezier(.5,0,.9,.5)', mantener: false, fill: 'forwards' });
}
