#!/usr/bin/env node
'use strict';

/**
 * Copy Glean (and related) keys from local .env → team.env for npm publish only.
 * team.env is gitignored and included in the published tarball.
 *
 *   npm run publish:team
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '.env');
const dest = path.join(root, 'team.env');

// Glean keys only — never bundle CRANK_TEAM_TOKEN (share out-of-band).
const ALLOW = new Set([
  'GLEAN_API_KEY',
  'GLEAN_BASE_URL',
  'GLEAN_AGENT_ID',
  'GLEAN_ACT_AS',
  'GLEAN_STUB',
  'GLEAN_USE_STREAM',
  'CRANK_GLEAN_OPTION_COUNT'
]);

if (!fs.existsSync(src)) {
  console.error('Missing .env — add GLEAN_API_KEY first.');
  process.exit(1);
}

const lines = [];
for (const line of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }
  const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
  if (ALLOW.has(key)) {
    lines.push(trimmed);
  }
}

if (!lines.some((l) => l.startsWith('GLEAN_API_KEY='))) {
  console.error('.env has no GLEAN_API_KEY.');
  process.exit(1);
}

if (!lines.some((l) => l.startsWith('GLEAN_STUB='))) {
  lines.push('GLEAN_STUB=false');
}

fs.writeFileSync(dest, `${lines.join('\n')}\n`);
console.log(`Wrote ${dest} (${lines.length} vars) — ready for npm publish.`);
