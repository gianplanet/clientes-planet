import { describe, it, expect } from 'vitest';
import { llamar, crearUsuario, entrar, escenario, db } from './ayuda.js';

describe('login', () => {
  it('entra con usuario y contraseña, sin importar mayúsculas ni espacios', async () => {
    await crearUsuario('nico.nume', { nombre: 'Nico' });
    const r = await llamar({ action: 'login', usuario: '  Nico.NUME ', password: ' clave123 ' });
    expect(r.ok).toBe(true);
    expect(r.token).toMatch(/^[0-9a-f-]{60,}$/);
    expect(r.user).toEqual({ usuario: 'nico.nume', nombre: 'Nico', team: 'cliente', cliente: 'NUME', role: 'user' });
    expect(r.consultas).toEqual([]);
    expect(r.notas).toBeUndefined();   // los post-its son solo de Planet
  });

  it('rechaza una contraseña incorrecta sin decir cuál de los dos datos falló', async () => {
    await crearUsuario('nico.nume');
    const r = await llamar({ action: 'login', usuario: 'nico.nume', password: 'otra' });
    expect(r).toEqual({ ok: false, error: 'Usuario o contraseña incorrectos' });
    const r2 = await llamar({ action: 'login', usuario: 'nadie', password: 'otra' });
    expect(r2.error).toBe(r.error);
  });

  it('bloquea 15 minutos después de 8 intentos fallidos, aunque cambie de IP', async () => {
    await crearUsuario('nico.nume');
    for (let i = 0; i < 8; i++) await llamar({ action: 'login', usuario: 'nico.nume', password: 'mal' + i });
    const r = await llamar({ action: 'login', usuario: 'nico.nume', password: 'clave123' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Demasiados intentos/);
  });

  it('bloquea una IP que prueba muchos usuarios distintos', async () => {
    await crearUsuario('nico.nume');
    for (let i = 0; i < 60; i++) await llamar({ action: 'login', usuario: 'u' + i, password: 'x' }, { desdeIp: '1.2.3.4' });
    const bloqueada = await llamar({ action: 'login', usuario: 'nico.nume', password: 'clave123' }, { desdeIp: '1.2.3.4' });
    expect(bloqueada.error).toMatch(/Demasiados intentos/);
    const otraIp = await llamar({ action: 'login', usuario: 'nico.nume', password: 'clave123' }, { desdeIp: '5.6.7.8' });
    expect(otraIp.ok).toBe(true);
  });

  it('un login correcto limpia los intentos fallidos de ese usuario', async () => {
    await crearUsuario('nico.nume');
    for (let i = 0; i < 5; i++) await llamar({ action: 'login', usuario: 'nico.nume', password: 'mal' });
    await entrar('nico.nume');
    const { n } = await db.prepare("SELECT COUNT(*) n FROM intentos_login WHERE clave = 'u:nico.nume'").first();
    expect(n).toBe(0);
  });

  it('sigue aceptando pedidos por GET (versión anterior del portal)', async () => {
    await crearUsuario('nico.nume');
    const r = await llamar({ action: 'login', usuario: 'nico.nume', password: 'clave123' }, { metodo: 'GET' });
    expect(r.ok).toBe(true);
  });
});

describe('sesión', () => {
  it('sin token o con token inválido pide volver a entrar', async () => {
    expect(await llamar({ action: 'consultas' })).toMatchObject({ ok: false, auth: false });
    expect(await llamar({ action: 'consultas', token: 'inventado' })).toMatchObject({ ok: false, auth: false });
  });

  it('logout invalida el token', async () => {
    await crearUsuario('nico.nume');
    const api = await entrar('nico.nume');
    expect((await api({ action: 'consultas' })).ok).toBe(true);
    expect((await api({ action: 'logout' })).ok).toBe(true);
    expect(await api({ action: 'consultas' })).toMatchObject({ auth: false });
  });

  it('una sesión vencida no sirve', async () => {
    await crearUsuario('nico.nume');
    const api = await entrar('nico.nume');
    await db.prepare('UPDATE sesiones SET expira = 1').run();
    expect(await api({ action: 'consultas' })).toMatchObject({ auth: false });
  });

  it('un usuario eliminado pierde la sesión al instante', async () => {
    const { admin, nume } = await escenario();
    expect((await admin({ action: 'eliminar_usuario', usuario: 'nico.nume' })).ok).toBe(true);
    expect(await nume({ action: 'consultas' })).toMatchObject({ auth: false });
  });

  it('acción desconocida o sin acción', async () => {
    expect(await llamar({})).toEqual({ ok: false, error: 'Falta el parámetro action' });
    const { nume } = await escenario();
    expect((await nume({ action: 'borrar_todo' })).error).toMatch(/no reconocida/);
  });
});

describe('permisos por rol', () => {
  const soloPlanet = ['cambiar_estado', 'metricas', 'clientes', 'notas', 'nota_guardar', 'nota_borrar'];
  const soloAdmin = ['usuarios', 'crear_usuario', 'editar_usuario', 'eliminar_usuario', 'crear_cliente', 'editar_cliente', 'eliminar_cliente'];

  it('un cliente no puede usar acciones de Planet ni de admin', async () => {
    const { nume } = await escenario();
    for (const action of [...soloPlanet, ...soloAdmin]) {
      expect(await nume({ action }), action).toEqual({ ok: false, error: 'No tenés permiso para esta acción' });
    }
  });

  it('Planet sin rol admin no puede gestionar usuarios ni clientes', async () => {
    const { planet } = await escenario();
    for (const action of soloAdmin) {
      expect((await planet({ action })).error, action).toBe('No tenés permiso para esta acción');
    }
    expect((await planet({ action: 'clientes' })).ok).toBe(true);
    expect((await planet({ action: 'metricas' })).ok).toBe(true);
  });

  it('un cambio de rol aplica al instante, sin volver a entrar', async () => {
    const { admin, planet } = await escenario();
    expect((await planet({ action: 'usuarios' })).ok).toBe(false);
    await admin({ action: 'editar_usuario', usuario: 'beto.planet', role: 'admin' });
    expect((await planet({ action: 'usuarios' })).ok).toBe(true);
  });
});
