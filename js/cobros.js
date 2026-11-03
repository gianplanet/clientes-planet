// ═══ COBROS CONTRA ENTREGA ═══
// Los entregados de los clientes que cobran en la puerta (HAPPE y Tienda
// Directa.ar), traídos solos de Lightdata. En cada uno se marca si pagó en
// efectivo o por transferencia, y se baja un Excel por chofer para imprimir.
// Solo lo ve la gente de Planet con el permiso (Admin → Usuarios).

const COB_FORMAS = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
const COB_RETRAER_MS = 3 * 60000;      // no volver a preguntarle a Lightdata más seguido que esto
const COB_MAX_TANDAS = 60;

let cobDesde = '', cobHasta = '';
let cobDatos = [];
let cobClientes = [];
let cobCliente = 'Todos';
let cobBusca = '';
let cobTrayendo = false;
let cobUltimoTraer = {};               // "desde|hasta" → ms

const cobHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const cobPlata = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
const cobDiaTexto = d => d ? d.split('-').reverse().join('/') : '';
const cobVariosDias = () => cobDesde !== cobHasta;

// ── ENTRAR ──
async function cargarCobros() {
  if (!cobDesde) cobDesde = cobHasta = cobHoy();
  $('cob-desde').value = cobDesde;
  $('cob-hasta').value = cobHasta;
  await cobListar(true);
  const clave = cobDesde + '|' + cobHasta;
  if (Date.now() - (cobUltimoTraer[clave] || 0) > COB_RETRAER_MS) cobTraer();
}

function cobCambiarFechas() {
  const d = $('cob-desde').value, h = $('cob-hasta').value;
  if (!d || !h) return;
  if (d > h) { toast('La fecha "desde" es posterior a "hasta"'); return; }
  cobDesde = d; cobHasta = h;
  cargarCobros();
}

function cobAtajo(cual) {
  const hoy = cobHoy();
  const menos = n => new Date(Date.parse(hoy + 'T12:00:00Z') - n * 864e5).toISOString().slice(0, 10);
  if (cual === 'hoy') cobDesde = cobHasta = hoy;
  if (cual === 'ayer') cobDesde = cobHasta = menos(1);
  if (cual === 'semana') { cobDesde = menos(6); cobHasta = hoy; }
  cargarCobros();
}

// Lo guardado en el portal (rápido)
async function cobListar(primera) {
  if (primera && !cobDatos.length) $('cob-contenido').innerHTML = esqueletoHtml(3);
  const pedido = cobDesde + '|' + cobHasta;
  const res = await api({ action: 'cobros', desde: cobDesde, hasta: cobHasta });
  if (pedido !== cobDesde + '|' + cobHasta) return;      // mientras tanto cambiaron las fechas
  if (!res.ok) {
    $('cob-contenido').innerHTML = `<div class="empty-state"><p>${esc(res.error || 'No se pudieron cargar los cobros')}</p></div>`;
    return;
  }
  cobDatos = res.cobros || [];
  cobClientes = res.clientes || [];
  pintarCobros();
}

// Lo nuevo de Lightdata, de a tandas
async function cobTraer() {
  if (cobTrayendo) return;
  cobTrayendo = true;
  const desde = cobDesde, hasta = cobHasta;
  const btn = $('cob-traer');
  btn.classList.add('spinning');
  let nuevos = 0, error = '';
  cobEstado('Buscando entregas nuevas en Lightdata…');
  for (let vuelta = 0; vuelta < COB_MAX_TANDAS; vuelta++) {
    const res = await api({ action: 'cobros_traer', desde, hasta, seguir: vuelta > 0 });
    if (!res.ok) { error = res.error || 'No se pudo leer Lightdata'; break; }
    nuevos += res.guardados;
    if (res.faltan) cobEstado(`Trayendo de Lightdata… ${nuevos} nuevos, faltan ${res.faltan}`);
    if (!res.faltan || !res.guardados) break;          // terminó (o Lightdata no contesta)
  }
  cobTrayendo = false;
  btn.classList.remove('spinning');
  if (error) { cobEstado('⚠ ' + error, true); return; }
  cobUltimoTraer[desde + '|' + hasta] = Date.now();
  cobEstado(`Actualizado con Lightdata ${ahoraTexto().slice(-5)}${nuevos ? ` · ${nuevos} nuevo${nuevos === 1 ? '' : 's'}` : ''}`);
  if (desde === cobDesde && hasta === cobHasta) await cobListar(false);
}

function cobEstado(texto, alerta) {
  const el = $('cob-estado');
  el.textContent = texto;
  el.classList.toggle('alerta', !!alerta);
}

// ── FILTROS ──
function cobElegirCliente(c) { cobCliente = c; pintarCobros(); }
function cobBuscar(v) {
  cobBusca = v;
  $('cob-busca').closest('.search-row').classList.toggle('con-texto', !!v);
  pintarCobros();
}

