'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function detectEnvironment(projectRoot) {
  const env = process.env;
  const isReplit = Boolean(
    env.REPL_ID || env.REPL_SLUG || env.REPLIT_DEV_DOMAIN || env.REPLIT_DB_URL
  );
  const hasVite =
    exists(path.join(projectRoot, 'vite.config.ts')) ||
    exists(path.join(projectRoot, 'vite.config.js')) ||
    exists(path.join(projectRoot, 'vite.config.mjs')) ||
    exists(path.join(projectRoot, 'vite.config.cjs'));
  const hasPackageJson = exists(path.join(projectRoot, 'package.json'));
  const hasCursor = exists(path.join(projectRoot, '.cursor')) ||
    exists(path.join(os.homedir(), '.cursor'));
  const hasVsCode = exists(path.join(projectRoot, '.vscode')) ||
    exists(path.join(projectRoot, '.vscode'.replace('s', 's')));
  const claudeConfig = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json'
  );
  const hasClaudeDesktop = process.platform === 'darwin' && exists(claudeConfig);

  return {
    isReplit,
    hasVite,
    hasPackageJson,
    hasCursor,
    hasVsCode: exists(path.join(projectRoot, '.vscode')),
    hasClaudeDesktop,
    claudeConfig,
    replitDomain: env.REPLIT_DEV_DOMAIN || null,
    packageJson: hasPackageJson
      ? readJson(path.join(projectRoot, 'package.json'), {})
      : null
  };
}

function findViteConfig(projectRoot) {
  for (const name of [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.cjs'
  ]) {
    const full = path.join(projectRoot, name);
    if (exists(full)) {
      return full;
    }
  }
  return null;
}

module.exports = {
  exists,
  readJson,
  writeJson,
  detectEnvironment,
  findViteConfig
};
