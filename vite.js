'use strict';

/**
 * Vite / Rolldown-vite / Vitest-compatible plugin.
 * Injects Crank into the app during `vite` / `npm run dev` — no React component needed.
 *
 *   // vite.config.ts
 *   import { crank } from '@ahmednawaz/crank/vite'
 *   // or: import { crank } from 'crank/vite'
 *   export default { plugins: [crank()] }
 *
 * Prefer this for Vite apps (React, Vue, Svelte, vanilla). The panel is a script overlay,
 * not a component in your React tree.
 */

const { resolveCompanionLoaderUrl } = require('./lib/loader-url');

function crank(options = {}) {
  const src = resolveCompanionLoaderUrl(options);

  return {
    name: 'crank-dev-loader',
    apply: 'serve',
    transformIndexHtml(html) {
      if (String(html).includes('/dev-loader.js') || String(html).includes('crank/dev-loader')) {
        return html;
      }
      const tag = `<script src="${src}" defer></script>`;
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
  resolveCompanionLoaderUrl
};
