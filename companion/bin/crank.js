#!/usr/bin/env node
'use strict';

/**
 * Crank companion CLI — thin launcher with auto-restart.
 * Prefer the package root CLI for durable daemon mode:
 *   npx crank start --daemon --no-open
 *
 * Usage: crank-companion [project-root]
 */
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

process.env.CRANK_PROJECT_ROOT = projectRoot;

const serverPath = path.join(__dirname, '..', 'server.js');
let child = null;
let shuttingDown = false;
let delayMs = 400;

function spawnOnce() {
  if (shuttingDown) return;
  child = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code == null ? 0 : code);
    }
    // Exit 0 = often EADDRINUSE / already up — don't tight-loop.
    const wait = code === 0 && !signal ? 5000 : delayMs;
    console.error(
      `[Crank] Companion exited (code=${code} signal=${signal || ''}); restarting in ${wait}ms…`
    );
    setTimeout(() => {
      delayMs = Math.min(delayMs * 2, 8000);
      spawnOnce();
    }, wait);
  });
  child.on('spawn', () => {
    delayMs = 400;
  });
}

function shutdown(signal) {
  shuttingDown = true;
  if (child) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 200);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
spawnOnce();
