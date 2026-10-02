// Este archivo lo corre el navegador por su cuenta, incluso con el portal
// cerrado. Lo único que hace es mostrar los avisos que manda el servidor y
// abrir la consulta cuando los tocan. No guarda nada ni toca la sesión.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const titulo = d.titulo || 'Portal Planet';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || '',
    icon: 'logo.png',
    badge: 'logo.png',
    // Varios avisos de la misma consulta se reemplazan en vez de apilarse
    tag: d.id ? 'consulta-' + d.id : 'portal-planet',
    renotify: true,
    data: { id: d.id || null },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  const base = self.registration.scope;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si ya tiene el portal abierto, lo trae al frente en vez de abrir otra pestaña
    for (const c of abiertas) {
      if (c.url.startsWith(base)) {
        await c.focus();
        c.postMessage({ abrirConsulta: id });
        return;
      }
    }
    await self.clients.openWindow(id ? base + '?c=' + id : base);
  })());
});
