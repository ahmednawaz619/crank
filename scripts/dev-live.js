#!/usr/bin/env node
'use strict';

/**
 * Local live dev: companion + panel watch + Vite client demo.
 * Uses the repo's bookmarklet (not published npm), with auto re-embed on save.
 *
 *   npm run dev            — production channel (:3344)
 *   npm run dev:preview    — preview channel (:3346)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const { normalizeChannel, defaultCompanionPort } = require('../lib/panel-channel');

const root = path.resolve(__dirname, '..');
const channel = normalizeChannel(process.env.CRANK_CHANNEL);
const companionPort = defaultCompanionPort(channel);

function killPort(port) {
  try {
    execSync('kill $(lsof -tiTCP:' + port + ' -sTCP:LISTEN) 2>/dev/null', {
      cwd: root,
      stdio: 'ignore',
      shell: true
    });
  } catch (_) {
    /* ignore */
  }
}

killPort(companionPort);
killPort(5173);

function run(label, command, args, opts) {
  const child = spawn(command, args, {
    cwd: opts && opts.cwd ? opts.cwd : root,
    stdio: 'inherit',
    env: { ...process.env, CRANK_CHANNEL: channel, CRANK_PORT: String(companionPort), PORT: String(companionPort) },
    shell: process.platform === 'win32'
  });
  child.on('exit', function (code, signal) {
    if (signal) return;
    if (code && code !== 0) {
      console.error('[' + label + '] exited with code', code);
    }
  });
  return child;
}

const children = [];

function shutdown() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch (_) {
      /* ignore */
    }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(
  '[crank] live dev — channel ' +
    channel +
    ' · companion :' +
    companionPort +
    ' · app http://localhost:5173'
);
console.log('[crank] save bookmarklet/CSS → auto re-embed → Vite hot-reloads the panel');

try {
  execSync('node scripts/embed-panel.js', {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CRANK_CHANNEL: channel }
  });
} catch (err) {
  console.error('[crank] initial embed failed:', err.message || err);
  process.exit(1);
}

children.push(run('companion', 'node', ['companion/server.js']));
children.push(run('watch', 'node', ['scripts/watch-panel.js']));
children.push(
  run('vite', 'npm', ['run', 'dev', '--prefix', 'client'], { cwd: root })
);
