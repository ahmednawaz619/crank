#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  clearViteDepCache,
  onCrankPackageInstalled
} = require('../lib/upgrade');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-upgrade-'));
const consumer = path.join(tmp, 'app');
const crankRoot = path.join(consumer, 'node_modules', '@ahmednawaz', 'crank');
fs.mkdirSync(path.join(crankRoot, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(consumer, 'node_modules', '.vite', 'deps'), { recursive: true });
fs.writeFileSync(
  path.join(consumer, 'package.json'),
  JSON.stringify({ name: 'demo-app', private: true }) + '\n'
);
fs.writeFileSync(
  path.join(crankRoot, 'package.json'),
  JSON.stringify({ name: '@ahmednawaz/crank', version: '0.3.9' }) + '\n'
);
fs.writeFileSync(
  path.join(crankRoot, 'react.mjs'),
  'export const CRANK_REACT_LOADER_VERSION = "0.3.9";\n'
);
fs.copyFileSync(
  path.join(__dirname, 'postinstall-consumer.js'),
  path.join(crankRoot, 'scripts', 'postinstall-consumer.js')
);

const cleared = clearViteDepCache(consumer);
assert.ok(cleared.some((p) => p.includes('.vite')), 'should clear .vite cache');

fs.mkdirSync(path.join(consumer, 'node_modules', '.vite', 'deps'), { recursive: true });

const first = onCrankPackageInstalled(crankRoot);
assert.strictEqual(first.upgraded, true);
assert.ok(first.cleared.length >= 1);

fs.writeFileSync(
  path.join(crankRoot, 'package.json'),
  JSON.stringify({ name: '@ahmednawaz/crank', version: '0.3.9' }) + '\n'
);
const second = onCrankPackageInstalled(crankRoot);
assert.strictEqual(second.skipped, true);
assert.strictEqual(second.reason, 'unchanged');

console.log('test-upgrade: ok');
