// ═══ ADMIN: USUARIOS Y CLIENTES ═══

function mostrarOcultar(id) {
  const el = $(id);
  el.hidden = !el.hidden;
}

// ── USUARIOS ──
// Van agrupados por empresa (y el equipo de Planet primero): con 40 clientes
// una lista sola se vuelve imposible de mirar.
let usuarioEditando = null;
let usuariosCargados = [];
let busquedaUsuarios = '';
const grupoTocado = {};          // los que el admin abrió o cerró a mano
const POCAS_EMPRESAS = 6;        // hasta acá arrancan abiertas
let _pocasEmpresas = true;

function mostrarCampoEmpresa() {
  $('nu-empresa-wrap').hidden = $('nu-team').value !== 'cliente';
}

async function cargarUsuarios() {
  const cont = $('users-list');
  cont.innerHTML = esqueletoHtml(3);
  const res = await api({ action: 'usuarios' });
  if (!res.ok) { cont.innerHTML = '<div class="empty-state"><p>Error cargando usuarios</p></div>'; return; }
  usuariosCargados = res.usuarios || [];
  pintarUsuarios();
}

function buscarUsuarios(texto) {
  busquedaUsuarios = texto;
  const el = $('users-search');
  if (el.value !== texto) el.value = texto;
  el.closest('.search-row').classList.toggle('con-texto', !!texto);
  pintarUsuarios();
}

// Buscando, se abre todo; si no, Planet siempre y las empresas solo si son pocas
function grupoAbierto(clave) {
  if (busquedaUsuarios) return true;
  if (clave in grupoTocado) return grupoTocado[clave];
  return clave === 'planet' || _pocasEmpresas;
}
function toggleGrupoUsuarios(clave) {
  grupoTocado[clave] = !grupoAbierto(clave);
  pintarUsuarios();
}

function pintarUsuarios() {
  const cont = $('users-list');
  if (!usuariosCargados.length) { cont.innerHTML = '<div class="empty-state"><p>No hay usuarios</p></div>'; return; }

  const q = normalizar(busquedaUsuarios);
  const coincide = u => !q || normalizar([u.usuario, u.nombre, u.cliente].join(' ')).includes(q);
  const dePlanet = usuariosCargados.filter(u => u.team === 'planet');
  const deClientes = usuariosCargados.filter(u => u.team !== 'planet');

  // Todas las empresas: las que tienen usuarios y las registradas que no tienen ninguno
  const empresas = [...new Set(deClientes.map(u => u.cliente || '-')
    .concat(clientesRegistrados.map(c => c.nombre)))]
    .filter(n => n && n !== '-')
    .sort((a, b) => a.localeCompare(b, 'es'));
  _pocasEmpresas = empresas.length <= POCAS_EMPRESAS;

  const grupos = [grupoUsuarios('planet', 'Equipo Planet', dePlanet, coincide)]
    .concat(empresas.map(n => grupoUsuarios(n, n, deClientes.filter(u => (u.cliente || '-') === n), coincide)));
  const sinEmpresa = deClientes.filter(u => !u.cliente || u.cliente === '-');
  if (sinEmpresa.length) grupos.push(grupoUsuarios('-', 'Sin empresa', sinEmpresa, coincide));

  const html = grupos.filter(Boolean).join('');
  cont.innerHTML = html || `<div class="empty-state"><p>Ningún usuario coincide con “${esc(busquedaUsuarios)}”</p></div>`;
}

function grupoUsuarios(clave, titulo, usuarios, coincide) {
  const visibles = usuarios.filter(coincide);
  if (busquedaUsuarios && !visibles.length) return '';   // buscando, solo lo que coincide
  const abierto = grupoAbierto(clave);
  const n = usuarios.length;
  const cuenta = n ? `${n} usuario${n === 1 ? '' : 's'}` : 'sin usuarios todavía';
  const agregar = clave === '-' ? '' :
    `<button class="btn-chico grupo-agregar" onclick="event.stopPropagation();nuevoUsuarioEn(${jsArg(clave)})">+ Agregar</button>`;
  return `
    <div class="grupo-usuarios${abierto ? ' abierto' : ''}${n ? '' : ' vacio'}">
      <div class="grupo-cab" onclick="toggleGrupoUsuarios(${jsArg(clave)})">
        <span class="grupo-nombre">${esc(titulo)}</span>
        <span class="grupo-cuenta">${cuenta}</span>
        ${agregar}
        ${CHEVRON}
      </div>
      ${abierto && visibles.length ? visibles.map(u => usuarioEditando === u.usuario ? filaEditandoUsuario(u) : filaUsuario(u)).join('') : ''}
    </div>`;
}

