'use strict';

/**
 * Resolve packaged Crank UI assets (CSS, helpers) under this install.
 */
const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');

function resolveCrankAssetRoot() {
  if (process.env.CRANK_ASSET_ROOT) {
    return path.resolve(process.env.CRANK_ASSET_ROOT);
  }
  return PACKAGE_ROOT;
}

function crankAsset(...parts) {
  const root = resolveCrankAssetRoot();
  const full = path.join(root, ...parts);
  return fs.existsSync(full) ? full : null;
}

module.exports = {
  resolveCrankAssetRoot,
  crankAsset,
  PACKAGE_ROOT
};
