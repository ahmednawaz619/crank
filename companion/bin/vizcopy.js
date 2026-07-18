#!/usr/bin/env node
'use strict';

/**
 * Vizcopy companion CLI — thin launcher (pattern from Vizpatch's bin/vizpatch.js).
 * Usage: vizcopy [project-root]
 */
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

process.env.VIZCOPY_PROJECT_ROOT = projectRoot;

const serverPath = path.join(__dirname, '..', 'server.js');
const child = spawn(process.execPath, [serverPath], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 0 : code);
});
