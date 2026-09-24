// Tabla de acciones del API: qué hace cada una y quién puede usarla.
//
// Niveles de acceso:
//   publica → sin sesión (login, logout)
//   usuario → cualquier usuario con sesión
//   planet  → solo el equipo de Planet
//   admin   → solo admins de Planet

import { ok, err, authErr } from './http.js';
import { login, logout, usuarioDeSesion, esPlanet, esAdmin } from './auth.js';
import { listarConsultas, ultimoCambio, nuevaConsulta, responder, cambiarEstado } from './consultas.js';
import { metricas } from './metricas.js';
import { listarNotas, guardarNota, borrarNota } from './notas.js';
import {
  listarUsuarios, crearUsuario, editarUsuario, eliminarUsuario,
  listarClientes, crearCliente, editarCliente, eliminarCliente,
} from './admin.js';
import { subirImagen } from './imagenes.js';

// Lo que se manda al cargar y en cada actualización: consultas + (para Planet)
// sus post-its, así se sincronizan si los edita desde otra computadora
async function paquete(db, me, p) {
  const datos = await listarConsultas(db, me, p);
  if (esPlanet(me)) datos.notas = await listarNotas(db, me);
  return datos;
}

function datosUsuario(u) {
  return { usuario: u.usuario, nombre: u.nombre, team: u.team, cliente: u.cliente, role: u.role };
}

const ACCIONES = {
  login: {
    acceso: 'publica',
    fn: async ({ db, p, ctx }) => {
      const r = await login(db, p, ctx);
      if (r.error) return r.error;
      return ok({ token: r.token, user: datosUsuario(r.user), ...(await paquete(db, r.user, {})) });
    },
  },
  logout: { acceso: 'publica', fn: ({ db, p }) => logout(db, p) },

  consultas: { acceso: 'usuario', fn: async ({ db, me, p }) => ok(await paquete(db, me, p)) },
  novedades: { acceso: 'usuario', fn: async ({ db, me }) => ok({ ultimo: await ultimoCambio(db, me) }) },
  nueva_consulta: { acceso: 'usuario', fn: ({ db, me, p }) => nuevaConsulta(db, me, p) },
  responder: { acceso: 'usuario', fn: ({ db, me, p }) => responder(db, me, p) },
  subir_imagen: { acceso: 'usuario', fn: ({ env, p, ctx }) => subirImagen(env, p, ctx.origen) },

  cambiar_estado: { acceso: 'planet', fn: ({ db, me, p }) => cambiarEstado(db, me, p) },
  metricas: { acceso: 'planet', fn: ({ db, p }) => metricas(db, p) },
  clientes: { acceso: 'planet', fn: ({ db }) => listarClientes(db) },
  notas: { acceso: 'planet', fn: async ({ db, me }) => ok({ notas: await listarNotas(db, me) }) },
  nota_guardar: { acceso: 'planet', fn: ({ db, me, p }) => guardarNota(db, me, p) },
  nota_borrar: { acceso: 'planet', fn: ({ db, me, p }) => borrarNota(db, me, p) },

  usuarios: { acceso: 'admin', fn: ({ db }) => listarUsuarios(db) },
  crear_usuario: { acceso: 'admin', fn: ({ db, p }) => crearUsuario(db, p) },
  editar_usuario: { acceso: 'admin', fn: ({ db, me, p }) => editarUsuario(db, me, p) },
  eliminar_usuario: { acceso: 'admin', fn: ({ db, me, p }) => eliminarUsuario(db, me, p) },
  crear_cliente: { acceso: 'admin', fn: ({ db, p }) => crearCliente(db, p) },
  editar_cliente: { acceso: 'admin', fn: ({ db, p }) => editarCliente(db, p) },
  eliminar_cliente: { acceso: 'admin', fn: ({ db, p }) => eliminarCliente(db, p) },
};

const PERMITIDO = {
  usuario: () => true,
  planet: esPlanet,
  admin: esAdmin,
};

export async function ejecutar(action, p, env, ctx) {
  const accion = ACCIONES[action];
  if (!accion) return err('Acción no reconocida: ' + action);
  const db = env.DB;

  let me = null;
  if (accion.acceso !== 'publica') {
    me = await usuarioDeSesion(db, p.token);
    if (!me) return authErr();
    if (!PERMITIDO[accion.acceso](me)) return err('No tenés permiso para esta acción');
    me.token = String(p.token);
  }
  return accion.fn({ db, env, me, p, ctx });
}
