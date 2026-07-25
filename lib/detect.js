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

const REACT_DEP_NAMES = [
  'react',
  'react-dom',
  '@vitejs/plugin-react',
  '@vitejs/plugin-react-swc',
  'next'
];

const REACT_ENTRY_HINTS = [
  'src/main.tsx',
  'src/main.jsx',
  'src/index.tsx',
  'src/index.jsx',
  'client/src/main.tsx',
  'app/main.tsx',
  'main.tsx',
  'main.jsx',
  'index.tsx',
  'index.jsx'
];

function packageLooksLikeReact(pkg) {
  return REACT_DEP_NAMES.some((name) => packageHasDep(pkg, name));
}

function dirHasNextConfig(dir) {
  return (
    exists(path.join(dir, 'next.config.js')) ||
    exists(path.join(dir, 'next.config.mjs')) ||
    exists(path.join(dir, 'next.config.ts'))
  );
}

function dirHasReactEntryHint(dir) {
  return REACT_ENTRY_HINTS.some((rel) => exists(path.join(dir, rel)));
}

/**
 * True when this directory (or a common app child) looks like a React app.
 * Root package.json often omits react in monorepos / Replit multi-package layouts.
 */
function detectHasReact(projectRoot, packageJson, viteConfig) {
  if (packageLooksLikeReact(packageJson) || dirHasNextConfig(projectRoot)) {
    return true;
  }
  if (dirHasReactEntryHint(projectRoot)) {
    return true;
  }

  const dirs = new Set([projectRoot]);
  for (const sub of APP_DIR_CANDIDATES) {
    if (sub === '.') continue;
    dirs.add(path.join(projectRoot, sub));
  }
  if (viteConfig) {
    dirs.add(path.dirname(viteConfig));
  }

  for (const dir of dirs) {
    if (!exists(dir) || dir === projectRoot) continue;
    const pkg = readJson(path.join(dir, 'package.json'), null);
    if (packageLooksLikeReact(pkg) || dirHasNextConfig(dir) || dirHasReactEntryHint(dir)) {
      return true;
    }
  }

  // Vite + JSX plugin import in config is a strong React signal
  if (viteConfig && exists(viteConfig)) {
    try {
      const src = fs.readFileSync(viteConfig, 'utf8');
      if (
        /@vitejs\/plugin-react/.test(src) ||
        /\bplugin-react\b/.test(src) ||
        /from ['"]react['"]/.test(src)
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
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
  const hasReact = detectHasReact(projectRoot, packageJson, viteConfig);
  const hasNext =
    packageHasDep(packageJson, 'next') ||
    dirHasNextConfig(projectRoot) ||
    [...APP_DIR_CANDIDATES]
      .filter((s) => s !== '.')
      .some((sub) => dirHasNextConfig(path.join(projectRoot, sub)));
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
  detectHasReact,
  packageLooksLikeReact,
  findViteConfig,
  VITE_CONFIG_NAMES,
  APP_DIR_CANDIDATES
};
