/* Zero-dependency static server for local use, Lighthouse runs and manual
 * device testing. The app itself needs no server in production beyond static
 * file hosting. Run: npm run serve -- [port]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ''));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        info = await stat(filePath).catch(() => null);
      }
      if (!info) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }

      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': TYPES[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-length': body.length
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(`Server error: ${error.message}`);
    }
  });
}

export function listen(port = 0) {
  return new Promise((resolve) => {
    const server = createStaticServer();
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const port = Number(process.argv[2]) || 4173;
  listen(port).then(({ port: actual }) => {
    console.log(`RepTrack served at http://127.0.0.1:${actual}/  (Ctrl-C to stop)`);
  });
}
