# Portal de Clientes Planet

Portal donde los clientes le hacen consultas a Planet sobre sus envíos, y Planet
las atiende, les pide información y las cierra.

- **Portal** (lo que se ve): `index.html` + `css/` + `js/`, publicado con GitHub Pages en
  **https://atencionalcliente.planetlog.com.ar** (registro CNAME en la zona DNS de planetlog.com.ar,
  en el cPanel de Nuthost, apuntando a `gianplanet.github.io`; el archivo `CNAME` le dice a GitHub la dirección).
- **Servidor**: `servidor/`, en Cloudflare Workers, con la base de datos en D1 y las fotos en KV.

## Cómo está organizado

```
index.html            estructura de las pantallas (sin código)
css/portal.css        estilos (modo claro y oscuro)
js/                   código del portal, en este orden:
  base.js             ayudas generales (textos seguros, fechas, guardado local)
  api.js              conexión con el servidor
  animaciones.js      animaciones y avisos
  sesion.js           entrar/salir, datos cargados, actualización cada 30 s
  imagenes.js         fotos adjuntas
  consultas.js        lo común a las dos vistas (estados, búsqueda, orden, tarjetas)
  cliente.js          vista del cliente
  planet.js           vista de Planet
  metricas.js         pantalla de métricas
  notas.js            post-its de Planet
  guia.js             guía para clientes nuevos
  admin.js            usuarios y clientes (solo admin)
  inicio.js           arranque

servidor/
  src/index.js        entrada del servidor
  src/acciones.js     lista de acciones y quién puede usar cada una
  src/auth.js         contraseñas, sesiones y límite de intentos
  src/consultas.js    consultas, mensajes y estados
  src/metricas.js     números de la pantalla de métricas
  src/notas.js        post-its
  src/admin.js        usuarios y clientes
  src/imagenes.js     fotos
  migrations/         estructura de la base (cada cambio es un archivo nuevo)
  test/               pruebas del servidor

pruebas/              pruebas del portal en un navegador de verdad
```

## Pruebas

La primera vez: `npm install` y `npx playwright install chromium`.

```bash
npm test
```

Corre las dos tandas:

- **Servidor** (`npm run test:servidor`): cada acción, permisos, aislamiento entre clientes,
  flujo de estados, métricas, límite de intentos de login.
- **Portal** (`npm run test:portal`): abre Chromium, entra como cliente y como Planet y usa el
  portal de punta a punta, contra un servidor y una base **locales** (no toca producción).

## Publicar

1. **Servidor** (primero, porque acepta tanto el portal viejo como el nuevo):
   ```bash
   npm run deploy
   ```
   Corre las pruebas, aplica las migraciones pendientes a la base de producción y publica.
2. **Portal**: `git push` a `main` (GitHub Pages lo publica en 1 o 2 minutos).
   Si cambió algo de `css/` o `js/`, subir el número de `?v=` en `index.html` para que
   los navegadores no usen la versión vieja guardada.

## Cambios en la base de datos

Nunca editar una migración ya aplicada. Crear una nueva (`servidor/migrations/0003_algo.sql`)
y publicar con `npm run deploy`. Para ver cuáles faltan:

```bash
npx wrangler d1 migrations list portal-planet --remote --config servidor/wrangler.toml
```
