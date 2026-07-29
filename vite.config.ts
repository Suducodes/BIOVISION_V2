import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Dev-only endpoint that writes a posted data-URL frame to `captures/`.
 *
 * The WebGL canvas cannot be grabbed by ordinary page-screenshot tooling, and
 * publication figures need frames straight from the renderer at full fidelity,
 * so the page posts its own framebuffer here instead.
 */
function frameCapture(): Plugin {
  return {
    name: 'bio-vision-frame-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { name = 'frame', dataUrl } = JSON.parse(body) as {
              name?: string;
              dataUrl?: string;
            };
            const payload = dataUrl?.split(',')[1];
            if (!payload) throw new Error('missing dataUrl');

            const ext = dataUrl!.includes('image/jpeg') ? 'jpg' : 'png';
            // Strip path separators so a crafted name cannot escape the folder.
            const safe = name.replace(/[^a-z0-9_-]/gi, '_');
            const dir = resolve(server.config.root, 'captures');
            mkdirSync(dir, { recursive: true });
            const file = resolve(dir, `${safe}.${ext}`);
            writeFileSync(file, Buffer.from(payload, 'base64'));

            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Served at the repo subpath on GitHub Pages, but at root in dev so the
  // local URL stays simple. All runtime asset paths read import.meta.env.BASE_URL
  // so they resolve correctly under either.
  base: command === 'build' ? '/BIOVISION_V2/' : '/',
  plugins: [frameCapture()],
  server: {
    // getUserMedia requires a secure context. localhost counts as secure,
    // so plain HTTP is fine for local development.
    port: 3000,
  },
  build: {
    target: 'es2022',
  },
  // MediaPipe ships its WASM binaries as assets that must not be inlined.
  assetsInclude: ['**/*.wasm', '**/*.task'],
}));
