#!/usr/bin/env node
'use strict';

/** Re-embed panel-source.mjs when bookmarklet/CSS changes (live UI iteration). */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const targets = [
  'bookmarklet/crank-bookmarklet.js',
  'bookmarklet/crank-ui.css',
  'bookmarklet/crank-ui-helpers.js',
  'bookmarklet/text-source.js',
  'bookmarklet/glean-logo.png'
];

let debounce = null;

function rebuild(source) {
  clearTimeout(debounce);
  debounce = setTimeout(function () {
    try {
      execSync('node scripts/embed-panel.js', {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, CRANK_CHANNEL: process.env.CRANK_CHANNEL || 'production' }
      });
      console.log(
        '[crank] panel re-embedded' +
          (source ? ' (' + source + ')' : '') +
          ' — browser updates automatically in dev'
      );
    } catch (err) {
      console.error('[crank] embed failed:', err.message || err);
    }
  }, 250);
}

for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.warn('[crank] skip watch (missing):', rel);
    continue;
  }
  fs.watch(file, function () {
    rebuild(rel);
  });
  console.log('[crank] watching', rel);
}

rebuild('initial');
