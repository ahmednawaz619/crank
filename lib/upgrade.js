'use strict';

/**
 * Consumer-project upgrade helpers — avoid stale Vite dep cache and broken
 * manual copies when @ahmednawaz/crank is updated.
 */

const fs = require('fs');
const path = require('path');
const { detectEnvironment } = require('./detect');
const { installCrankPackage, detectInstallAttempts } = require('./wire-react');

const MANIFEST = 'crank-install.json';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
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

/** Resolve installed @ahmednawaz/crank root from a consumer project. */
function resolveInstalledCrankRoot(projectRoot) {
  const root = path.resolve(projectRoot);
  const candidates = [
    path.join(root, 'node_modules', '@ahmednawaz', 'crank'),
    path.join(root, 'node_modules', 'crank')
  ];
  for (const dir of candidates) {
    if (exists(path.join(dir, 'package.json'))) {
      return dir;
    }
  }
  return null;
}

function readInstalledCrankVersion(projectRoot) {
  const crankRoot = resolveInstalledCrankRoot(projectRoot);
  if (!crankRoot) {
    return null;
  }
  const pkg = readJson(path.join(crankRoot, 'package.json'), {});
  return String(pkg.version || '').trim() || null;
}

function manifestPath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.crank', MANIFEST);
}

function readInstallManifest(projectRoot) {
  return readJson(manifestPath(projectRoot), {});
}

function writeInstallManifest(projectRoot, data) {
  writeJson(manifestPath(projectRoot), {
    ...readInstallManifest(projectRoot),
    ...data,
    updatedAt: new Date().toISOString()
  });
}

/** Remove Vite pre-bundle caches so panel-source changes are picked up. */
function clearViteDepCache(projectRoot) {
  const root = path.resolve(projectRoot);
  const env = detectEnvironment(root);
  const targets = new Set([
    path.join(root, 'node_modules', '.vite'),
    path.join(root, '.vite')
  ]);
  if (env.viteConfig) {
    targets.add(path.join(path.dirname(env.viteConfig), 'node_modules', '.vite'));
  }
  const cleared = [];
  for (const dir of targets) {
    if (!exists(dir)) {
      continue;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      cleared.push(path.relative(root, dir) || dir);
    } catch (err) {
      cleared.push(`${path.relative(root, dir) || dir} (failed: ${err.message})`);
    }
  }
  return cleared;
}

/** Ensure crank package root can load MCP/companion runtime deps. */
function verifyCrankRuntimeDeps(crankRoot) {
  const missing = [];
  for (const dep of ['@modelcontextprotocol/sdk', 'express', 'zod', 'ws', 'cors']) {
    try {
      require.resolve(dep, { paths: [crankRoot] });
    } catch {
      missing.push(dep);
    }
  }
  return { ok: missing.length === 0, missing, crankRoot };
}

function readPanelLoaderVersion(crankRoot) {
  try {
    const src = fs.readFileSync(path.join(crankRoot, 'react.mjs'), 'utf8');
    const m = src.match(
      /export const CRANK_REACT_LOADER_VERSION = "([^"]+)"/
    );
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * After a proper package-manager install — bust Vite cache when version changes.
 * @param {string} crankPackageRoot — path to node_modules/@ahmednawaz/crank
 */
