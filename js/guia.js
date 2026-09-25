// ═══ GUÍA PARA CLIENTES NUEVOS ═══
// Se muestra sola la primera vez que el cliente entra (en ese dispositivo). El botón "?" la repite.
const GUIA_CLIENTE = [
  { titulo: '¡Hola! 👋', texto: 'Te mostramos en un minuto cómo funciona el Portal de Clientes de Planet.' },
  { el: () => $('client-stats'), titulo: 'Tus consultas',
    texto: 'Acá están todas juntas: las que le enviás vos a Planet y las que Planet te hace a vos sobre algún envío.' },
  { el: () => $('client-stats'), titulo: 'Resumen',
    texto: 'De un vistazo: cuántas consultas tenés pendientes, en proceso, esperando tu respuesta y cerradas.' },
  { el: () => document.querySelector('#client-list .estado-chips'), titulo: 'Solapas por estado',
    texto: 'Tocá una solapa para ver solo esas consultas. Las cerradas quedan guardadas en la suya.' },
  { el: () => document.querySelector('#client-list .consulta-card'), titulo: 'Abrí una consulta',
    texto: 'Tocala para ver la conversación y responder. Con el clip podés adjuntar fotos (o pegarlas con Ctrl + V).' },
  { el: () => document.querySelector('#screen-client .fab'), titulo: 'Consulta nueva',
    texto: 'Con este botón le mandás una consulta nueva a Planet: número de tracking, tipo de problema y tu mensaje.' },
  { el: () => $('client-reload'), titulo: 'Actualizar', texto: 'Tocá acá para ver si llegaron respuestas nuevas.' },
  { el: () => $('client-guia-btn'), titulo: '¡Listo!',
    texto: 'Cuando Planet necesite info tuya vas a ver un aviso celeste y la consulta en “Esperan tu respuesta”. Si querés ver esta guía de nuevo, tocá este botón.' }
];
let _guia = null;

function claveGuia() { return 'planet_guia_' + (sesion ? sesion.usuario : ''); }
function guiaVista() { return local.leer(claveGuia()) === 1; }
function visible(el) { return !!(el && el.getClientRects().length && el.offsetWidth); }

function iniciarGuia() {
  if (_guia || !sesion) return;
  const pasos = GUIA_CLIENTE.filter(p => !p.el || visible(p.el()));
  const root = document.createElement('div');
  root.className = 'guia';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Guía del portal');
  root.innerHTML = '<div class="guia-foco sin-objetivo"></div><div class="guia-card" aria-live="polite"></div>';
  document.body.appendChild(root);
  _guia = { root, pasos, i: 0 };
  anim(root, { opacity: [0, 1] }, { duracion: 250, mantener: false });
  root.addEventListener('keydown', guiaTeclas);
  window.addEventListener('resize', ubicarGuia);
  pasoGuia(0);
}
function guiaTeclas(e) {
  if (e.key === 'Escape') cerrarGuia();
  else if (e.key === 'ArrowRight') pasoGuia(_guia.i + 1);
  else if (e.key === 'ArrowLeft' && _guia.i > 0) pasoGuia(_guia.i - 1);
}
function pasoGuia(i) {
  const g = _guia;
  if (!g) return;
  if (i >= g.pasos.length) return cerrarGuia();
  const adelante = i >= g.i;
  g.i = i;
  const p = g.pasos[i], ultimo = i === g.pasos.length - 1;
  const obj = p.el && p.el();
  if (obj) obj.scrollIntoView({ block: 'center', behavior: 'auto' });
  const card = g.root.querySelector('.guia-card');
  card.innerHTML = `
    <div class="guia-paso">Paso ${i + 1} de ${g.pasos.length}</div>
    <h3>${p.titulo}</h3>
    <p>${p.texto}</p>
    <div class="guia-puntos">${g.pasos.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
    <div class="guia-botones">
      ${ultimo ? '<span style="margin-right:auto"></span>' : '<button class="guia-saltar" onclick="cerrarGuia()">Saltar guía</button>'}
      ${i > 0 ? `<button class="guia-atras" onclick="pasoGuia(${i - 1})">Atrás</button>` : ''}
      <button class="guia-sig" onclick="pasoGuia(${i + 1})">${ultimo ? 'Empezar' : i === 0 ? 'Mostrame' : 'Siguiente'}</button>
    </div>`;
  ubicarGuia();
  anim(card, { opacity: [0, 1], transform: [`translateX(${adelante ? 16 : -16}px)`, 'none'] }, { resorte: [300, 26], mantener: false });
  card.querySelector('.guia-sig').focus({ preventScroll: true });
}
function ubicarGuia() {
  const g = _guia;
  if (!g) return;
  const p = g.pasos[g.i], obj = p.el && p.el();
  const foco = g.root.querySelector('.guia-foco'), card = g.root.querySelector('.guia-card');
  const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
  if (!visible(obj)) {
    foco.classList.add('sin-objetivo');
    Object.assign(foco.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
    Object.assign(card.style, { left: (vw - cw) / 2 + 'px', top: Math.max(16, (vh - ch) / 2) + 'px' });
    return;
  }
  const r = obj.getBoundingClientRect(), pad = 6;
  foco.classList.remove('sin-objetivo');
  Object.assign(foco.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  let top = r.bottom + pad + 14;
  if (top + ch > vh - 16) top = r.top - pad - 14 - ch;
  if (top < 16) top = Math.max(16, vh - ch - 16);
  const left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), vw - cw - 16);
  Object.assign(card.style, { left: left + 'px', top: top + 'px' });
}
function cerrarGuia() {
  const g = _guia;
  if (!g) return;
  _guia = null;
  local.guardar(claveGuia(), 1);
  window.removeEventListener('resize', ubicarGuia);
  anim(g.root, { opacity: [1, 0] }, { duracion: 200, mantener: false, fill: 'forwards' }).then(() => g.root.remove());
}
