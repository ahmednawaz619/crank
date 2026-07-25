#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  resolveProjectRoot,
  findAppDirectory,
  hasFrameworkMarker
} = require('../lib/resolve-project');

const repoRoot = path.resolve(__dirname, '..');
const resolved = resolveProjectRoot(repoRoot);
assert.ok(resolved.projectRoot, 'projectRoot');
assert.ok(resolved.source, 'source');

assert.strictEqual(hasFrameworkMarker(repoRoot), false, 'vizcopy repo has no vite at root');

const fakeMonorepo = path.join(repoRoot, 'scripts', 'fixtures', 'fake-app');
// Just test findAppDirectory logic on repo root
const app = findAppDirectory(repoRoot);
assert.ok(app.appRoot, 'appRoot');

console.log('ok — resolve-project', resolved.source, resolved.reason);
