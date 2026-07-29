#!/usr/bin/env node
'use strict';

/**
 * Stamp react.mjs / react.js with CRANK_REACT_LOADER_VERSION so Vite's
 * optimizeDeps hash changes when panel-source changes but react.mjs logic does not.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).version;

const mjsLine = `export const CRANK_REACT_LOADER_VERSION = ${JSON.stringify(String(version))};`;
const jsLine = `const CRANK_REACT_LOADER_VERSION = ${JSON.stringify(String(version))};`;
const mjsBlock =
  `\n/** Bumped each release — invalidates Vite optimizeDeps cache for this entry. */\n${mjsLine}\n`;
const jsBlock =
  `\n/** Bumped each release — invalidates Vite optimizeDeps cache for this entry. */\n${jsLine}\n`;

function upsert(file, block, pattern) {
  const p = path.join(root, file);
  let src = fs.readFileSync(p, 'utf8');
  if (pattern.test(src)) {
    src = src.replace(pattern, block.trim() + '\n');
  } else if (file === 'react.mjs') {
    src = src.replace(
      "import { bootCrankPanel } from './panel-boot.mjs';",
      `import { bootCrankPanel } from './panel-boot.mjs';${mjsBlock}`
    );
  } else {
    src = src.replace("'use strict';", `'use strict';${jsBlock}`);
  }
  fs.writeFileSync(p, src);
}

upsert(
  'react.mjs',
  mjsBlock,
  /\/\*\* Bumped each release[\s\S]*?export const CRANK_REACT_LOADER_VERSION = [^;]+;\n?/
);
upsert(
  'react.js',
  jsBlock,
  /\/\*\* Bumped each release[\s\S]*?const CRANK_REACT_LOADER_VERSION = [^;]+;\n?/
);

console.log('[crank] stamped react loader version', version);