function onCrankPackageInstalled(crankPackageRoot) {
  const version = readJson(path.join(crankPackageRoot, 'package.json'), {}).version;
  if (!version) {
    return { skipped: true, reason: 'no-version' };
  }

  let dir = path.resolve(crankPackageRoot);
  let consumerRoot = null;
  while (dir !== path.dirname(dir)) {
    const parent = path.dirname(dir);
    const pkgPath = path.join(parent, 'package.json');
    if (exists(pkgPath)) {
      const pkg = readJson(pkgPath, {});
      if (pkg.name !== '@ahmednawaz/crank') {
        consumerRoot = parent;
        break;
      }
    }
    dir = parent;
  }

  if (!consumerRoot) {
    return { skipped: true, reason: 'consumer-root-not-found', version };
  }

  const prev = readInstallManifest(consumerRoot).version || null;
  if (prev === version) {
    return { skipped: true, reason: 'unchanged', version, consumerRoot };
  }

  const cleared = clearViteDepCache(consumerRoot);
  writeInstallManifest(consumerRoot, { version, panelLoader: readPanelLoaderVersion(crankPackageRoot) });

  if (prev && cleared.length) {
    console.log(
      `[crank] Upgraded ${prev} → ${version} — cleared Vite cache (${cleared.join(', ')})`
    );
  }

  return { upgraded: true, from: prev, to: version, consumerRoot, cleared };
}

/**
 * Full upgrade in a consumer repo: package manager @latest + Vite cache + verify.
 * @param {string} projectRoot
 * @param {{ install?: boolean }} [options]
 */
function upgradeCrankProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const before = readInstalledCrankVersion(root);
  const result = {
    ok: true,
    projectRoot: root,
    before,
    install: null,
    clearedViteCache: [],
    verify: null,
    after: null,
    hints: []
  };

  if (options.install !== false) {
    result.install = installCrankPackage(root, { latest: true });
    if (!result.install.installed) {
      result.ok = false;
      result.hints.push(
        result.install.installHint ||
          'Run your package manager: pnpm add -D @ahmednawaz/crank@latest'
      );
      result.hints.push(
        'Do not copy crank files manually — always install through npm/pnpm.'
      );
      return result;
    }
  }

  result.clearedViteCache = clearViteDepCache(root);
  result.after = readInstalledCrankVersion(root);

  const crankRoot = resolveInstalledCrankRoot(root);
  if (crankRoot) {
    result.verify = verifyCrankRuntimeDeps(crankRoot);
    result.panelLoaderVersion = readPanelLoaderVersion(crankRoot);
    writeInstallManifest(root, {
      version: result.after,
      panelLoader: result.panelLoaderVersion
    });
    if (!result.verify.ok) {
      result.ok = false;
      result.hints.push(
        `Missing crank runtime deps: ${result.verify.missing.join(', ')} — re-run install (pnpm add -D @ahmednawaz/crank@latest)`
      );
    }
  } else {
    result.ok = false;
    result.hints.push('@ahmednawaz/crank not found in node_modules after install');
  }

  if (result.clearedViteCache.length) {
    result.hints.push('Restart the Vite dev server, then hard-refresh the browser (Cmd+Shift+R).');
  }

  return result;
}

function diagnoseCrankInstall(projectRoot) {
  const root = path.resolve(projectRoot);
  const crankRoot = resolveInstalledCrankRoot(root);
  const installed = readInstalledCrankVersion(root);
  const manifest = readInstallManifest(root);
  const verify = crankRoot ? verifyCrankRuntimeDeps(crankRoot) : { ok: false, missing: ['@ahmednawaz/crank'] };
  const viteCacheDirs = [
    path.join(root, 'node_modules', '.vite'),
    path.join(root, '.vite')
  ].filter(exists);

  return {
    installedVersion: installed,
    manifest,
    panelLoaderVersion: crankRoot ? readPanelLoaderVersion(crankRoot) : null,
    viteCachePresent: viteCacheDirs.length > 0,
    viteCacheDirs: viteCacheDirs.map((d) => path.relative(root, d)),
    runtimeDeps: verify,
    staleViteCache:
      installed &&
      manifest.version &&
      installed === manifest.version &&
      manifest.panelLoader &&
      manifest.panelLoader !== readPanelLoaderVersion(crankRoot)
  };
}

module.exports = {
  clearViteDepCache,
  diagnoseCrankInstall,
  onCrankPackageInstalled,
  readInstalledCrankVersion,
  resolveInstalledCrankRoot,
  upgradeCrankProject,
  verifyCrankRuntimeDeps
};
