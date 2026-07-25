'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { exists, readJson, findViteConfig, packageLooksLikeReact } = require('./detect');

const APP_DIR_CANDIDATES = [
  '.',
  'app',
  'client',
  'web',
  'frontend',
  'packages/app',
  'packages/web',
  'apps/web',
  'apps/frontend'
];

const FRAMEWORK_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.ts',
  'nuxt.config.js',
  'angular.json',
  'svelte.config.js',
  'astro.config.mjs',
  'astro.config.ts'
];

function hasFrameworkMarker(dir) {
  return FRAMEWORK_FILES.some((name) => exists(path.join(dir, name)));
}

function dirPackageLooksLikeReact(dir) {
  return packageLooksLikeReact(readJson(path.join(dir, 'package.json'), null));
}

/**
 * Prefer the real app package (Vite/React) over a bare repo-root package.json.
 */
function findAppDirectory(repoRoot) {
  const root = path.resolve(repoRoot);

  // 1. Known app subdirs with a framework config (before root — monorepos)
  for (const rel of APP_DIR_CANDIDATES) {
    if (rel === '.') continue;
    const candidate = path.join(root, rel);
    if (exists(candidate) && hasFrameworkMarker(candidate)) {
      return { appRoot: candidate, reason: `framework in ${rel}/` };
    }
  }

  // 2. Vite config found via shallow search (e.g. artifacts/<app>/ on Replit)
  const viteConfig = findViteConfig(root);
  if (viteConfig) {
    const viteDir = path.dirname(viteConfig);
    if (viteDir !== root) {
      // Prefer the vite package dir when it looks like React, or root does not.
      if (dirPackageLooksLikeReact(viteDir) || !dirPackageLooksLikeReact(root)) {
        return {
          appRoot: viteDir,
          reason: `vite.config in ${path.relative(root, viteDir) || '.'}`
        };
      }
    }
  }

  // 3. Root has framework
  if (hasFrameworkMarker(root)) {
    return { appRoot: root, reason: 'framework at repo root' };
  }

  // 4. Subdir / root package.json
  for (const rel of APP_DIR_CANDIDATES) {
    const candidate = path.join(root, rel === '.' ? '' : rel);
    if (exists(candidate) && exists(path.join(candidate, 'package.json'))) {
      return {
        appRoot: candidate,
        reason: `package.json in ${rel === '.' ? 'root' : rel + '/'}`
      };
    }
  }

  return { appRoot: root, reason: 'repo root (fallback)' };
}

function readCrankConfig(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const configPath = path.join(dir, '.crank', 'config.json');
    if (exists(configPath)) {
      const config = readJson(configPath, null);
      if (config?.projectRoot && exists(config.projectRoot)) {
        return { config, root: path.resolve(config.projectRoot), from: configPath };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function gitRoot(startDir) {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd: startDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (out && exists(out)) {
      return path.resolve(out);
    }
  } catch {
    // not a git repo
  }
  return null;
}

function gitRemote(root) {
  try {
    return execSync('git remote get-url origin', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

function findPackageRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (exists(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

/**
 * Resolve where the user's app code lives — no manual path required.
 * Priority: CRANK_PROJECT_ROOT → .crank/config → git root + app dir → package.json walk → cwd.
 */
function resolveProjectRoot(startDir = process.cwd()) {
  const explicit = process.env.CRANK_PROJECT_ROOT;
  if (explicit) {
    const resolved = path.resolve(explicit);
    const { appRoot, reason } = findAppDirectory(resolved);
    return {
      projectRoot: appRoot,
      repoRoot: gitRoot(appRoot) || resolved,
      source: 'CRANK_PROJECT_ROOT',
      reason
    };
  }

  const crankConfig = readCrankConfig(startDir);
  if (crankConfig) {
    const { appRoot, reason } = findAppDirectory(crankConfig.root);
    return {
      projectRoot: appRoot,
      repoRoot: gitRoot(appRoot) || crankConfig.root,
      source: '.crank/config.json',
      reason
    };
  }

  const git = gitRoot(startDir);
  if (git) {
    const { appRoot, reason } = findAppDirectory(git);
    return {
      projectRoot: appRoot,
      repoRoot: git,
      source: 'git root',
      reason
    };
  }

  const pkgRoot = findPackageRoot(startDir);
  const { appRoot, reason } = findAppDirectory(pkgRoot);
  return {
    projectRoot: appRoot,
    repoRoot: pkgRoot,
    source: 'cwd / package.json',
    reason
  };
}

function describeEnvironment(projectRoot) {
  const env = process.env;
  const isReplit = Boolean(
    env.REPL_ID || env.REPL_SLUG || env.REPLIT_DEV_DOMAIN || env.REPLIT_DB_URL
  );
  const isCodespaces = Boolean(env.CODESPACES);
  const isCloudShell = Boolean(env.CLOUD_SHELL);
  const resolved = resolveProjectRoot(projectRoot || process.cwd());
  return {
    ...resolved,
    gitRemote: gitRemote(resolved.repoRoot),
    runtime: {
      isReplit,
      isCodespaces,
      isCloudShell,
      isVirtual: isReplit || isCodespaces || isCloudShell,
      replitDomain: env.REPLIT_DEV_DOMAIN || null,
      cwd: process.cwd()
    }
  };
}

module.exports = {
  resolveProjectRoot,
  findAppDirectory,
  describeEnvironment,
  gitRoot,
  gitRemote,
  hasFrameworkMarker
};
