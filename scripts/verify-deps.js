#!/usr/bin/env node
'use strict';

/**
 * Smoke-check that runtime deps resolve from the published package root.
 * Run before npm publish (npx only installs root dependencies).
 */

const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const required = [
  'express',
  'cors',
  'ws',
  '@modelcontextprotocol/sdk',
  'zod',
  '@cursor/sdk'
];

const missing = [];
for (const name of required) {
  const pkgDir = name.startsWith('@')
    ? path.join(root, 'node_modules', ...name.split('/'))
    : path.join(root, 'node_modules', name);
  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    missing.push(name);
  }
}

if (missing.length) {
  console.error('Missing runtime dependencies at package root:');
  for (const name of missing) {
    console.error(`  - ${name}`);
  }
  console.error('Run npm install at repo root before publishing.');
  process.exit(1);
}

console.log(`verify:deps OK (${required.length} packages)`);