// "8", "8:30", "17" — hora de turno para mostrar
function fmtHoraTurno(h) {
  if (h == null || h === '') return '';
  const n = Number(h);
  const hh = Math.floor(n), mm = Math.round((n - hh) * 60);
  return mm ? `${hh}:${String(mm).padStart(2, '0')}` : String(hh);
}
function textoTurno(u) {
  if (u.turno_desde == null || u.turno_hasta == null) return '';
  return `${fmtHoraTurno(u.turno_desde)}–${fmtHoraTurno(u.turno_hasta)} h`;
}

function filaUsuario(u) {
  const turno = u.team === 'planet' ? textoTurno(u) : '';
  return `
    <div class="fila-usuario">
      <div class="fila-avatar" style="background:${avatarColor(u.nombre)}">${esc((u.nombre || '?')[0])}</div>
      <div class="fila-datos">
        <div class="nombre">${esc(u.nombre)}</div>
        <div class="usuario">${esc(u.usuario)}${turno ? ` · <span class="fila-turno">🕑 ${turno}</span>` : ''}</div>
      </div>
      ${u.role === 'admin' ? '<span class="etiqueta admin">Admin</span>' : ''}
      <div class="fila-acciones">
        <button class="btn-chico" onclick="editarUsuario(${jsArg(u.usuario)})">Editar</button>
        <button class="btn-chico peligro" onclick="eliminarUsuario(${jsArg(u.usuario)}, ${jsArg(u.nombre)})">Eliminar</button>
      </div>
    </div>`;
}

function filaEditandoUsuario(u) {
  const opcion = (valor, texto, actual) => `<option value="${esc(valor)}"${valor === actual ? ' selected' : ''}>${esc(texto)}</option>`;
  const empresas = clientesRegistrados.map(c => opcion(c.nombre, c.nombre, u.cliente)).join('');
  return `
    <div class="fila-usuario editando">
      <div class="quien">${esc(u.usuario)}</div>
      <div class="admin-grid">
        <div class="field"><label>Nombre</label><input type="text" id="eu-nombre" value="${esc(u.nombre)}"></div>
        <div class="field"><label>Equipo</label>
          <select id="eu-team" onchange="$('eu-cliente-wrap').hidden = this.value !== 'cliente'; $('eu-turno-wrap').hidden = this.value !== 'planet'">
            ${opcion('planet', 'Planet', u.team)}${opcion('cliente', 'Cliente', u.team)}
          </select>
        </div>
        <div class="field" id="eu-cliente-wrap"${u.team === 'cliente' ? '' : ' hidden'}><label>Empresa</label>
          <select id="eu-cliente">${empresas}</select>
        </div>
        <div class="field turno-field" id="eu-turno-wrap"${u.team === 'planet' ? '' : ' hidden'}>
          <label>Turno <span class="field-hint">(para las métricas; vacío = horas corridas)</span></label>
          <div class="turno-row">
            <input type="number" id="eu-turno-desde" min="0" max="24" step="0.5" placeholder="desde" value="${u.turno_desde ?? ''}">
            <span>a</span>
            <input type="number" id="eu-turno-hasta" min="0" max="24" step="0.5" placeholder="hasta" value="${u.turno_hasta ?? ''}">
            <span>h</span>
          </div>
        </div>
        <div class="field"><label>Rol</label>
          <select id="eu-role">${opcion('user', 'Usuario', u.role)}${opcion('admin', 'Admin', u.role)}</select>
        </div>
        <div class="field"><label>Nueva contraseña</label>
          <input type="text" id="eu-pass" placeholder="Dejala vacía para no cambiarla" autocomplete="off">
        </div>
      </div>
      <div class="admin-botones">
        <button class="btn-chico" onclick="editarUsuario(null)">Cancelar</button>
        <button class="btn-chico primario" onclick="guardarUsuario(${jsArg(u.usuario)}, this)">Guardar</button>
      </div>
    </div>`;
}

function editarUsuario(usuario) {
  usuarioEditando = usuario;
  pintarUsuarios();
}

// "+ Agregar" de un grupo: abre el formulario con la empresa ya puesta
function nuevoUsuarioEn(clave) {
  const form = $('new-user-form');
  form.hidden = false;
  $('nu-team').value = clave === 'planet' ? 'planet' : 'cliente';
  mostrarCampoEmpresa();
  if (clave !== 'planet') $('nu-empresa').value = clave;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('nu-user').focus();
}

async function guardarUsuario(usuario, btn) {
  const team = $('eu-team').value;
  const params = {
    action: 'editar_usuario', usuario, team, role: $('eu-role').value,
    nombre: $('eu-nombre').value.trim(),
    cliente: team === 'cliente' ? $('eu-cliente').value : '-',
  };
  const pass = $('eu-pass').value.trim();
  if (pass) params.password = pass;
  if (team === 'planet') {
    params.turno_desde = $('eu-turno-desde').value.trim();
    params.turno_hasta = $('eu-turno-hasta').value.trim();
  }
  const listo = ocupado(btn, 'Guardando...');
  const res = await api(params);
  listo();
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo actualizar'));
  toast('✓ Usuario actualizado');
  usuarioEditando = null;
  cargarUsuarios();   // lo volvemos a pedir: así se ve guardado lo que guardó el servidor
}

