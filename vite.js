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
