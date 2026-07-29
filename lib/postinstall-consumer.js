#!/usr/bin/env node
'use strict';

/** Bust Vite dep cache when @ahmednawaz/crank version changes after pnpm/npm install. */

const path = require('path');
const { onCrankPackageInstalled } = require('./upgrade');

try {
  onCrankPackageInstalled(path.join(__dirname, '..'));
} catch (err) {
  console.warn('[crank] postinstall:', err.message || err);
}
