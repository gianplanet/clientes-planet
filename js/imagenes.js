// ═══ FOTOS ADJUNTAS ═══
const IMG_MAX_POR_MENSAJE = 3;
const IMG_LADO_MAX = 1600;             // se achican antes de subir
const CLIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>';

// Fotos elegidas que todavía no se mandaron, por formulario:
//   'nq' (nueva consulta del cliente), 'pnq' (nueva de Planet),
//   'c<id>' (respuesta del cliente), 'p<id>' (respuesta de Planet)
const imgsPendientes = {};

function elegirImagenes(clave) {
  const input = $('img-input');
  input.value = '';
  input.onchange = () => agregarImagenes(clave, Array.from(input.files || []));
  input.click();
}

async function agregarImagenes(clave, files) {
  const lista = imgsPendientes[clave] = imgsPendientes[clave] || [];
  for (const f of files) {
    if (lista.length >= IMG_MAX_POR_MENSAJE) { toast('Máximo ' + IMG_MAX_POR_MENSAJE + ' fotos por mensaje'); break; }
    if (!/^image\//.test(f.type)) { toast('Solo se pueden adjuntar imágenes'); continue; }
    try { lista.push(await comprimirImagen(f)); }
    catch (e) { toast('No se pudo leer la imagen ' + (f.name || '')); }
  }
  pintarPrevias(clave);
}

// Pegar una imagen (Ctrl + V) en un cuadro de texto la adjunta al mensaje de ese cuadro
function claveDeCampo(el) {
  const id = (el && el.id) || '';
  let m;
  if ((m = id.match(/^preply-(\d+)$/))) return 'p' + m[1];
  if ((m = id.match(/^reply-(\d+)$/))) return 'c' + m[1];
  if (id.startsWith('pnq-')) return 'pnq';
  if (id.startsWith('nq-')) return 'nq';
  return null;
}
document.addEventListener('paste', e => {
  const clave = claveDeCampo(document.activeElement);
  if (!clave || !e.clipboardData) return;
  const files = Array.from(e.clipboardData.items || [])
    .filter(it => it.kind === 'file' && /^image\//.test(it.type))
    .map(it => it.getAsFile()).filter(Boolean);
  if (!files.length) return;  // si es texto, se pega normal
  e.preventDefault();
  agregarImagenes(clave, files);
  toast('📎 Imagen adjuntada');
});

// Achica la foto (máx. 1600 px) y la pasa a JPEG para que suba rápido
function comprimirImagen(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, IMG_LADO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      resolve({ mime: 'image/jpeg', b64: dataUrl.split(',')[1], preview: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
    img.src = url;
  });
}

function previasHtml(clave) {
  return (imgsPendientes[clave] || []).map((im, i) => `
    <div class="img-prev"><img src="${im.preview}" alt=""><button type="button" onclick="quitarImagen(${jsArg(clave)}, ${i})" title="Quitar">✕</button></div>`).join('');
}
function pintarPrevias(clave) {
  const el = $('prev-' + clave);
  if (el) el.innerHTML = previasHtml(clave);
}
function quitarImagen(clave, i) {
  (imgsPendientes[clave] || []).splice(i, 1);
  pintarPrevias(clave);
}
function hayImagenes(clave) { return (imgsPendientes[clave] || []).length > 0; }
function olvidarImagenes(clave) { delete imgsPendientes[clave]; pintarPrevias(clave); }

// Sube las fotos pendientes de un formulario; devuelve las URLs, o null si falló alguna
async function subirImagenes(clave, btn) {
  const lista = imgsPendientes[clave] || [];
  const urls = [];
  for (let i = 0; i < lista.length; i++) {
    if (btn) btn.textContent = `Subiendo foto ${i + 1}/${lista.length}...`;
    const res = await api({ action: 'subir_imagen', data: lista[i].b64, mime: lista[i].mime });
    if (!res.ok) { toast('Error al subir la foto: ' + (res.error || 'error')); return null; }
    urls.push(res.id);
  }
  return urls;
}

// Las fotos nuevas vienen como URL completa (Cloudflare).
// Las de antes de la mudanza son ids de Google Drive y siguen funcionando.
function urlImagen(id, ancho) {
  if (/^https?:\/\//.test(id)) return id;
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + ancho;
}
function imagenesMsgHtml(ids) {
  if (!ids || !ids.length) return '';
  return '<div class="msg-imgs">' + ids.map(id =>
    `<img src="${esc(urlImagen(id, 300))}" loading="lazy" alt="Foto adjunta" onclick="verImagen(${jsArg(id)})">`).join('') + '</div>';
}

// ── VISOR ──
function verImagen(id) {
  $('lightbox-img').src = urlImagen(id, 1600);
  $('lightbox-link').href = /^https?:\/\//.test(id) ? id : 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
  $('lightbox').classList.add('active');
}
function cerrarImagen() {
  $('lightbox').classList.remove('active');
  $('lightbox-img').removeAttribute('src');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarImagen(); });
