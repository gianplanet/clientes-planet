// Sirve el portal (index.html, css/, js/, logo.png) como lo hace GitHub Pages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const PERMITIDOS = /^\/(index\.html|logo\.png|css\/[\w-]+\.css|js\/[\w-]+\.js)$/;

createServer(async (req, res) => {
  let ruta = new URL(req.url, 'http://x').pathname;
  if (ruta === '/') ruta = '/index.html';
  if (!PERMITIDOS.test(ruta)) { res.writeHead(404).end('No encontrado'); return; }
  try {
    const datos = await readFile(path.join(raiz, ruta));
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream' }).end(datos);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(5500, '127.0.0.1', () => console.log('Portal en http://127.0.0.1:5500'));
