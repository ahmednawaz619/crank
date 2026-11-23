'use strict';

/**
 * Vite plugin — HTTP + WebSocket proxy for `/@crank/*`.
 *
 * HTTP uses `server.proxy`. WebSocket uses a raw `upgrade` handler so Vite HMR
 * does not steal `/@crank/ws` before the proxy runs (Replit + local dev).
 *
 * Prefer React `<Crank />` (embedded panel). Use inject:true only for non-React.
 *
 *   import { crank } from '@ahmednawaz/crank/vite'
 *   export default { plugins: [crank({ inject: false })] }
 */

const httpProxy = require('http-proxy');
const { PROXY_PREFIX } = require('./lib/companion-url');
const { resolveCompanionLoaderUrl, resolveCompanionProxyTarget } = require('./lib/loader-url');
const CRANK_VERSION = require('./package.json').version;

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let lastStartAt = 0;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function isLoopbackAddr(addr) {
  return /^(127\.|::1$|::ffff:127\.)/.test(String(addr || ''));
}

function hostnameOf(hostHeader) {
  const h = String(hostHeader || '');
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.split(':')[0];
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, (resp) => {
      resp.resume();
      resolve(resp.statusCode === 200 || resp.statusCode === 401);
    });
    r.on('error', () => resolve(false));
    r.on('timeout', () => {
      r.destroy();
      resolve(false);
    });
  });
}

async function handleStartCompanion(req, res, root) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' });
  const host = hostnameOf(req.headers.host);
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local || !isLoopbackAddr(req.socket && req.socket.remoteAddress)) {
    return sendJson(res, 403, { ok: false, error: 'localhost only' });
  }
  const origin = req.headers.origin;
  if (!origin || hostnameOf(String(origin).replace(/^https?:\/\//, '')) !== host ||
      String(origin).replace(/^https?:\/\//, '') !== req.headers.host ||
      req.headers['x-crank-start'] !== '1') {
    return sendJson(res, 403, { ok: false, error: 'same-origin only' });
  }
  const preview = /[?&]channel=preview\b/.test(req.url || '');
  const port = preview ? 3346 : 3344;
  if (await probeHealth(port)) return sendJson(res, 200, { ok: true, started: false, running: true });
  if (Date.now() - lastStartAt < 8000) {
    return sendJson(res, 202, { ok: true, started: false, starting: true });
  }
  lastStartAt = Date.now();
  try {
    const args = [path.join(__dirname, 'bin', 'crank.js'), 'start', '--daemon'];
    if (preview) args.push('--preview');
    const child = spawn(process.execPath, args, {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    child.on('error', () => {});
    child.unref();
    return sendJson(res, 202, { ok: true, started: true });
  } catch (_) {
    return sendJson(res, 500, { ok: false, error: 'spawn failed' });
  }
}

function crank(options = {}) {
  const inject = options.inject !== false;
  const target = resolveCompanionProxyTarget(options);
  const src = options.src || `${PROXY_PREFIX}/dev-loader.js`;

  return {
    name: 'crank-dev-loader',
    apply: 'serve',
    config() {
      return {
        optimizeDeps: {
          include: ['@ahmednawaz/crank/react']
        },
        define: {
          __CRANK_VITE_PLUGIN_VERSION__: JSON.stringify(CRANK_VERSION)
        },
        server: {
          proxy: {
            [PROXY_PREFIX]: {
              target,
              changeOrigin: true,
              rewrite: (p) => p.replace(new RegExp(`^${PROXY_PREFIX}`), '') || '/'
            }
          }
        }
      };
    },
    configureServer(server) {
      // Dev-only: POST /@crank/start spawns the companion daemon when it is down.
      // Registered before Vite's proxy so it wins over `/@crank/*`. Loopback + same-origin only.
      server.middlewares.use(`${PROXY_PREFIX}/start`, (req, res) => {
        handleStartCompanion(req, res, server.config.root || process.cwd());
      });
      const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
      proxy.on('error', (err, _req, socket) => {
        try {
          socket?.destroy();
        } catch {
          // ignore
        }
      });

      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = req.url || '';
        if (!url.startsWith(PROXY_PREFIX)) {
          return;
        }
        const rewritten = url.replace(new RegExp(`^${PROXY_PREFIX}`), '') || '/';
        req.url = rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
        proxy.ws(req, socket, head, { target });
      });
    },
    transformIndexHtml(html) {
      if (!inject) {
        return html;
      }
      if (
        String(html).includes('/dev-loader.js') ||
        String(html).includes('crank/dev-loader') ||
        String(html).includes('/@crank/')
      ) {
        return html;
      }
      const tag = `<script src="${src}?t=${Date.now()}" defer></script>`;
      if (html.includes('</head>')) {
        return html.replace('</head>', `  ${tag}\n</head>`);
      }
      return `${tag}\n${html}`;
    }
  };
}

module.exports = {
  crank,
  crankDevLoader: crank,
  resolveCompanionLoaderUrl,
  PROXY_PREFIX
};