function cobVisibles() {
  const q = normalizar(cobBusca.trim());
  return cobDatos.filter(c => (cobCliente === 'Todos' || c.cliente === cobCliente)
    && (!q || normalizar([c.tracking, c.direccion, c.destinatario, c.chofer].join(' ')).includes(q)));
}

function cobTotales(lista) {
  const t = { total: 0, n: 0, efectivo: 0, nEfectivo: 0, transferencia: 0, nTransferencia: 0, sinMarcar: 0, nSinMarcar: 0 };
  for (const c of lista) {
    t.total += c.monto; t.n++;
    if (c.forma === 'efectivo') { t.efectivo += c.monto; t.nEfectivo++; }
    else if (c.forma === 'transferencia') { t.transferencia += c.monto; t.nTransferencia++; }
    else { t.sinMarcar += c.monto; t.nSinMarcar++; }
  }
  return t;
}

function cobPorChofer(lista) {
  const grupos = new Map();
  for (const c of lista) {
    const k = c.chofer || 'Sin chofer';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  return [...grupos].sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([chofer, items]) => ({ chofer, items: items.sort((a, b) => (a.dia + a.entregado).localeCompare(b.dia + b.entregado)) }));
}

// ── PINTAR ──
function pintarCobros() {
  const lista = cobVisibles();
  const t = cobTotales(lista);
  const tile = (label, valor, pie, alerta) => `<div class="met-tile"><div class="met-label">${label}</div>
    <div class="met-valor">${valor}</div><div class="met-pie${alerta ? ' alerta' : ''}">${pie}</div></div>`;
  $('cob-resumen').innerHTML = [
    tile('A cobrar', cobPlata(t.total), `${t.n} envío${t.n === 1 ? '' : 's'}`),
    tile('Efectivo', cobPlata(t.efectivo), `${t.nEfectivo} · lo rinden los choferes`),
    tile('Transferencia', cobPlata(t.transferencia), `${t.nTransferencia}`),
    tile('Sin marcar', cobPlata(t.sinMarcar), t.nSinMarcar ? `${t.nSinMarcar} por marcar` : 'Todo marcado ✓', t.nSinMarcar > 0),
  ].join('');

  const cuenta = c => cobDatos.filter(x => c === 'Todos' || x.cliente === c).length;
  $('cob-clientes').innerHTML = ['Todos', ...cobClientes].map(c =>
    `<button class="client-chip${c === cobCliente ? ' active' : ''}" onclick="cobElegirCliente(${jsArg(c)})">${esc(c)} <span class="cnt">${cuenta(c)}</span></button>`).join('');

  const cont = $('cob-contenido');
  if (!lista.length) {
    cont.innerHTML = `<div class="empty-state"><p>${cobDatos.length ? 'Nada coincide con la búsqueda.'
      : `No hay entregas con cobro ${cobVariosDias() ? 'en esas fechas' : 'ese día'}${cobTrayendo ? ' todavía (buscando en Lightdata…)' : ''}.`}</p></div>`;
    return;
  }
  cont.innerHTML = cobPorChofer(lista).map(cobHtmlChofer).join('');
}

function cobHtmlChofer(g) {
  const t = cobTotales(g.items);
  return `<div class="cob-chofer">
    <div class="cob-chofer-cab">
      <div class="fila-avatar" style="background:${avatarColor(g.chofer)}">${esc((g.chofer || '?').trim()[0] || '?')}</div>
      <div class="cob-chofer-nombre">${esc(g.chofer)}<span>${t.n} entrega${t.n === 1 ? '' : 's'} · ${cobPlata(t.total)}</span></div>
      <div class="cob-chofer-tot">
        <span class="cob-pill efectivo">Efectivo a rendir <b>${cobPlata(t.efectivo)}</b></span>
        <span class="cob-pill transferencia">Transf. <b>${cobPlata(t.transferencia)}</b></span>
        ${t.nSinMarcar ? `<span class="cob-pill sin">${t.nSinMarcar} sin marcar</span>` : ''}
      </div>
    </div>
    ${g.items.map(cobHtmlFila).join('')}
  </div>`;
}

function cobHtmlFila(c) {
  const hora = (c.entregado || '').slice(-5);
  const cuando = cobVariosDias() ? `${cobDiaTexto(c.dia).slice(0, 5)} ${hora}` : hora;
  const quien = c.forma && c.marcado_nombre ? `Marcó ${c.marcado_nombre}${c.marcado_en ? ' · ' + textoFecha(new Date(c.marcado_en)) : ''}` : '';
  const boton = f => `<button class="cob-forma ${f}${c.forma === f ? ' activo' : ''}" onclick="cobMarcar(${c.did}, '${f}')"
      aria-pressed="${c.forma === f}">${COB_FORMAS[f]}</button>`;
  return `<div class="cob-fila${c.forma ? '' : ' pendiente'}" id="cob-${c.did}">
    <div class="cob-datos">
      <div class="cob-linea1"><b>${esc(c.tracking || '—')}</b>
        <span class="ticket-client-tag" style="--tono:${tonoCliente(c.cliente)}">${esc(c.cliente)}</span>
        <span class="cob-hora">${esc(cuando)}</span></div>
      <div class="cob-dir">${esc(c.direccion || 'Sin dirección')}</div>
      ${c.destinatario ? `<div class="cob-dest">${esc(c.destinatario)}</div>` : ''}
    </div>
    <div class="cob-monto">${cobPlata(c.monto)}</div>
    <div class="cob-formas" title="${esc(quien)}">${boton('efectivo')}${boton('transferencia')}</div>
  </div>`;
}

