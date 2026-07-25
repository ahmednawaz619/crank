'use strict';

/**
 * Vite / Rolldown-vite / Vitest-compatible plugin.
 *
 * - Proxies `/@crank/*` → companion (same-origin; required on Replit iframe previews)
 * - Optionally injects the loader into index.html (skip when using React `<Crank />`)
 *
 *   import { crank } from '@ahmednawaz/crank/vite'
 *   export default { plugins: [crank()] }                 // Vite-only apps
 *   export default { plugins: [crank({ inject: false })] } // React + <Crank />
 */

const { resolveCompanionLoaderUrl, resolveCompanionProxyTarget } = require('./lib/loader-url');

const PROXY_PREFIX = '/@crank';

function crank(options = {}) {
  const inject = options.inject !== false;
  const target = resolveCompanionProxyTarget(options);
  const src =
    options.src ||
    `${PROXY_PREFIX}/dev-loader.js`;

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
              ws: true,
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
