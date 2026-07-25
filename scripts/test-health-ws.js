#!/usr/bin/env node
'use strict';

/**
 * Regression tests:
 *  1. checkHealth works for https:// URLs (no ERR_INVALID_PROTOCOL)
 *  2. Companion WebSocket accepts /ws?query=…
 */

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const { checkHealth } = require('../lib/health');

async function testCheckHealthHttpsDoesNotThrow() {
  // Mock fetch for https URL — must not use http.get
  const originalFetch = global.fetch;
  let sawUrl = null;
  global.fetch = async (url) => {
    sawUrl = String(url);
    assert.ok(sawUrl.startsWith('https://'), 'must call https URL');
    return {
      status: 200,
      ok: true,
      json: async () => ({ ok: true, service: 'crank-companion' })
    };
  };
  try {
    const result = await checkHealth('https://3344-example.sisko.replit.dev', 2000);
    assert.strictEqual(result.ok, true, 'https health ok');
    assert.ok(sawUrl.includes('/health'), 'hits /health');
    console.log('ok — checkHealth https:// (no ERR_INVALID_PROTOCOL)');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testCheckHealthHttpLocal() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, gleanStub: false }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const result = await checkHealth(`http://127.0.0.1:${port}`, 2000);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.body.ok, true);
    console.log('ok — checkHealth http://127.0.0.1');
  } finally {
    server.close();
  }
}

async function testWsAcceptsQueryString() {
  const companionPath = path.join(__dirname, '..', 'companion', 'server.js');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const childEnv = { ...process.env };
  // Empty string blocks loadTeamEnvFile from injecting the real token (null-only fill).
  childEnv.CRANK_TEAM_TOKEN = '';
  childEnv.PORT = String(port);
  childEnv.CRANK_PORT = String(port);
  childEnv.HOST = '127.0.0.1';
  childEnv.CRANK_HOST = '127.0.0.1';
  childEnv.CRANK_PROJECT_ROOT = path.join(__dirname, '..');
  childEnv.GLEAN_STUB = 'true';

  const child = spawn(process.execPath, [companionPath], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootLog = '';
  child.stdout.on('data', (d) => {
    bootLog += d;
  });
  child.stderr.on('data', (d) => {
    bootLog += d;
  });

  // Wait for listen
  const deadline = Date.now() + 8000;
  let healthy = false;
  while (Date.now() < deadline) {
    const h = await checkHealth(`http://127.0.0.1:${port}`, 500);
    if (h.ok) {
      healthy = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!healthy) {
    child.kill('SIGTERM');
    throw new Error('companion did not become healthy:\n' + bootLog);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?teamToken=test`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS connect timeout for /ws?query'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`unexpected-response ${res.statusCode} for /ws?query`));
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Plain /ws also works
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS connect timeout for /ws'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Root `/` upgrade (Replit proxy fallback)
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS connect timeout for /'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  child.kill('SIGTERM');
  console.log('ok — WebSocket /ws, /ws?query, and / connect (no 404)');
}

async function main() {
  await testCheckHealthHttpsDoesNotThrow();
  await testCheckHealthHttpLocal();
  await testWsAcceptsQueryString();
  console.log('ok — health + ws regressions');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
