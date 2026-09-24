import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev-only: POST a data URL to /__capture?name=foo and it is written to
 * captures/foo.jpg. Used to grab reference frames of the running game for
 * reviews and design docs. Never included in production builds.
 */
function captures(): Plugin {
  return {
    name: 'nightfall-captures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') return res.end('POST a data URL');
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'frame').replace(/[^a-z0-9_-]/gi, '');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body);
          if (!m) {
            res.statusCode = 400;
            return res.end('bad data url');
          }
          const dir = resolve(__dirname, 'captures');
          mkdirSync(dir, { recursive: true });
          const file = resolve(dir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`);
          writeFileSync(file, Buffer.from(m[2], 'base64'));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [captures()],
  server: { port: 5317, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
