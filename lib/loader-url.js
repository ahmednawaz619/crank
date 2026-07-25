'use strict';

/**
 * Shared companion loader URL for Vite / React / Next / webpack adapters.
 * All paths inject the same /dev-loader.js → bookmarklet panel (not a React UI tree).
 */

const fs = require('fs');
const path = require('path');
const { env } = require('./env');
const { readRuntimeManifest } = require('./urls');

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
  if (options.src) {
    return String(options.src);
  }

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

module.exports = {
  findProjectRoot,
  resolveCompanionLoaderUrl
};
