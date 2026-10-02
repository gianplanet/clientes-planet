// El cifrado de los avisos se prueba contra el ejemplo del estándar RFC 8291:
// si nuestro resultado es idéntico al del papel, los teléfonos lo van a poder abrir.
import { describe, it, expect } from 'vitest';
import { cifrar, aB64url, deB64url } from '../src/push.js';
import { tituloAviso } from '../src/consultas.js';

// Sección 5 del RFC 8291
const EJEMPLO = {
  mensaje: 'When I grow up, I want to be a watermelon',
  suPublica: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  miPrivada: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  miPublica: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  esperado: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const P256 = { name: 'ECDH', namedCurve: 'P-256' };

// Arma el par de claves del ejemplo (normalmente se generan al azar en cada envío)
async function claveDelEjemplo() {
  const pub = deB64url(EJEMPLO.miPublica);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: aB64url(pub.slice(1, 33)),
    y: aB64url(pub.slice(33, 65)),
  };
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, P256, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: EJEMPLO.miPrivada }, P256, false, ['deriveBits']),
  };
}

describe('avisos al teléfono', () => {
  it('cifra igual que el ejemplo del estándar', async () => {
    const cuerpo = await cifrar(EJEMPLO.mensaje, EJEMPLO.suPublica, EJEMPLO.auth, {
      salt: deB64url(EJEMPLO.salt),
      claveLocal: await claveDelEjemplo(),
    });
    expect(aB64url(cuerpo)).toBe(EJEMPLO.esperado);
  });

  it('cada envío usa una sal y una clave distintas', async () => {
    const uno = await cifrar('hola', EJEMPLO.suPublica, EJEMPLO.auth);
    const otro = await cifrar('hola', EJEMPLO.suPublica, EJEMPLO.auth);
    expect(aB64url(uno)).not.toBe(aB64url(otro));
    // Arranca con 16 de sal + 4 de tamaño + 1 + la clave pública (65)
    expect(uno.length).toBe(16 + 4 + 1 + 65 + 'hola'.length + 1 + 16);
  });

  it('el aviso dice lo que pasó, visto por el que lo recibe', () => {
    const planet = { dePlanet: true, direccion: 'cliente_a_planet', cliente: 'NUME' };
    // "Enviar y cerrar" no es una respuesta más: es que se la resolvimos
    expect(tituloAviso({ ...planet, nuevo: 'Cerrado' })).toBe('Planet resolvió tu consulta');
    expect(tituloAviso({ ...planet, nuevo: 'En proceso' })).toBe('Planet te respondió');
    expect(tituloAviso({ ...planet, nuevo: 'Esperando info' })).toBe('Planet necesita info tuya');
    expect(tituloAviso({ ...planet, nuevo: 'En proceso', reabre: true })).toBe('Planet reabrió una consulta');
    // Una consulta que hicimos nosotros no se le "resuelve" al cliente
    expect(tituloAviso({ ...planet, direccion: 'planet_a_cliente', nuevo: 'Cerrado' })).toBe('Planet cerró la consulta');
    // Y del otro lado
    expect(tituloAviso({ dePlanet: false, cliente: 'NUME', nuevo: 'Respuesta cliente' })).toBe('NUME respondió');
    expect(tituloAviso({ dePlanet: false, cliente: 'NUME', reabre: true })).toBe('NUME reabrió una consulta');
  });

  it('base64url va y vuelve', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(70));
    expect([...deB64url(aB64url(bytes))]).toEqual([...bytes]);
  });
});
