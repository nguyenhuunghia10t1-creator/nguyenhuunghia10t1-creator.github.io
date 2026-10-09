import { createServer } from 'node:http';
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The document root is fixed to the repository, never the surrounding workspace.
const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const requestedPort = process.argv[2] ?? '4173';
if (!/^\d{1,5}$/u.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535) {
  throw new Error('Usage: node scripts/gift-serve.mjs [port]');
}
const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.ico', 'image/x-icon'], ['.mp3', 'audio/mpeg'],
  ['.woff2', 'font/woff2'], ['.txt', 'text/plain; charset=utf-8'],
]);

function withinRoot(filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

createServer(async (request, response) => {
  const finish = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(message);
  };
  if (!['GET', 'HEAD'].includes(request.method)) return finish(405, 'Method not allowed');
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) {
      return finish(403, 'Forbidden');
    }
    let filename = path.resolve(root, `.${pathname}`);
    if (!withinRoot(filename)) return finish(403, 'Forbidden');
    let info = await stat(filename);
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(301, { Location: `${pathname}/` });
        return response.end();
      }
      filename = path.join(filename, 'index.html');
      info = await stat(filename);
    }
    if (!info.isFile() || !withinRoot(realpathSync(filename))) return finish(403, 'Forbidden');
    const headers = {
      'Content-Type': contentTypes.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
    };
    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (request.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range);
      if (!match) return finish(416, 'Range not satisfiable');
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= info.size) return finish(416, 'Range not satisfiable');
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      status = 206;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || info.size === 0) return response.end();
    const stream = createReadStream(filename, { start, end });
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    finish(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 400, 'File not available');
  }
}).listen(Number(requestedPort), '127.0.0.1', () => {
  console.log(`Local preview: http://127.0.0.1:${requestedPort}/mot-goc-nho/`);
  console.log('Document root is the repository only; private sibling files are not served.');
});
