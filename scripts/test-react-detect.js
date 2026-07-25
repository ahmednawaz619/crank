#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectEnvironment, detectHasReact } = require('../lib/detect');
const { findAppDirectory } = require('../lib/resolve-project');
const { findEntry, wireReactEntry } = require('../lib/wire-react');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-react-detect-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Root package.json has no react; client/ does + vite + main.tsx
withTempDir((root) => {
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'mono', private: true, scripts: { dev: 'npm run dev -w client' } })
  );
  const client = path.join(root, 'client');
  fs.mkdirSync(path.join(client, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(client, 'package.json'),
    JSON.stringify({
      name: 'client',
      dependencies: { react: '^19', 'react-dom': '^19' },
      devDependencies: { vite: '^6', '@vitejs/plugin-react': '^4' }
    })
  );
  fs.writeFileSync(
    path.join(client, 'vite.config.ts'),
    `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n`
  );
  fs.writeFileSync(
    path.join(client, 'src', 'main.tsx'),
    `import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)\n`
  );

  const app = findAppDirectory(root);
  assert.strictEqual(app.appRoot, client, `expected client app root, got ${app.appRoot} (${app.reason})`);

  const env = detectEnvironment(client);
  assert.strictEqual(env.hasReact, true, 'client hasReact');

  // Even detecting from repo root should see react via nested scan
  const envRoot = detectEnvironment(root);
  assert.strictEqual(envRoot.hasReact, true, 'root detectHasReact via client/');

  const entry = findEntry(client);
  assert.ok(entry && entry.endsWith('main.tsx'), `entry ${entry}`);

  const wire = wireReactEntry(client);
  assert.strictEqual(wire.wired, true, `wire reason ${wire.reason}`);
  const patched = fs.readFileSync(entry, 'utf8');
  assert.ok(/@ahmednawaz\/crank\/react/.test(patched), 'import added');
  assert.ok(/<Crank\s*\/>/.test(patched), 'component added');
});

// Nested artifacts-style path (not in APP_DIR_CANDIDATES)
withTempDir((root) => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'replit-root' }));
  const appDir = path.join(root, 'artifacts', 'demo');
  fs.mkdirSync(path.join(appDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({
      name: 'demo',
      dependencies: { react: '^18' },
      devDependencies: { vite: '^5', '@vitejs/plugin-react': '^4' }
    })
  );
  fs.writeFileSync(
    path.join(appDir, 'vite.config.ts'),
    `import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n`
  );
  fs.writeFileSync(
    path.join(appDir, 'src', 'main.tsx'),
    `import { createRoot } from 'react-dom/client'\ncreateRoot(document.getElementById('root')!).render(<div />)\n`
  );

  const app = findAppDirectory(root);
  assert.strictEqual(app.appRoot, appDir, `artifacts app: ${app.reason}`);
  assert.strictEqual(detectEnvironment(app.appRoot).hasReact, true);
});

// Vite config alone signals react even without package dep listed
withTempDir((root) => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'weird' }));
  fs.writeFileSync(
    path.join(root, 'vite.config.ts'),
    `import react from '@vitejs/plugin-react'\nexport default { plugins: [react()] }\n`
  );
  assert.strictEqual(detectHasReact(root, {}, path.join(root, 'vite.config.ts')), true);
});

console.log('ok — react detection + inject');
