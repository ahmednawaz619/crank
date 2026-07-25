#!/usr/bin/env node
'use strict';

/**
 * Vite `/@crank/ws` upgrade proxy → companion localhost (Replit fix).
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const httpProxy = require('http-proxy');
const WebSocket = require('ws');
const { checkHealth } = require('../lib/health');
const { crank } = require('../vite');

async function testViteWsProxyToCompanion() {
  const companionPath = path.join(__dirname, '..', 'companion', 'server.js');
  const companionPort = 19000 + Math.floor(Math.random() * 1000);
  const vitePort = companionPort + 1;

  const childEnv = { ...process.env };
  childEnv.CRANK_TEAM_TOKEN = '';
  childEnv.PORT = String(companionPort);
  childEnv.CRANK_PORT = String(companionPort);
  childEnv.HOST = '127.0.0.1';
  childEnv.CRANK_HOST = '127.0.0.1';
  childEnv.GLEAN_STUB = 'true';

  const companion = spawn(process.execPath, [companionPath], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const h = await checkHealth(`http://127.0.0.1:${companionPort}`, 500);
    if (h.ok) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  const target = `http://127.0.0.1:${companionPort}`;
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  proxy.on('error', () => {
    // Benign during teardown when companion or client socket closes first.
  });
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (!url.startsWith('/@crank')) {
      socket.destroy();
      return;
    }
    const rewritten = url.replace(/^\/@crank/, '') || '/';
    req.url = rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
    proxy.ws(req, socket, head, { target });
  });

  await new Promise((resolve, reject) => {
    server.listen(vitePort, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });

  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${vitePort}/@crank/ws`);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('timeout on /@crank/ws via vite-style proxy'));
      }, 5000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
      });
      ws.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        reject(new Error(`unexpected-response ${res.statusCode}`));
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    console.log('ok — Vite-style /@crank/ws upgrade proxies to companion');
  } finally {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    await new Promise((resolve) => {
      if (companion.exitCode != null) {
        resolve();
        return;
      }
      companion.once('exit', resolve);
      companion.kill('SIGTERM');
      setTimeout(resolve, 400);
    });
  }
}

async function main() {
  assert.strictEqual(typeof crank().configureServer, 'function', 'plugin exposes configureServer');
  await testViteWsProxyToCompanion();
  console.log('ok — vite ws proxy regression');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
