'use strict';

/**
 * Auto-wire Retune-style <Crank /> into the app entry file (Sentry/Clerk-style inject).
 */

const fs = require('fs');
const path = require('path');
const { exists } = require('./detect');

const ENTRY_CANDIDATES = [
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/index.tsx',
  'src/index.jsx',
  'src/index.ts',
  'src/index.js',
  'client/src/main.tsx',
  'client/src/main.jsx',
  'client/src/index.tsx',
  'app/main.tsx',
  'src/App.tsx',
  'src/App.jsx',
  'App.tsx',
  'App.jsx',
  'main.tsx',
  'main.jsx',
  'index.tsx',
  'index.jsx'
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

function findEntryByCreateRoot(projectRoot) {
  const queue = [{ dir: path.resolve(projectRoot), depth: 0 }];
  const hits = [];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 3) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          queue.push({ dir: full, depth: depth + 1 });
        }
        continue;
      }
      if (!/\.(tsx|jsx|ts|js)$/.test(entry.name)) continue;
      let src;
      try {
        src = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (
        /createRoot\s*\(/.test(src) ||
        /ReactDOM\.render\s*\(/.test(src) ||
        /hydrateRoot\s*\(/.test(src)
      ) {
        hits.push(full);
      }
    }
  }
  // Prefer main/index over App
  hits.sort((a, b) => {
    const score = (p) => {
      const base = path.basename(p).toLowerCase();
      if (base.startsWith('main')) return 0;
      if (base.startsWith('index')) return 1;
      return 2;
    };
    return score(a) - score(b);
  });
  return hits[0] || null;
}

function findEntry(projectRoot) {
  for (const rel of ENTRY_CANDIDATES) {
    const full = path.join(projectRoot, rel);
    if (exists(full)) {
      return full;
    }
  }
  return findEntryByCreateRoot(projectRoot);
}

function alreadyWired(source) {
  return (
    /@ahmednawaz\/crank\/react/.test(source) ||
    /from ['"]@ahmednawaz\/crank['"]/.test(source) ||
    /<Crank[\s/>]/.test(source)
  );
}

function insertImport(source) {
  const importLine = `import { Crank } from '@ahmednawaz/crank/react';`;
  const matches = [...source.matchAll(/^import\s.+;?\s*$/gm)];
  if (matches.length) {
    const last = matches[matches.length - 1];
    const idx = last.index + last[0].length;
    return source.slice(0, idx) + `\n${importLine}` + source.slice(idx);
  }
  return `${importLine}\n${source}`;
}

function insertCrankJsx(source) {
  if (/<Crank[\s/>]/.test(source)) {
    return { source, patched: true };
  }

  if (/<StrictMode>/.test(source)) {
    return {
      source: source.replace(/(<StrictMode>\s*)/, '$1\n    <Crank />\n    '),
      patched: true
    };
  }

  if (/\.render\s*\(\s*<>/.test(source) || /\.render\s*\(\s*<React\.Fragment>/.test(source)) {
    return {
      source: source.replace(/(<>\s*|<React\.Fragment>\s*)/, '$1\n    <Crank />\n    '),
      patched: true
    };
  }

  // createRoot(...).render(<App />) or multi-line JSX root
  if (/\.render\s*\(/.test(source)) {
    // Single-line: .render(<App />)
    let next = source.replace(
      /\.render\s*\(\s*(<(?!>)[^]*?>)\s*\)/m,
      '.render(\n  <>\n    $1\n    <Crank />\n  </>\n)'
    );
    if (next !== source && /<Crank[\s/>]/.test(next)) {
      return { source: next, patched: true };
    }

    // Multi-line root starting with <Something
    next = source.replace(
      /(\.render\s*\(\s*\n\s*)(<[A-Za-z/])/,
      '$1<>\n    <Crank />\n    $2'
    );
    if (next !== source) {
      // close fragment before the render's closing paren — best effort
      next = next.replace(
        /(\.render\s*\([\s\S]*?)(\n\s*\))/,
        (match, body, close) => {
          if (body.includes('<Crank') && !body.includes('</>')) {
            return `${body}\n  </>${close}`;
          }
          return match;
        }
      );
      if (/<Crank[\s/>]/.test(next)) {
        return { source: next, patched: true };
      }
    }
  }

  if (/ReactDOM\.render\s*\(/.test(source)) {
    const next = source.replace(
      /ReactDOM\.render\s*\(\s*(<(?!>)[^]*?>)\s*,/,
      'ReactDOM.render(\n  <>\n    $1\n    <Crank />\n  </>,'
    );
    if (next !== source && /<Crank[\s/>]/.test(next)) {
      return { source: next, patched: true };
    }
  }

  if (/<App\b[^/]*?\/>/.test(source)) {
    return {
      source: source.replace(/(<App\b[^/]*?\/>)/, '<Crank />\n      $1'),
      patched: true
    };
  }
  if (/<App\b[^>]*>/.test(source)) {
    return {
      source: source.replace(/(<App\b[^>]*>)/, '<Crank />\n      $1'),
      patched: true
    };
  }

  return { source, patched: false };
}

/**
 * Patch the React entry to mount <Crank />. Idempotent.
 * @returns {{ wired: boolean, reason?: string, file?: string }}
 */
function wireReactEntry(projectRoot) {
  const entryPath = findEntry(projectRoot);
  if (!entryPath) {
    return { wired: false, reason: 'no-entry' };
  }

  let source = fs.readFileSync(entryPath, 'utf8');
  if (alreadyWired(source)) {
    return { wired: false, reason: 'already-present', file: entryPath };
  }

  source = insertImport(source);
  const { source: next, patched } = insertCrankJsx(source);
  source = next;

  if (!patched) {
    return { wired: false, reason: 'unrecognized-entry-shape', file: entryPath };
  }

  fs.writeFileSync(entryPath, source);
  return { wired: true, file: entryPath };
}

function findPnpmWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (
      exists(path.join(dir, 'pnpm-workspace.yaml')) ||
      exists(path.join(dir, 'pnpm-workspace.yml'))
    ) {
      return dir;
    }
    // lockfile alone can mean pnpm without workspaces
    if (exists(path.join(dir, 'pnpm-lock.yaml')) && i === 0) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Prefer ancestor with lockfile if no workspace file
  dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(dir, 'pnpm-lock.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackageName(projectRoot) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );
    return pkg.name || null;
  } catch {
    return null;
  }
}

/**
 * Build install attempts for this project (pnpm monorepo-aware).
 * Never uses npm as a fallback inside a pnpm workspace.
 */
function detectInstallAttempts(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const spec = options.latest ? '@ahmednawaz/crank@latest' : '@ahmednawaz/crank';
  const pnpmRoot = findPnpmWorkspaceRoot(root);
  const attempts = [];

  if (pnpmRoot) {
    const isWorkspace = exists(path.join(pnpmRoot, 'pnpm-workspace.yaml')) ||
      exists(path.join(pnpmRoot, 'pnpm-workspace.yml'));
    const pkgName = readPackageName(root);
    const relFilter = path.relative(pnpmRoot, root).replace(/\\/g, '/') || '.';

    // 1) From the package directory (works when cwd is the workspace package)
    attempts.push({
      cmd: 'pnpm',
      args: ['add', '-D', spec],
      cwd: root,
      label: `pnpm add -D ${spec} (in ${relFilter})`
    });

    if (isWorkspace && pnpmRoot !== root) {
      // 2) From monorepo root with --filter by package name
      if (pkgName) {
        attempts.push({
          cmd: 'pnpm',
          args: ['add', '-D', spec, '--filter', pkgName],
          cwd: pnpmRoot,
          label: `pnpm add -D ${spec} --filter ${pkgName}`
        });
      }
      // 3) From monorepo root with --filter by path
      attempts.push({
        cmd: 'pnpm',
        args: ['add', '-D', spec, '--filter', `./${relFilter}`],
        cwd: pnpmRoot,
        label: `pnpm add -D ${spec} --filter ./${relFilter}`
      });
    }

    return attempts;
  }

  if (exists(path.join(root, 'yarn.lock'))) {
    return [
      {
        cmd: 'yarn',
        args: ['add', '-D', spec],
        cwd: root,
        label: `yarn add -D ${spec}`
      }
    ];
  }

  return [
    {
      cmd: 'npm',
      args: ['install', '-D', spec],
      cwd: root,
      label: `npm install -D ${spec}`
    }
  ];
}

function detectInstallCommand(projectRoot) {
  const attempts = detectInstallAttempts(projectRoot);
  const first = attempts[0];
  return { cmd: first.cmd, args: first.args, cwd: first.cwd };
}

function installCrankPackage(projectRoot, options = {}) {
  const { execFileSync } = require('child_process');
  const attempts = detectInstallAttempts(projectRoot, options);
  const result = {
    installed: false,
    installCommand: attempts[0]?.label || '',
    installAttempts: []
  };

  for (const attempt of attempts) {
    result.installAttempts.push(attempt.label);
    try {
      execFileSync(attempt.cmd, attempt.args, {
        cwd: attempt.cwd,
        stdio: 'inherit',
        env: process.env
      });
      result.installed = true;
      result.installCommand = attempt.label;
      delete result.installError;
      return result;
    } catch (err) {
      result.installError = err.message;
    }
  }

  // Hint for humans / agents — do not npm-install into a pnpm monorepo
  const pkgName = readPackageName(projectRoot);
  if (findPnpmWorkspaceRoot(projectRoot)) {
    result.installHint = pkgName
      ? `pnpm add -D @ahmednawaz/crank --filter ${pkgName}`
      : `pnpm add -D @ahmednawaz/crank --filter ${path.basename(projectRoot)}`;
  }

  return result;
}

/**
 * Full inject flow: ensure dep → install → patch entry.
 */
function injectCrank(projectRoot, options = {}) {
  const results = {
    projectRoot,
    wrote: []
  };

  if (options.install !== false) {
    Object.assign(results, installCrankPackage(projectRoot));
  }

  const wire = wireReactEntry(projectRoot);
  results.reactWire = wire;
  if (wire.wired && wire.file) {
    results.wrote.push(path.relative(projectRoot, wire.file));
  }
  return results;
}

module.exports = {
  wireReactEntry,
  installCrankPackage,
  injectCrank,
  findEntry,
  detectInstallCommand,
  detectInstallAttempts,
  findPnpmWorkspaceRoot
};
