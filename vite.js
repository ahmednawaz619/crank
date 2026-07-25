'use strict';

const fs = require('fs');
const path = require('path');
const { env } = require('./lib/env');
const { readRuntimeManifest } = require('./lib/urls');

/**
 * Vite / Rolldown-vite / Vitest-compatible plugin.
 * Injects Crank into the app during `vite` / `npm run dev` — no bookmarklet needed.
 *
 *   // vite.config.ts
 *   import { crank } from 'crank/vite'
 *   export default { plugins: [crank()] }
 */

function findProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, '.crank', 'runtime.json'))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir || process.cwd());
}

function resolveCompanionLoaderUrl(options = {}) {
  const projectRoot = options.projectRoot || findProjectRoot(process.cwd());
  const runtime = readRuntimeManifest(projectRoot);
  if (runtime?.companion?.devLoader) {
    return runtime.companion.devLoader;
  }

  const publicUrl = (
    options.companionUrl ||
    env('PUBLIC_URL', '') ||
    ''
  ).replace(/\/$/, '');

  const port = String(options.port || env('PORT', '3344')).replace(/[^0-9]/g, '') || '3344';
  const host = options.host || env('HOST', '127.0.0.1');
  const base = publicUrl || `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  return `${base}/dev-loader.js`;
}

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
