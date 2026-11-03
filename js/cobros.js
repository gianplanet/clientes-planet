// ═══ COBROS CONTRA ENTREGA ═══
// Los entregados de los clientes que cobran en la puerta (HAPPE y Tienda
// Directa.ar), traídos solos de Lightdata. En cada uno se marca si pagó en
// efectivo, por transferencia o si debe, y se baja un Excel por chofer para
// imprimir. Solo lo ve la gente de Planet con el permiso (Admin → Usuarios).
//
// La plata cuenta en el día de ENTREGA. Lo que quedó sin marcar o debe se
// arrastra a los días siguientes ("Pendientes de días anteriores") hasta que se
// marque; cuando se paga más tarde, figura en "Cobrados de días anteriores"
// del día en que se marcó, pero suma en su día de entrega.

const COB_FORMAS = { efectivo: 'Efectivo', transferencia: 'Transferencia', mixto: 'Mixto', debe: 'Debe' };
const COB_RETRAER_MS = 3 * 60000;      // no volver a preguntarle a Lightdata más seguido que esto
const COB_MAX_TANDAS = 60;

let cobDesde = '', cobHasta = '';
let cobDatos = [];                     // entregados en el rango
let cobPendientes = [];                // de días anteriores, sin marcar o deben
let cobCobradosDespues = [];           // de días anteriores, pagados dentro del rango
let cobClientes = [];
let cobCliente = 'Todos';
let cobBusca = '';
let cobTrayendo = false;
let cobUltimoTraer = {};               // "desde|hasta" → ms
let cobMixto = null;                   // { did, ef, tr, tocadoEf, tocadoTr }: el pago mixto que se está cargando

const cobHoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const cobDiaDeMs = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const cobPlata = n => '$' + Math.round(n || 0).toLocaleString('es-AR');
const cobDiaTexto = d => d ? d.split('-').reverse().join('/') : '';
const cobDiaCorto = d => cobDiaTexto(d).slice(0, 5);
const cobVariosDias = () => cobDesde !== cobHasta;
const cobPlural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + 's')}`;

// Cuánto entró de cada forma y cuánto falta. Con efectivo o transferencia
// el monto entero va a esa forma; en mixto, lo que se cargó.
function cobPagos(c) {
  if (c.forma === 'efectivo') return { ef: c.monto, tr: 0, falta: 0 };
  if (c.forma === 'transferencia') return { ef: 0, tr: c.monto, falta: 0 };
  if (c.forma === 'mixto') {
    const ef = c.pago_efectivo || 0, tr = c.pago_transferencia || 0;
    return { ef, tr, falta: Math.max(0, c.monto - ef - tr) };
  }
  return { ef: 0, tr: 0, falta: c.monto };   // sin marcar o debe
}
const cobPagado = c => !!c.forma && c.forma !== 'debe' && cobPagos(c).falta === 0;

// Pagado después del día de entrega → "cobrado 30/10"
function cobCobradoTarde(c) {
  if (!cobPagado(c) || !c.marcado_en) return '';
  const dia = cobDiaDeMs(c.marcado_en);
  return dia > c.dia ? cobDiaCorto(dia) : '';
}
// Texto de la forma de pago (pantalla y Excel)
function cobTextoForma(c) {
  if (!c.forma) return 'Sin marcar';
  const tarde = cobCobradoTarde(c);
  let txt = COB_FORMAS[c.forma];
  if (c.forma === 'mixto') {
    const p = cobPagos(c);
    txt = `Mixto: efectivo ${cobPlata(p.ef)} + transf. ${cobPlata(p.tr)}${p.falta ? ` · debe ${cobPlata(p.falta)}` : ''}`;
  }
  return txt + (tarde ? ` · cobrado ${tarde}` : '');
}

// ── ENTRAR ──
// "Solo Cobros": la pantalla de Planet sin menú, notas ni avisos, directo en Cobros
function abrirVistaSoloCobros() {
  $('planet-name').textContent = sesion.nombre;
  $('planet-role').textContent = 'Cobros';
  $('planet-avatar').textContent = (sesion.nombre || '?')[0];
  $('planet-avatar').style.background = avatarColor(sesion.nombre);
  $('screen-planet').classList.add('solo-cobros');
  $('cobros-btn').hidden = false;
  mostrarPantalla('screen-planet');
  irA('planet-cobros');
}

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
  cobPendientes = res.pendientes || [];
  cobCobradosDespues = res.cobradosDespues || [];
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
  cobEstado(`Actualizado con Lightdata ${ahoraTexto().slice(-5)}${nuevos ? ` · ${cobPlural(nuevos, 'nuevo')}` : ''}`);
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

function cobFiltrar(lista) {
  const q = normalizar(cobBusca.trim());
  return lista.filter(c => (cobCliente === 'Todos' || c.cliente === cobCliente)
    && (!q || normalizar([c.tracking, c.direccion, c.destinatario, c.chofer].join(' ')).includes(q)));
}
const cobVisibles = () => cobFiltrar(cobDatos);

function cobTotales(lista) {
  const t = { total: 0, n: 0, efectivo: 0, nEfectivo: 0, transferencia: 0, nTransferencia: 0, debe: 0, nDebe: 0, sinMarcar: 0, nSinMarcar: 0 };
  // Un mixto suma su parte a efectivo y a transferencia, y lo que falta a "debe"
  for (const c of lista) {
    t.total += c.monto; t.n++;
    const p = cobPagos(c);
    if (p.ef) { t.efectivo += p.ef; t.nEfectivo++; }
    if (p.tr) { t.transferencia += p.tr; t.nTransferencia++; }
    if (!c.forma) { t.sinMarcar += c.monto; t.nSinMarcar++; }
    else if (p.falta) { t.debe += p.falta; t.nDebe++; }
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
  const pendientes = cobFiltrar(cobPendientes);
  const despues = cobFiltrar(cobCobradosDespues);
  const t = cobTotales(lista), tp = cobTotales(pendientes);
  const falta = t.nDebe + t.nSinMarcar;
  const tile = (label, valor, pie, alerta) => `<div class="met-tile"><div class="met-label">${label}</div>
    <div class="met-valor">${valor}</div><div class="met-pie${alerta ? ' alerta' : ''}">${pie}</div></div>`;
  $('cob-resumen').innerHTML = [
    tile('A cobrar', cobPlata(t.total), cobPlural(t.n, 'envío')),
    tile('Efectivo', cobPlata(t.efectivo), `${t.nEfectivo} · lo rinden los choferes`),
    tile('Transferencia', cobPlata(t.transferencia), `${t.nTransferencia}`),
    tile('Falta cobrar', cobPlata(t.debe + t.sinMarcar),
      falta ? [t.nDebe ? `${t.nDebe} debe${t.nDebe === 1 ? '' : 'n'}` : '', t.nSinMarcar ? `${t.nSinMarcar} sin marcar` : ''].filter(Boolean).join(' · ') : t.n ? 'Todo cobrado ✓' : 'Sin entregas todavía', falta > 0),
    tp.n ? tile('De días anteriores', cobPlata(tp.total), `${cobPlural(tp.n, 'pendiente')} de antes`, true) : '',
  ].join('');

  const cuenta = c => cobDatos.filter(x => c === 'Todos' || x.cliente === c).length;
  $('cob-clientes').innerHTML = ['Todos', ...cobClientes].map(c =>
    `<button class="client-chip${c === cobCliente ? ' active' : ''}" onclick="cobElegirCliente(${jsArg(c)})">${esc(c)} <span class="cnt">${cuenta(c)}</span></button>`).join('');

  let html = '';
  if (pendientes.length) {
    html += `<div class="cob-seccion pendiente">
      <div class="cob-seccion-cab"><b>Pendientes de días anteriores</b> · ${cobPlural(pendientes.length, 'envío')} · ${cobPlata(tp.total)}
        <span>Siguen apareciendo hasta que se marquen Efectivo o Transferencia. Suman en su día de entrega.</span></div>
      ${cobPorChofer(pendientes).map(g => cobHtmlChofer(g, true)).join('')}
    </div>`;
  }
  if (lista.length) {
    html += cobPorChofer(lista).map(g => cobHtmlChofer(g, cobVariosDias())).join('');
  } else {
    html += `<div class="empty-state"><p>${cobDatos.length ? 'Nada coincide con la búsqueda.'
      : `No hay entregas con cobro ${cobVariosDias() ? 'en esas fechas' : 'ese día'}${cobTrayendo ? ' todavía (buscando en Lightdata…)' : ''}.`}</p></div>`;
  }
  if (despues.length) {
    const td = cobTotales(despues);
    html += `<div class="cob-seccion despues">
      <div class="cob-seccion-cab"><b>Cobrados de días anteriores</b> · ${cobPlural(despues.length, 'envío')} · ${cobPlata(td.total)}
        <span>Se pagaron ${cobVariosDias() ? 'en estas fechas' : 'este día'}, pero suman en su día de entrega.</span></div>
      ${cobPorChofer(despues).map(g => cobHtmlChofer(g, true)).join('')}
    </div>`;
  }
  $('cob-contenido').innerHTML = html;
}

function cobHtmlChofer(g, conFecha) {
  const t = cobTotales(g.items);
  return `<div class="cob-chofer">
    <div class="cob-chofer-cab">
      <div class="fila-avatar" style="background:${avatarColor(g.chofer)}">${esc((g.chofer || '?').trim()[0] || '?')}</div>
      <div class="cob-chofer-nombre">${esc(g.chofer)}<span>${cobPlural(t.n, 'entrega')} · ${cobPlata(t.total)}</span></div>
      <div class="cob-chofer-tot">
        <span class="cob-pill efectivo">Efectivo a rendir <b>${cobPlata(t.efectivo)}</b></span>
        <span class="cob-pill transferencia">Transf. <b>${cobPlata(t.transferencia)}</b></span>
        ${t.nDebe ? `<span class="cob-pill debe">Debe <b>${cobPlata(t.debe)}</b></span>` : ''}
        ${t.nSinMarcar ? `<span class="cob-pill sin">${t.nSinMarcar} sin marcar</span>` : ''}
      </div>
    </div>
    ${g.items.map(c => cobHtmlFila(c, conFecha)).join('')}
  </div>`;
}

function cobHtmlFila(c, conFecha) {
  const hora = (c.entregado || '').slice(-5);
  const cuando = conFecha ? `${cobDiaCorto(c.dia)} ${hora}` : hora;
  const tarde = cobCobradoTarde(c);
  const quien = c.forma && c.marcado_nombre ? `Marcó ${c.marcado_nombre}${c.marcado_en ? ' · ' + textoFecha(new Date(c.marcado_en)) : ''}` : '';
  const boton = f => `<button class="cob-forma ${f}${c.forma === f ? ' activo' : ''}"
      onclick="${f === 'mixto' ? `cobAbrirMixto(${c.did})` : `cobMarcar(${c.did}, '${f}')`}"
      aria-pressed="${c.forma === f}">${COB_FORMAS[f]}</button>`;
  const p = cobPagos(c);
  return `<div class="cob-fila${!c.forma ? ' pendiente' : p.falta ? ' debe' : ''}" id="cob-${c.did}">
    <div class="cob-datos">
      <div class="cob-linea1"><b>${esc(c.tracking || '—')}</b>
        <span class="ticket-client-tag" style="--tono:${tonoCliente(c.cliente)}">${esc(c.cliente)}</span>
        <span class="cob-hora">${esc(cuando)}</span>
        ${tarde ? `<span class="cob-tarde">cobrado ${esc(tarde)}</span>` : ''}</div>
      <div class="cob-dir">${esc(c.direccion || 'Sin dirección')}</div>
      ${c.destinatario ? `<div class="cob-dest">${esc(c.destinatario)}</div>` : ''}
      ${c.forma === 'mixto' ? `<div class="cob-mixto-linea">Efectivo <b>${cobPlata(p.ef)}</b> + Transf. <b>${cobPlata(p.tr)}</b>${p.falta ? ` · <span class="falta">debe ${cobPlata(p.falta)}</span>` : ''}</div>` : ''}
    </div>
    <div class="cob-monto">${cobPlata(c.monto)}</div>
    ${cobMixto && cobMixto.did === c.did ? cobHtmlMixto(c)
      : `<div class="cob-formas" title="${esc(quien)}">${boton('efectivo')}${boton('transferencia')}${boton('mixto')}${boton('debe')}</div>`}
  </div>`;
}

// Cargar un pago mixto: dos montos; el que no se tocó se completa con lo que falta
function cobHtmlMixto(c) {
  const m = cobMixto;
  return `<div class="cob-mixto-form">
    <label>Efectivo <span>$</span><input type="number" inputmode="numeric" min="0" step="1" id="cobmx-ef"
      value="${m.ef === '' ? '' : m.ef}" oninput="cobTipeoMixto('ef', this.value)"></label>
    <label>Transferencia <span>$</span><input type="number" inputmode="numeric" min="0" step="1" id="cobmx-tr"
      value="${m.tr === '' ? '' : m.tr}" oninput="cobTipeoMixto('tr', this.value)"></label>
    <div class="cob-mixto-estado" id="cobmx-estado">${cobEstadoMixto(c)}</div>
    <div class="cob-mixto-botones">
      <button class="btn-chico" onclick="cobCerrarMixto()">Cancelar</button>
      <button class="btn-chico primario" onclick="cobGuardarMixto(${c.did})">Guardar</button>
    </div>
  </div>`;
}

function cobBuscarCobro(did) {
  return [cobDatos, cobPendientes, cobCobradosDespues].map(l => l.find(x => x.did === did)).find(Boolean);
}

function cobAbrirMixto(did) {
  const c = cobBuscarCobro(did);
  if (!c) return;
  const ya = c.forma === 'mixto';
  cobMixto = { did, ef: ya ? c.pago_efectivo : '', tr: ya ? c.pago_transferencia : '', tocadoEf: ya, tocadoTr: ya };
  pintarCobros();
  const el = $('cobmx-ef');
  if (el) el.focus();
}
function cobCerrarMixto() { cobMixto = null; pintarCobros(); }

const cobNum = v => (v === '' || v === null || v === undefined ? 0 : Math.max(0, Math.round(Number(v) || 0)));

function cobTipeoMixto(cual, valor) {
  const c = cobMixto && cobBuscarCobro(cobMixto.did);
  if (!c) return;
  const otro = cual === 'ef' ? 'tr' : 'ef';
  cobMixto[cual] = valor;
  cobMixto[cual === 'ef' ? 'tocadoEf' : 'tocadoTr'] = true;
  // El otro, mientras no lo hayan tocado, se completa con lo que falta para el total
  if (!cobMixto[otro === 'ef' ? 'tocadoEf' : 'tocadoTr']) {
    cobMixto[otro] = valor === '' ? '' : Math.max(0, c.monto - cobNum(valor));
    $('cobmx-' + otro).value = cobMixto[otro];
  }
  $('cobmx-estado').innerHTML = cobEstadoMixto(c);
}

function cobEstadoMixto(c) {
  const suma = cobNum(cobMixto.ef) + cobNum(cobMixto.tr);
  if (!suma) return `Total a cobrar ${cobPlata(c.monto)}`;
  if (suma > c.monto) return `<span class="falta">Se pasa del total por ${cobPlata(suma - c.monto)}</span>`;
  if (suma < c.monto) return `<span class="falta">Faltan ${cobPlata(c.monto - suma)}: quedan en Debe</span>`;
  return '<span class="ok">Completa el total ✓</span>';
}

function cobGuardarMixto(did) {
  const c = cobBuscarCobro(did);
  if (!c || !cobMixto) return;
  const ef = cobNum(cobMixto.ef), tr = cobNum(cobMixto.tr);
  if (!ef && !tr) return toast('Completá cuánto pagó en efectivo y/o por transferencia');
  if (ef + tr > c.monto) return toast(`Entre los dos se pasan del total (${cobPlata(c.monto)})`);
  cobMixto = null;
  cobMarcar(did, 'mixto', ef, tr);
}

// ── MARCAR ──
// Tocar la forma ya marcada la desmarca (menos mixto, que se vuelve a editar)
async function cobMarcar(did, forma, ef, tr) {
  const c = cobBuscarCobro(did);
  if (!c) return;
  const esDeAntes = !cobDatos.includes(c);
  const antes = { forma: c.forma, pago_efectivo: c.pago_efectivo, pago_transferencia: c.pago_transferencia, marcado_nombre: c.marcado_nombre, marcado_en: c.marcado_en };
  const nueva = forma !== 'mixto' && c.forma === forma ? '' : forma;
  const mixto = nueva === 'mixto';
  Object.assign(c, { forma: nueva, pago_efectivo: mixto ? ef : 0, pago_transferencia: mixto ? tr : 0,
    marcado_nombre: nueva ? sesion.nombre : '', marcado_en: nueva ? Date.now() : 0 });
  if (cobMixto && cobMixto.did === did) cobMixto = null;
  pintarCobros();
  const res = await api({ action: 'cobro_marcar', did, forma: nueva, efectivo: ef, transferencia: tr });
  if (!res.ok) {
    Object.assign(c, antes);
    pintarCobros();
    return toast('Error: ' + (res.error || 'No se pudo guardar'));
  }
  // El servidor pasa un "mixto" que es todo de una forma a esa forma
  if (res.forma !== undefined && res.forma !== c.forma) {
    Object.assign(c, { forma: res.forma, pago_efectivo: res.pago_efectivo, pago_transferencia: res.pago_transferencia });
    pintarCobros();
  }
  // Uno de días anteriores puede cambiar de bloque (pendiente ↔ cobrado): se vuelve a pedir
  if (esDeAntes) cobListar(false);
}

// ── EXCEL ──
function cobDescargarExcel() {
  const lista = cobVisibles();
  const pendientes = cobFiltrar(cobPendientes);
  const despues = cobFiltrar(cobCobradosDespues);
  if (!lista.length && !pendientes.length && !despues.length) return toast('No hay cobros para descargar');
  const rango = cobVariosDias() ? `del ${cobDiaTexto(cobDesde)} al ${cobDiaTexto(cobHasta)}` : `del ${cobDiaTexto(cobDesde)}`;
  const clientes = cobCliente === 'Todos' ? cobClientes.join(' y ') : cobCliente;
  const C = 7;                                   // columnas: A..G
  const filas = [], combinar = [];
  const fila = celdas => { filas.push(celdas); return filas.length; };
  const unir = (r, a, b) => combinar.push(`${xlsxColumna(a)}${r}:${xlsxColumna(b)}${r}`);
  const vacia = () => fila([]);
  const titulo = (texto, estilo) => unir(fila([{ v: texto, e: estilo }, ...Array(C - 1).fill({ e: estilo })]), 0, C - 1);
  const nota = texto => unir(fila([{ v: texto, e: 'sub' }]), 0, C - 1);
  const total = (texto, monto) => { const r = fila([{ v: texto, e: 'total' }, { e: 'total' }, { e: 'total' }, { e: 'total' }, { e: 'total' }, { v: monto, e: 'totalPlata' }, { e: 'total' }]); unir(r, 0, 4); };
  const subtotales = t => {
    total('Efectivo a rendir', t.efectivo);
    total('Transferencias', t.transferencia);
    if (t.nDebe) total(`Debe (${t.nDebe})`, t.debe);
    if (t.nSinMarcar) total(`Sin marcar (${t.nSinMarcar})`, t.sinMarcar);
  };
  const bloques = (grupos, conSubtotales) => {
    for (const g of grupos) {
      const t = cobTotales(g.items);
      titulo(`${g.chofer} — ${cobPlural(t.n, 'entrega')}`, 'grupo');
      fila(['Entregado', 'Cliente', 'Tracking', 'Destinatario', 'Dirección', 'Monto', 'Pagó con'].map(v => ({ v, e: 'encabezado' })));
      for (const c of g.items) {
        fila([
          { v: c.entregado || cobDiaTexto(c.dia), e: 'celda' }, { v: c.cliente, e: 'celda' }, { v: c.tracking, e: 'celda' },
          { v: c.destinatario, e: 'ajustar' }, { v: c.direccion, e: 'ajustar' }, { v: c.monto, e: 'plata' },
          { v: cobTextoForma(c), e: 'ajustar' },
        ]);
      }
      if (conSubtotales) subtotales(t); else total('Total', t.total);
      vacia();
    }
  };

  titulo(`Cobros contra entrega ${rango}`, 'titulo');
  nota(`${clientes} · Descargado el ${ahoraTexto()} por ${sesion.nombre}${cobBusca.trim() ? ` · Búsqueda: "${cobBusca.trim()}"` : ''}`);
  vacia();

  bloques(cobPorChofer(lista), true);
  const t = cobTotales(lista);
  titulo(`TOTAL ${cobVariosDias() ? 'DE LAS FECHAS' : 'DEL DÍA'} (por día de entrega)`, 'grupo');
  total(`Efectivo (${t.nEfectivo})`, t.efectivo);
  total(`Transferencia (${t.nTransferencia})`, t.transferencia);
  if (t.nDebe) total(`Debe (${t.nDebe})`, t.debe);
  if (t.nSinMarcar) total(`Sin marcar (${t.nSinMarcar})`, t.sinMarcar);
  total(`Total a cobrar (${t.n})`, t.total);
  vacia();

  if (pendientes.length) {
    const tp = cobTotales(pendientes);
    titulo(`PENDIENTES DE DÍAS ANTERIORES — ${cobPlural(tp.n, 'envío')}`, 'titulo');
    nota('Entregados antes y todavía sin cobrar (deben o sin marcar). No suman en los totales de arriba: cuentan en su día de entrega.');
    vacia();
    bloques(cobPorChofer(pendientes), true);
    total(`Total pendiente de días anteriores (${tp.n})`, tp.total);
    vacia();
  }
  if (despues.length) {
    const td = cobTotales(despues);
    titulo(`COBRADOS DE DÍAS ANTERIORES — ${cobPlural(td.n, 'envío')}`, 'titulo');
    nota(`Entregados antes y pagados ${cobVariosDias() ? 'en estas fechas' : 'este día'}. Suman en su día de entrega, no en los totales de arriba.`);
    vacia();
    bloques(cobPorChofer(despues), false);
    total(`Total cobrado de días anteriores (${td.n})`, td.total);
  }

  const blob = crearXlsx({ nombre: 'Cobros', anchos: [17, 17, 15, 24, 44, 13, 17], filas, combinar, horizontal: true });
  const nombre = `Cobros ${cobDesde}${cobVariosDias() ? ' al ' + cobHasta : ''}${cobCliente === 'Todos' ? '' : ' ' + cobCliente}.xlsx`;
  descargarArchivo(blob, nombre);
  toast('✓ Excel descargado');
}
