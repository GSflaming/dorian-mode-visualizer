import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wav': 'audio/wav', '.css': 'text/css', '.md': 'text/plain; charset=utf-8' };
export async function serve(port = 0) {
  const base = await realpath(root);
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      const relative = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
      const file = await realpath(resolve(base, '.' + relative));
      if (!file.startsWith(base + sep)) return response.writeHead(404).end();
      const details = await stat(file);
      const type = mime[extname(file).toLowerCase()];
      if (!details.isFile() || !type) return response.writeHead(404).end();
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': details.size, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') return response.end();
      const stream = createReadStream(file);
      response.on('close', () => stream.destroy());
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await serve(Number(process.env.EP01_PORT ?? 4178));
  console.log('EP01 · ' + url);
}
