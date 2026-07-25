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

function detectInstallCommand(projectRoot) {
  if (
    exists(path.join(projectRoot, 'pnpm-lock.yaml')) ||
    exists(path.join(projectRoot, 'pnpm-workspace.yaml'))
  ) {
    return { cmd: 'pnpm', args: ['add', '-D', '@ahmednawaz/crank'] };
  }
  if (exists(path.join(projectRoot, 'yarn.lock'))) {
    return { cmd: 'yarn', args: ['add', '-D', '@ahmednawaz/crank'] };
  }
  return { cmd: 'npm', args: ['install', '-D', '@ahmednawaz/crank'] };
}

function installCrankPackage(projectRoot) {
  const { execFileSync } = require('child_process');
  const { cmd, args } = detectInstallCommand(projectRoot);
  const result = { installed: false, installCommand: `${cmd} ${args.join(' ')}` };
  try {
    execFileSync(cmd, args, { cwd: projectRoot, stdio: 'inherit', env: process.env });
    result.installed = true;
    return result;
  } catch (err) {
    result.installError = err.message;
  }
  if (cmd !== 'npm') {
    try {
      execFileSync('npm', ['install', '-D', '@ahmednawaz/crank'], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: process.env
      });
      result.installed = true;
      result.installCommand = 'npm install -D @ahmednawaz/crank';
      delete result.installError;
    } catch (err2) {
      result.installError = err2.message;
    }
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
  detectInstallCommand
};
