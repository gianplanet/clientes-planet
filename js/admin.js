// ═══ ADMIN: USUARIOS Y CLIENTES ═══

function mostrarOcultar(id) {
  const el = $(id);
  el.hidden = !el.hidden;
}

// ── USUARIOS ──
let usuarioEditando = null;

function mostrarCampoEmpresa() {
  $('nu-empresa-wrap').hidden = $('nu-team').value !== 'cliente';
}

async function cargarUsuarios() {
  const cont = $('users-list');
  cont.innerHTML = esqueletoHtml(3);
  const res = await api({ action: 'usuarios' });
  if (!res.ok) { cont.innerHTML = '<div class="empty-state"><p>Error cargando usuarios</p></div>'; return; }
  if (!res.usuarios.length) { cont.innerHTML = '<div class="empty-state"><p>No hay usuarios</p></div>'; return; }
  cont.innerHTML = `
    <div class="tabla-scroll"><table class="tabla-admin">
      <thead><tr><th>Usuario</th><th>Nombre</th><th>Equipo</th><th>Empresa</th><th>Rol</th><th></th></tr></thead>
      <tbody>${res.usuarios.map(u => usuarioEditando === u.usuario ? filaEditandoUsuario(u) : filaUsuario(u)).join('')}</tbody>
    </table></div>`;
}

function filaUsuario(u) {
  return `<tr>
    <td><strong>${esc(u.usuario)}</strong></td>
    <td>${esc(u.nombre)}</td>
    <td><span class="etiqueta ${u.team === 'planet' ? 'planet' : 'cliente'}">${u.team === 'planet' ? 'Planet' : 'Cliente'}</span></td>
    <td>${esc(u.cliente || '-')}</td>
    <td>${u.role === 'admin' ? '<span class="etiqueta admin">Admin</span>' : ''}</td>
    <td class="acciones">
      <button class="btn-chico" onclick="editarUsuario(${jsArg(u.usuario)})">✏️ Editar</button>
      <button class="btn-chico peligro" onclick="eliminarUsuario(${jsArg(u.usuario)}, ${jsArg(u.nombre)})">Eliminar</button>
    </td>
  </tr>`;
}

function filaEditandoUsuario(u) {
  const opcion = (valor, texto, actual) => `<option value="${esc(valor)}"${valor === actual ? ' selected' : ''}>${esc(texto)}</option>`;
  const empresas = clientesRegistrados.map(c => opcion(c.nombre, c.nombre, u.cliente)).join('');
  return `<tr class="editando">
    <td><strong>${esc(u.usuario)}</strong></td>
    <td><input type="text" id="eu-nombre" value="${esc(u.nombre)}"></td>
    <td><select id="eu-team" onchange="$('eu-cliente').hidden = this.value !== 'cliente'">
      ${opcion('planet', 'Planet', u.team)}${opcion('cliente', 'Cliente', u.team)}
    </select></td>
    <td><select id="eu-cliente"${u.team === 'cliente' ? '' : ' hidden'}>${empresas}</select></td>
    <td><select id="eu-role">${opcion('user', 'Usuario', u.role)}${opcion('admin', 'Admin', u.role)}</select></td>
    <td class="acciones">
      <input type="text" id="eu-pass" placeholder="Nueva contraseña (opcional)" autocomplete="off">
      <button class="btn-chico primario" onclick="guardarUsuario(${jsArg(u.usuario)}, this)">Guardar</button>
      <button class="btn-chico" onclick="editarUsuario(null)">Cancelar</button>
    </td>
  </tr>`;
}

function editarUsuario(usuario) {
  usuarioEditando = usuario;
  cargarUsuarios();
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
  const listo = ocupado(btn, 'Guardando...');
  const res = await api(params);
  listo();
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo actualizar'));
  toast('✓ Usuario actualizado');
  editarUsuario(null);
}

async function eliminarUsuario(usuario, nombre) {
  if (usuario === sesion.usuario) return toast('No podés eliminar tu propio usuario');
  if (!confirm(`¿Eliminar el usuario "${nombre}" (${usuario})? Esta acción no se puede deshacer.`)) return;
  const res = await api({ action: 'eliminar_usuario', usuario });
  if (!res.ok) return toast('Error: ' + (res.error || 'No se pudo eliminar'));
  toast('✓ Usuario eliminado');
  cargarUsuarios();
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
  actualizarClientesNuevaConsulta();
  llenarEmpresasUsuario();
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
