'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'vite.config.mts',
  'vite.config.cts'
];

const APP_DIR_CANDIDATES = [
  '.',
  'app',
  'client',
  'web',
  'frontend',
  'ui',
  'src',
  'packages/app',
  'packages/web',
  'apps/web',
  'apps/frontend'
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  '.crank'
]);

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

function findViteConfigInDir(dir) {
  for (const name of VITE_CONFIG_NAMES) {
    const full = path.join(dir, name);
    if (exists(full)) {
      return full;
    }
  }
  return null;
}

/**
 * Find vite.config.* at project root, common app subdirs, then shallow BFS.
 */
function findViteConfig(projectRoot) {
  const root = path.resolve(projectRoot);
  for (const sub of APP_DIR_CANDIDATES) {
    const dir = sub === '.' ? root : path.join(root, sub);
    const hit = findViteConfigInDir(dir);
    if (hit) {
      return hit;
    }
  }

  // Shallow walk (depth 2) for monorepos / Replit layouts
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 0) {
      const hit = findViteConfigInDir(dir);
      if (hit) {
        return hit;
      }
    }
    if (depth >= 2) {
      continue;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function packageHasDep(pkg, name) {
  if (!pkg || typeof pkg !== 'object') {
    return false;
  }
  return Boolean(
    pkg.dependencies?.[name] ||
      pkg.devDependencies?.[name] ||
      pkg.peerDependencies?.[name]
  );
}

function detectEnvironment(projectRoot) {
  const env = process.env;
  const isReplit = Boolean(
    env.REPL_ID || env.REPL_SLUG || env.REPLIT_DEV_DOMAIN || env.REPLIT_DB_URL
  );
  const hasPackageJson = exists(path.join(projectRoot, 'package.json'));
  const packageJson = hasPackageJson
    ? readJson(path.join(projectRoot, 'package.json'), {})
    : null;
  const viteConfig = findViteConfig(projectRoot);
  const hasVite = Boolean(viteConfig) || packageHasDep(packageJson, 'vite');
  const hasReact =
    packageHasDep(packageJson, 'react') ||
    exists(path.join(projectRoot, 'next.config.js')) ||
    exists(path.join(projectRoot, 'next.config.mjs')) ||
    exists(path.join(projectRoot, 'next.config.ts'));
  const hasNext =
    packageHasDep(packageJson, 'next') ||
    exists(path.join(projectRoot, 'next.config.js')) ||
    exists(path.join(projectRoot, 'next.config.mjs')) ||
    exists(path.join(projectRoot, 'next.config.ts'));
  const hasWebpack =
    packageHasDep(packageJson, 'webpack') ||
    exists(path.join(projectRoot, 'webpack.config.js')) ||
    exists(path.join(projectRoot, 'webpack.config.ts'));

  const hasCursor =
    exists(path.join(projectRoot, '.cursor')) || exists(path.join(os.homedir(), '.cursor'));
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
    viteConfig,
    hasReact,
    hasNext,
    hasWebpack,
    hasPackageJson,
    hasCursor,
    hasVsCode: exists(path.join(projectRoot, '.vscode')),
    hasClaudeDesktop,
    claudeConfig,
    replitDomain: env.REPLIT_DEV_DOMAIN || null,
    packageJson
  };
}

module.exports = {
  exists,
  readJson,
  writeJson,
  detectEnvironment,
  findViteConfig,
  VITE_CONFIG_NAMES,
  APP_DIR_CANDIDATES
};
