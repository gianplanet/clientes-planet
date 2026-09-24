// ═══ BASE: ayudas que usa todo el portal ═══

function $(id) { return document.getElementById(id); }

// Muestra una pantalla (login, cliente o Planet) y oculta las demás
function mostrarPantalla(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// Texto seguro para meter en el HTML (también dentro de atributos: escapa comillas).
// Sin esto, un cliente podía escribir código en su consulta y se ejecutaba en la pantalla de Planet.
const _ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => _ESCAPES[c]);
}

// Un valor para pasar dentro de un onclick="funcion(...)".
// Primero se arma como texto de JavaScript y después se escapa para el HTML.
function jsArg(v) { return esc(JSON.stringify(v)); }

// Color del avatar, siempre el mismo para el mismo nombre
const COLORES_AVATAR = ['#d97706', '#2563eb', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#c026d3', '#ea580c'];
function hashTexto(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}
function avatarColor(nombre) { return COLORES_AVATAR[hashTexto(String(nombre || '?')) % COLORES_AVATAR.length]; }
// Tono (0-359) de la etiqueta de cada cliente
function tonoCliente(nombre) { return hashTexto(String(nombre || '')) % 360; }

// Saca tildes y mayúsculas para que "direccion" encuentre "Dirección"
function normalizar(t) {
  return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Guardado local del navegador: si está bloqueado (modo privado), el portal sigue andando igual
const local = {
  leer(clave, siNo = null) {
    try { const v = localStorage.getItem(clave); return v === null ? siNo : JSON.parse(v); } catch (e) { return siNo; }
  },
  guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) {} },
  borrar(clave) { try { localStorage.removeItem(clave); } catch (e) {} }
};

// ── FECHAS ──
const HORA_MS = 3600000;
// Una fecha creíble: después del 2000 y no en el futuro (con un día de margen).
// Lo de antes del 2000 es un dato roto (típico: quedó en cero y se lee como 1970).
const MS_2000 = Date.UTC(2000, 0, 1);
function fechaValida(ms) { return typeof ms === 'number' && isFinite(ms) && ms > MS_2000 && ms < Date.now() + 24 * HORA_MS; }

// "23/09/2026 14:05", "23/9/26", una fecha ISO o milisegundos → milisegundos (0 si no se puede leer)
function fechaMs(f) {
  if (typeof f === 'number') return fechaValida(f) ? f : 0;
  const s = String(f == null ? '' : f).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/);
  let ms = 0;
  if (m) ms = new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) ms = new Date(s).getTime();
  return fechaValida(ms) ? ms : 0;
}

const _dos = n => String(n).padStart(2, '0');
function textoFecha(d) {
  return `${_dos(d.getDate())}/${_dos(d.getMonth() + 1)}/${d.getFullYear()} ${_dos(d.getHours())}:${_dos(d.getMinutes())}`;
}
function ahoraTexto() { return textoFecha(new Date()); }

// Fecha legible (dd/mm/aaaa hh:mm), aunque venga en formato ISO
function fmtFecha(f) {
  if (!f) return '';
  const s = String(f);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return textoFecha(d);
  }
  return s;
}

// Milisegundos → "2 h 15 min", "3 d 4 h"
function fmtDuracion(ms) {
  if (ms === null || ms === undefined) return '—';
  const min = Math.round(ms / 60000);
  if (min < 60) return min + ' min';
  const horas = Math.floor(min / 60), resto = min % 60;
  if (horas < 24) return horas + ' h' + (resto ? ' ' + resto + ' min' : '');
  const dias = Math.floor(horas / 24), hs = horas % 24;
  return dias + ' d' + (hs ? ' ' + hs + ' h' : '');
}
// "recién" o "hace 3 h"
function haceTanto(ms) { return ms < 60000 ? 'recién' : 'hace ' + fmtDuracion(ms); }
