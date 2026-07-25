#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { patchViteConfig, repairViteConfigDuplicates } = require('../lib/init');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-vite-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

withTempDir((dir) => {
  const cfg = path.join(dir, 'vite.config.ts');
  fs.writeFileSync(
    cfg,
    `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
})
`
  );

  const r1 = patchViteConfig(dir);
  assert.strictEqual(r1.patched, true, 'first patch applies');
  let source = fs.readFileSync(cfg, 'utf8');
  const requireCount = (source.match(/createRequire/g) || []).length;
  assert.ok(requireCount <= 2, `createRequire mentions should not explode, got ${requireCount}`);
  assert.strictEqual(
    (source.match(/import\s+\{\s*createRequire\s*\}\s+from\s+['"]node:module['"]/g) || []).length,
    1,
    'exactly one createRequire import after first patch'
  );
  assert.strictEqual(
    (source.match(/import\s+\{\s*existsSync\s*\}\s+from\s+['"]node:fs['"]/g) || []).length,
    1,
    'exactly one existsSync import'
  );
  assert.strictEqual(
    (source.match(/import\s+\{\s*fileURLToPath\s*\}\s+from\s+['"]node:url['"]/g) || []).length,
    1,
    'exactly one fileURLToPath import'
  );

  const r2 = patchViteConfig(dir);
  assert.ok(
    r2.reason === 'already-present' || r2.reason === 'repaired-duplicate-imports',
    `second patch is idempotent, got ${r2.reason}`
  );
  source = fs.readFileSync(cfg, 'utf8');
  assert.strictEqual(
    (source.match(/import\s+\{\s*createRequire\s*\}\s+from\s+['"]node:module['"]/g) || []).length,
    1,
    'still one createRequire import after second patch'
  );
});

withTempDir((dir) => {
  const cfg = path.join(dir, 'vite.config.ts');
  // Simulate broken file from older Crank
  fs.writeFileSync(
    cfg,
    `import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Crank Vite plugin — graceful load
let crank: null | (() => unknown) = null
try {
  const _crankPluginPath = fileURLToPath(new URL('.crank/vite-plugin.cjs', import.meta.url))
  if (existsSync(_crankPluginPath)) {
    const require = createRequire(import.meta.url)
    crank = require(_crankPluginPath).crank
  }
} catch {}

import { defineConfig } from "vite"
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [...(crank ? [crank()] : [])],
})
`
  );

  const repaired = repairViteConfigDuplicates(dir);
  assert.strictEqual(repaired.repaired, true, 'repairs duplicates');
  const source = fs.readFileSync(cfg, 'utf8');
  assert.strictEqual(
    (source.match(/import\s+\{\s*createRequire\s*\}\s+from\s+['"]node:module['"]/g) || []).length,
    1,
    'repair leaves one createRequire import'
  );
});

console.log('ok — patch-vite idempotent + repair');
