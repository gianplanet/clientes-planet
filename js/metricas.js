// ═══ MÉTRICAS ═══
// Todos los tiempos son en HORAS CORRIDAS: el reloj corre igual de noche,
// fines de semana y feriados.
let metPeriodo = 30;   // días; 0 = desde siempre
let _turnoMetricas = 0; // si se piden dos veces seguidas, vale la última

function tile(label, valor, pie, alerta) {
  return `<div class="met-tile">
    <div class="met-label">${label}</div>
    <div class="met-valor">${valor}</div>
    ${pie ? `<div class="met-pie${alerta ? ' alerta' : ''}">${pie}</div>` : ''}
  </div>`;
}

async function cargarMetricas() {
  const cont = $('met-contenido');
  // Botones de período
  $('met-periodo').innerHTML = [[7, 'Últimos 7 días'], [30, 'Últimos 30 días'], [90, 'Últimos 90 días'], [0, 'Desde siempre']]
    .map(([d, t]) => `<button class="client-chip ${metPeriodo === d ? 'active' : ''}" onclick="elegirPeriodo(${d})">${t}</button>`).join('');
  // Lista de clientes (la misma que ya tenemos cargada)
  const sel = $('met-cliente');
  const elegido = sel.value || 'Todos';
  // Todos los clientes: los dados de alta y los que aparecen en las consultas cargadas
  const nombres = [...new Set(clientesRegistrados.map(c => c.nombre).concat(recibidas().map(c => c.cliente)))].filter(Boolean).sort();
  sel.innerHTML = `<option value="Todos">Todos los clientes</option>` +
    nombres.map(n => `<option value="${esc(n)}"${elegido === n ? ' selected' : ''}>${esc(n)}</option>`).join('');

  cont.innerHTML = '<div class="spinner"></div>';
  const turno = ++_turnoMetricas;
  const res = await api({ action: 'metricas', dias: metPeriodo, cliente: sel.value || 'Todos' });
  if (turno !== _turnoMetricas) return;
  if (!res.ok) { cont.innerHTML = `<div class="empty-state"><p>Error: ${esc(res.error || 'no se pudo calcular')}</p></div>`; return; }
  cont.innerHTML = htmlMetricas(res);
  entrada(cont.querySelectorAll('.met-tile, .met-panel'), 'translateY(8px)', 30);
}

function elegirPeriodo(d) { metPeriodo = d; cargarMetricas(); }

// "8", "8:30" — hora de turno
function fmtHora(h) {
  if (h == null || h === '') return '';
  const n = Number(h), hh = Math.floor(n), mm = Math.round((n - hh) * 60);
  return mm ? `${hh}:${String(mm).padStart(2, '0')}` : String(hh);
}

// Panel "Por persona": a cada uno su tiempo de respuesta (en su turno),
// qué tipos atiende y cuánto tarda en cerrar.
function htmlEquipo(equipo) {
  if (!equipo || !equipo.length) return '';
  const maxTipo = Math.max(1, ...equipo.flatMap(p => p.tipos.map(t => t.cantidad)));
  const tarjetas = equipo.map(p => {
    const r = p.respuesta || {};
    const turno = p.turno ? `🕑 ${fmtHora(p.turno.desde)}–${fmtHora(p.turno.hasta)} h` : 'sin turno (horas corridas)';
    const tipos = p.tipos.length
      ? p.tipos.slice(0, 6).map(t => `<span class="persona-tipo" title="${esc(t.tipo)}: ${t.cantidad}">
          <span class="persona-tipo-barra" style="width:${Math.max(16, t.cantidad * 44 / maxTipo)}px"></span>
          ${esc(t.tipo)} <b>${t.cantidad}</b></span>`).join('')
      : '<span class="met-nota">Sin consultas atendidas en este período</span>';
    return `<div class="met-persona">
      <div class="persona-cab">
        <div class="chat-av" style="background:${avatarColor(p.nombre)}">${esc(String(p.nombre || '?')[0].toUpperCase())}</div>
        <div class="persona-id"><div class="persona-nombre">${esc(p.nombre)}</div><div class="persona-turno">${turno}</div></div>
      </div>
      <div class="persona-cifras">
        <div class="persona-cifra">
          <div class="persona-valor">${fmtDuracion(r.mediana)}</div>
          <div class="persona-cifra-pie">respuesta ${r.muestras ? `· ${r.muestras} · prom ${fmtDuracion(r.promedio)}` : '· sin datos'}</div>
        </div>
        <div class="persona-cifra">
          <div class="persona-valor">${p.cerradas ? fmtDuracion(p.cierre) : '—'}</div>
          <div class="persona-cifra-pie">${p.cerradas ? `cierre · ${p.cerradas} cerrada${p.cerradas === 1 ? '' : 's'}` : 'no cerró ninguna'}</div>
        </div>
      </div>
      <div class="persona-tipos">${tipos}</div>
    </div>`;
  }).join('');
  return `<div class="met-panel">
    <h4>Por persona del equipo</h4>
    <p class="met-nota" style="margin-top:0">Cada respuesta se mide contra <strong>el turno de esa persona</strong>: el reloj se pausa fuera de su horario (no se cuenta la noche ni el turno del otro). El turno se configura en <strong>Admin → Usuarios</strong>.</p>
    <div class="met-personas">${tarjetas}</div>
  </div>`;
}