async function eliminarUsuario(usuario, nombre) {
  if (usuario === sesion.usuario) return toast('No podés eliminar tu propio usuario');
  if (!confirm(`¿Eliminar el usuario "${nombre}" (${usuario})? Esta acción no se puede deshacer.`)) return;
  const res = await api({ action: 'eliminar_usuario', usuario });
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo eliminar'));
  toast('✓ Usuario eliminado');
  usuariosCargados = usuariosCargados.filter(u => u.usuario !== usuario);
  pintarUsuarios();
}

async function crearUsuario(btn) {
  const usuario = $('nu-user').value.trim();
  const nombre = $('nu-name').value.trim();
  const password = $('nu-pass').value.trim();
  const team = $('nu-team').value;
  const cliente = team === 'cliente' ? $('nu-empresa').value : '-';
  if (!usuario || !nombre || !password) { sacudirVacios(['nu-user', 'nu-name', 'nu-pass']); return toast('Completá usuario, nombre y contraseña'); }
  if (team === 'cliente' && !cliente) { sacudir($('nu-empresa')); return toast('Completá la empresa del cliente'); }

  const listo = ocupado(btn, 'Creando...');
  const res = await api({ action: 'crear_usuario', usuario, password, nombre, team, cliente, role: $('nu-role').value });
  listo();
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo crear'));
  toast('✓ Usuario creado');
  ['nu-user', 'nu-name', 'nu-pass', 'nu-empresa'].forEach(id => { $(id).value = ''; });
  $('new-user-form').hidden = true;
  cargarUsuarios();
}

// ── CLIENTES ──
async function cargarClientes() {
  const cont = $('clients-list');
  cont.innerHTML = esqueletoHtml(3);
  const res = await api({ action: 'clientes' });
  if (!res.ok) { cont.innerHTML = '<div class="empty-state"><p>Error cargando clientes</p></div>'; return; }
  clientesRegistrados = res.clientes || [];
  clientesCambiaron();
  if (!clientesRegistrados.length) { cont.innerHTML = '<div class="empty-state"><p>No hay clientes registrados</p></div>'; return; }
  const dato = (label, valor) => `<div><span>${label}:</span> ${esc(valor || '-')}</div>`;
  cont.innerHTML = clientesRegistrados.map(c => `
    <div class="cliente-ficha">
      <div class="cliente-ficha-top">
        <div>
          <h4>${esc(c.nombre)}</h4>
          <div class="alta">Alta: ${esc(c.fecha_alta || '-')}</div>
        </div>
        <button class="btn-chico peligro" onclick="eliminarCliente(${c.id}, ${jsArg(c.nombre)})">Eliminar</button>
      </div>
      <div class="cliente-datos">
        ${dato('Contacto', c.contacto)}${dato('Teléfono', c.telefono)}${dato('Email', c.email)}${dato('Dirección', c.direccion)}
      </div>
      ${c.notas ? `<div class="cliente-notas">${esc(c.notas)}</div>` : ''}
    </div>`).join('');
}

// Las empresas del formulario de usuario nuevo
function llenarEmpresasUsuario() {
  $('nu-empresa').innerHTML = '<option value="">-- Seleccionar --</option>' +
    clientesRegistrados.map(c => `<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`).join('');
}

const CAMPOS_CLIENTE = ['nombre', 'contacto', 'telefono', 'email', 'direccion', 'notas'];

async function crearCliente(btn) {
  const datos = Object.fromEntries(CAMPOS_CLIENTE.map(k => [k, $('nc-' + k).value.trim()]));
  if (!datos.nombre) { sacudir($('nc-nombre')); return toast('Completá el nombre de la empresa'); }
  const listo = ocupado(btn, 'Creando...');
  const res = await api(Object.assign({ action: 'crear_cliente' }, datos));
  listo();
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo crear'));
  toast('✓ Cliente creado');
  CAMPOS_CLIENTE.forEach(k => { $('nc-' + k).value = ''; });
  $('new-client-form').hidden = true;
  cargarClientes();
}

async function eliminarCliente(id, nombre) {
  if (!confirm(`¿Eliminar el cliente "${nombre}"? Esta acción no se puede deshacer.`)) return;
  const res = await api({ action: 'eliminar_cliente', id });
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo eliminar'));
  toast('✓ Cliente eliminado');
  cargarClientes();
}
