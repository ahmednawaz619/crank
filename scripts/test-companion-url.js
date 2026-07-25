#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PROXY_PREFIX,
  viteCrankEnvValue,
  normalizeCompanionUrl,
  defaultReplitCompanionUrl
} = require('../lib/companion-url');
const { writeViteCrankUrl } = require('../lib/urls');

assert.strictEqual(viteCrankEnvValue({ isReplit: true }), PROXY_PREFIX);
assert.strictEqual(
  viteCrankEnvValue({ companionPublicUrl: 'http://127.0.0.1:3344' }),
  'http://127.0.0.1:3344'
);
assert.strictEqual(
  normalizeCompanionUrl('/@crank', 'https://abc.sisko.replit.dev'),
  'https://abc.sisko.replit.dev/@crank'
);
assert.strictEqual(
  defaultReplitCompanionUrl('https://abc.sisko.replit.dev'),
  'https://abc.sisko.replit.dev/@crank'
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-env-'));
try {
  writeViteCrankUrl(tmp, 'https://3344-bad.sisko.replit.dev', { isReplit: true });
  const envLocal = fs.readFileSync(path.join(tmp, '.env.local'), 'utf8');
  assert.ok(envLocal.includes('VITE_CRANK_URL=/@crank'), 'Replit writes proxy path');
  console.log('ok — companion-url + Replit .env.local sentinel');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
