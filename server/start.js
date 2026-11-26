import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { ephemerisMiddleware } from './ephemeris.js';
import { productsMiddleware } from './products.js';

const dist = resolve('dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/ephemeris') return ephemerisMiddleware(req, res);
  if (url.pathname.startsWith('/api/products/')) return productsMiddleware(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  try {
    let path = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (path !== dist && !path.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
    try { if (!(await stat(path)).isFile()) path = resolve(dist, 'index.html'); }
    catch { if (extname(path)) { res.writeHead(404); res.end(); return; } path = resolve(dist, 'index.html'); }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('请先运行 npm run build'); }
});
server.listen(Number(process.env.PORT) || 4173, '0.0.0.0', () => console.log(`ORBIT: http://localhost:${server.address().port}`));
