'use strict';

/**
 * Vite plugin — HTTP proxy only for `/@crank/*` (optional).
 *
 * Do NOT enable `ws: true`: Vite's HMR WebSocket steals upgrades on the
 * dev-server port, so `/@crank/ws` never reaches the companion. The panel
 * connects WebSocket directly to the companion host (localhost / 3344-… Replit).
 *
 * Prefer React `<Crank />` (embedded panel). Use inject:true only for non-React.
 *
 *   import { crank } from '@ahmednawaz/crank/vite'
 *   export default { plugins: [crank({ inject: false })] }
 */

const { resolveCompanionLoaderUrl, resolveCompanionProxyTarget } = require('./lib/loader-url');

const PROXY_PREFIX = '/@crank';

function crank(options = {}) {
  const inject = options.inject !== false;
  const target = resolveCompanionProxyTarget(options);
  const src = options.src || `${PROXY_PREFIX}/dev-loader.js`;

  return {
    name: 'crank-dev-loader',
    apply: 'serve',
    config() {
      return {
        server: {
          proxy: {
            [PROXY_PREFIX]: {
              target,
              changeOrigin: true,
              // HTTP only — Vite HMR owns WebSocket upgrades on this port.
              rewrite: (p) => p.replace(new RegExp(`^${PROXY_PREFIX}`), '') || '/'
            }
          }
        }
      };
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
