'use strict';

/**
 * Resolve sibling Vizpatch install so Crank can reuse text-writer, UI CSS, etc.
 */
const fs = require('fs');
const path = require('path');

function resolveVizpatchRoot() {
  if (process.env.VIZPATCH_ROOT) {
    return path.resolve(process.env.VIZPATCH_ROOT);
  }
  const candidates = [
    path.resolve(__dirname, '..', '..', 'vizpatch'),
    path.resolve(__dirname, '..', '..', 'Downloads', 'vizpatch'),
    path.resolve(process.cwd(), '..', 'vizpatch'),
    '/Users/ahmed.nawaz/Downloads/vizpatch'
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'companion', 'text-writer.js'))) {
      return candidate;
    }
  }
  return null;
}

function requireVizpatch(relPath) {
  const root = resolveVizpatchRoot();
  if (!root) {
    throw new Error(
      'Vizpatch not found. Set VIZPATCH_ROOT to the vizpatch checkout path.'
    );
  }
  return require(path.join(root, relPath));
}

function vizpatchAsset(...parts) {
  const root = resolveVizpatchRoot();
  if (!root) {
    return null;
  }
  return path.join(root, ...parts);
}

module.exports = {
  resolveVizpatchRoot,
  requireVizpatch,
  vizpatchAsset
};