// ── MARCAR ──
// Tocar la forma ya marcada la desmarca
async function cobMarcar(did, forma) {
  const c = cobDatos.find(x => x.did === did);
  if (!c) return;
  const antes = { forma: c.forma, marcado_nombre: c.marcado_nombre, marcado_en: c.marcado_en };
  const nueva = c.forma === forma ? '' : forma;
  Object.assign(c, { forma: nueva, marcado_nombre: nueva ? sesion.nombre : '', marcado_en: nueva ? Date.now() : 0 });
  pintarCobros();
  const res = await api({ action: 'cobro_marcar', did, forma: nueva });
  if (!res.ok) {
    Object.assign(c, antes);
    pintarCobros();
    toast('Error: ' + (res.error || 'No se pudo guardar'));
  }
}

// ── EXCEL ──
function cobDescargarExcel() {
  const lista = cobVisibles();
  if (!lista.length) return toast('No hay cobros para descargar');
  const rango = cobVariosDias() ? `del ${cobDiaTexto(cobDesde)} al ${cobDiaTexto(cobHasta)}` : `del ${cobDiaTexto(cobDesde)}`;
  const clientes = cobCliente === 'Todos' ? cobClientes.join(' y ') : cobCliente;
  const C = 7;                                   // columnas: A..G
  const filas = [], combinar = [];
  const fila = celdas => { filas.push(celdas); return filas.length; };
  const unir = (r, a, b) => combinar.push(`${xlsxColumna(a)}${r}:${xlsxColumna(b)}${r}`);
  const vacia = () => fila([]);
  const total = (texto, monto) => { const r = fila([{ v: texto, e: 'total' }, { e: 'total' }, { e: 'total' }, { e: 'total' }, { e: 'total' }, { v: monto, e: 'totalPlata' }, { e: 'total' }]); unir(r, 0, 4); };

  unir(fila([{ v: `Cobros contra entrega ${rango}`, e: 'titulo' }]), 0, C - 1);
  unir(fila([{ v: `${clientes} · Descargado el ${ahoraTexto()} por ${sesion.nombre}${cobBusca.trim() ? ` · Búsqueda: "${cobBusca.trim()}"` : ''}`, e: 'sub' }]), 0, C - 1);
  vacia();

  for (const g of cobPorChofer(lista)) {
    const t = cobTotales(g.items);
    unir(fila([{ v: `${g.chofer} — ${t.n} entrega${t.n === 1 ? '' : 's'}`, e: 'grupo' }, ...Array(C - 1).fill({ e: 'grupo' })]), 0, C - 1);
    fila(['Entregado', 'Cliente', 'Tracking', 'Destinatario', 'Dirección', 'Monto', 'Pagó con'].map(v => ({ v, e: 'encabezado' })));
    for (const c of g.items) {
      fila([
        { v: c.entregado || cobDiaTexto(c.dia), e: 'celda' }, { v: c.cliente, e: 'celda' }, { v: c.tracking, e: 'celda' },
        { v: c.destinatario, e: 'ajustar' }, { v: c.direccion, e: 'ajustar' }, { v: c.monto, e: 'plata' },
        { v: COB_FORMAS[c.forma] || 'Sin marcar', e: 'celda' },
      ]);
    }
    total('Efectivo a rendir', t.efectivo);
    total('Transferencias', t.transferencia);
    if (t.nSinMarcar) total(`Sin marcar (${t.nSinMarcar})`, t.sinMarcar);
    vacia();
  }

  const t = cobTotales(lista);
  unir(fila([{ v: 'TOTAL GENERAL', e: 'grupo' }, ...Array(C - 1).fill({ e: 'grupo' })]), 0, C - 1);
  total(`Efectivo (${t.nEfectivo})`, t.efectivo);
  total(`Transferencia (${t.nTransferencia})`, t.transferencia);
  if (t.nSinMarcar) total(`Sin marcar (${t.nSinMarcar})`, t.sinMarcar);
  total(`Total a cobrar (${t.n})`, t.total);

  const blob = crearXlsx({ nombre: 'Cobros', anchos: [17, 17, 15, 24, 44, 13, 14], filas, combinar, horizontal: true });
  const nombre = `Cobros ${cobDesde}${cobVariosDias() ? ' al ' + cobHasta : ''}${cobCliente === 'Todos' ? '' : ' ' + cobCliente}.xlsx`;
  descargarArchivo(blob, nombre);
  toast('✓ Excel descargado');
}