function htmlMetricas(m) {
  const r = m.resolucion, pr = m.primeraRespuesta, rc = m.respuestaCliente, ab = m.abiertas;
  const nr = m.nuestrasRespuestas, tn = m.tiempoNuestro;
  const periodoTexto = m.dias ? `últimos ${m.dias} días` : 'todo el historial';

  const tiles = [
    tile('Consultas nuevas', m.nuevas, periodoTexto),
    tile('Resueltas', m.resueltas, r.aproximadas ? `${r.aproximadas} con cierre estimado` : periodoTexto),
    tile('Nuestra 1ª respuesta', fmtDuracion(pr.mediana), pr.sinResponder ? `${pr.sinResponder} sin responder` : (pr.muestras ? `promedio ${fmtDuracion(pr.promedio)} · ${pr.muestras} consultas` : 'sin datos todavía'), !!pr.sinResponder),
    tile('Nuestras respuestas', fmtDuracion(nr.mediana), nr.muestras ? `promedio ${fmtDuracion(nr.promedio)} · ${nr.muestras} respuestas` : 'sin datos todavía'),
    tile('Tiempo nuestro hasta cerrar', fmtDuracion(tn.mediana), tn.muestras ? `sin contar la espera del cliente · ${tn.muestras} consultas` : 'sin datos todavía'),
    tile('Resolución total', fmtDuracion(r.mediana), r.muestras ? `de punta a punta · promedio ${fmtDuracion(r.promedio)}` : 'sin datos todavía'),
    tile('Respuesta del cliente', fmtDuracion(rc.mediana), rc.muestras ? `promedio ${fmtDuracion(rc.promedio)} · ${rc.muestras} respuestas` : 'sin datos todavía'),
    tile('Abiertas ahora', ab.cantidad, ab.cantidad ? `la más vieja: ${fmtDuracion(ab.antiguedadMaxima)}${ab.masDe48h ? ` · ${ab.masDe48h} de más de 48 h` : ''}` : 'ninguna pendiente', ab.masDe48h > 0),
  ].join('');

  // Tipos de consulta: una sola serie, un solo color, con el número al lado
  const maxTipo = m.tipos.length ? m.tipos[0].cantidad : 0;
  const totalTipos = m.tipos.reduce((a, t) => a + t.cantidad, 0);
  const tipos = m.tipos.length
    ? m.tipos.map(t => {
        const pct = totalTipos ? Math.round(t.cantidad * 100 / totalTipos) : 0;
        return `<div class="barra-fila" title="${esc(t.tipo)}: ${t.cantidad} consultas (${pct}%)">
          <div class="barra-nombre">${esc(t.tipo)}</div>
          <div class="barra-pista"><div class="barra-valor-fill" style="width:${maxTipo ? Math.max(2, t.cantidad * 100 / maxTipo) : 0}%"></div></div>
          <div class="barra-cifra">${t.cantidad} <span>(${pct}%)</span></div>
        </div>`;
      }).join('')
    : '<p class="met-nota">Todavía no hay consultas en este período.</p>';

  const filas = m.clientes.length
    ? m.clientes.map(c => `<tr>
        <td>${esc(c.cliente)}</td>
        <td class="num">${c.nuevas}</td>
        <td class="num">${c.resueltas}</td>
        <td class="num">${fmtDuracion(c.nuestro)}</td>
        <td class="num">${fmtDuracion(c.resolucion)}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="color:var(--text-muted)">Sin datos en este período</td></tr>';

  return `
    <div class="met-grid">${tiles}</div>

    ${htmlEquipo(m.equipo)}

    <div class="met-panel">
      <h4>Qué nos consultan (${totalTipos} consulta${totalTipos === 1 ? '' : 's'})</h4>
      ${tipos}
    </div>

    <div class="met-panel">
      <h4>Por cliente</h4>
      <table class="met-tabla">
        <thead><tr><th>Cliente</th><th style="text-align:right">Nuevas</th><th style="text-align:right">Resueltas</th><th style="text-align:right">Tiempo nuestro</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>

    <p class="met-nota">
      <strong>Tiempo nuestro hasta cerrar</strong> es el total menos lo que estuvimos esperando una respuesta del cliente:
      mide lo que tardamos nosotros. <strong>Resolución total</strong> es lo que vivió el cliente, de punta a punta.<br>
      Los tiempos son en <strong>horas corridas</strong>: el reloj corre también de noche y los fines de semana.
      Se muestra la <strong>mediana</strong> (el caso del medio), que no se deforma con un caso extremo; el promedio va abajo.
      “Resuelta” es una consulta cerrada.
      ${m.resolucion.aproximadas ? `<br>${m.resolucion.aproximadas} consultas cerradas antes de que empezáramos a medir tienen fecha de cierre estimada y no entran en el tiempo de resolución.` : ''}
      ${m.excluidas ? `<br>${m.excluidas} consultas quedaron fuera de estos números: son las que se cerraron en la limpieza del 24/09 y no representan trabajo del día. Se siguen viendo en las listas.` : ''}
    </p>`;
}
