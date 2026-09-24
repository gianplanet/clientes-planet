// Utilidades chicas que usan varios módulos.

export const HORA_MS = 3600000;
export const DIA_MS = 24 * HORA_MS;
export const MS_2000 = Date.UTC(2000, 0, 1);   // cualquier fecha anterior es un dato roto

// Una fecha creíble: después del 2000 y no en el futuro (con un día de margen)
export const fechaCreible = (ms) => Number.isFinite(ms) && ms > MS_2000 && ms < Date.now() + DIA_MS;

// "true", "1", 1 o true → true
export const esVerdadero = (v) =>
  v === true || v === 1 || String(v).toLowerCase() === 'true' || String(v) === '1';

// Texto recortado a un largo máximo
export const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// Número entero positivo o null
export function idValido(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── FECHAS (Argentina es UTC-3 todo el año) ────────────────
const FORMATO_AR = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

// "24/09/2026 14:05" (o solo "24/09/2026")
export function ahoraAR(soloFecha = false, ms = Date.now()) {
  const partes = FORMATO_AR.formatToParts(new Date(ms));
  const g = (t) => partes.find((p) => p.type === t).value;
  const fecha = `${g('day')}/${g('month')}/${g('year')}`;
  return soloFecha ? fecha : `${fecha} ${g('hour')}:${g('minute')}`;
}

// "23/09/2026 14:05" o "23/9/26" (día/mes/año, hora de Argentina) o una
// fecha ISO → milisegundos. Devuelve 0 si no se puede leer o no es creíble.
export function msDeFechaAR(valor) {
  const s = String(valor == null ? '' : valor).trim();
  if (!s) return 0;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:[ ,T]+(\d{1,2}):(\d{2}))?$/);
  let ms;
  if (m) ms = Date.UTC(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1], +(m[4] || 0) + 3, +(m[5] || 0));
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) ms = new Date(s).getTime();
  else return 0;   // otros formatos (p. ej. "46274" de la planilla) no se adivinan
  return fechaCreible(ms) ? ms : 0;
}

// El tipo de problema es la última parte del asunto: "152089 · NUME · No entregado"
export function tipoDeAsunto(asunto) {
  const partes = String(asunto || '').split(' · ');
  return partes.length > 1 ? partes[partes.length - 1].trim() : '';
}
