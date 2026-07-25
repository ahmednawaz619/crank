#!/usr/bin/env node
'use strict';

/**
 * Pre-publish integrity checks:
 *  1. Root runtime deps exist in node_modules
 *  2. package.json "files" includes every path imported by the React/panel entry
 *  3. Every relative require()/import in shipped JS/MJS resolves on disk
 *  4. npm pack install can load companion, MCP, and panel-boot/react entries
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const root = path.resolve(__dirname, '..');
const SHIPPED_DIRS = ['bin', 'lib', 'companion', 'mcp-server', 'bookmarklet'];
const ROOT_SHIPPED_MODULES = [
  'react.mjs',
  'react.js',
  'react.d.ts',
  'panel-boot.mjs',
  'panel-source.mjs',
  'next.mjs',
  'next.js',
  'vite.js',
  'webpack.js'
];

/** Must be present in the published tarball — React panel chain. */
const REQUIRED_PACK_FILES = [
  'bin/crank.js',
  'lib/env.js',
  'companion/server.js',
  'mcp-server/index.js',
  'mcp-server/tools.js',
  'react.mjs',
  'react.js',
  'panel-boot.mjs',
  'panel-source.mjs',
  'bookmarklet/crank-bookmarklet.js',
  'bookmarklet/crank-ui.css',
  'bookmarklet/crank-ui-helpers.js',
  'bookmarklet/text-source.js',
  'vite.js',
  'CLAUDE.md',
  'AGENTS.md'
];

const REQUIRED_DEPS = [
  'express',
  'cors',
  'http-proxy',
  'ws',
  '@modelcontextprotocol/sdk',
  'zod',
  '@cursor/sdk',
  'cheerio',
  '@babel/parser',
  '@babel/traverse'
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs')
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function verifyRootDeps() {
  const missing = [];
  for (const name of REQUIRED_DEPS) {
    const pkgDir = name.startsWith('@')
      ? path.join(root, 'node_modules', ...name.split('/'))
      : path.join(root, 'node_modules', name);
    if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
      missing.push(name);
    }
  }
  if (missing.length) {
    fail(
      `Missing runtime dependencies at package root:\n${missing
        .map((n) => `  - ${n}`)
        .join('\n')}\nRun npm install at repo root before publishing.`
    );
  }
  console.log(`verify:deps OK (${REQUIRED_DEPS.length} packages)`);
}

function verifyPackageFilesField() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = pkg.files || [];
  const requiredInFiles = [
    'panel-boot.mjs',
    'panel-source.mjs',
    'react.mjs',
    'react.js',
    'bookmarklet',
    'bin',
    'lib',
    'companion',
    'mcp-server',
    'vite.js',
    'CLAUDE.md'
  ];
  const missing = requiredInFiles.filter((f) => !files.includes(f));
  if (missing.length) {
    fail(
      `package.json "files" is missing required publish paths (npm will omit them):\n${missing
        .map((m) => `  - ${m}`)
        .join('\n')}`
    );
  }

  for (const rel of ROOT_SHIPPED_MODULES) {
    if (!fs.existsSync(path.join(root, rel))) {
      fail(`Required ship file missing on disk: ${rel}`);
    }
  }

  // React panel import chain must exist on disk before pack
  const chain = ['react.mjs', 'panel-boot.mjs', 'panel-source.mjs'];
  for (const rel of chain) {
    if (!fs.existsSync(path.join(root, rel))) {
      fail(`Panel chain broken — missing ${rel}`);
    }
  }

  const reactSrc = fs.readFileSync(path.join(root, 'react.mjs'), 'utf8');
  if (!reactSrc.includes("from './panel-boot.mjs'") && !reactSrc.includes('from "./panel-boot.mjs"')) {
    fail('react.mjs must import ./panel-boot.mjs');
  }
  const bootSrc = fs.readFileSync(path.join(root, 'panel-boot.mjs'), 'utf8');
  if (!bootSrc.includes("from './panel-source.mjs'") && !bootSrc.includes('from "./panel-source.mjs"')) {
    fail('panel-boot.mjs must import ./panel-source.mjs');
  }

  console.log('verify:files OK (package.json files + panel chain)');
}

function verifyRelativeImports() {
  const files = [
    ...SHIPPED_DIRS.flatMap((d) => walkJs(path.join(root, d))),
    ...ROOT_SHIPPED_MODULES.filter((f) => /\.(js|mjs|cjs)$/.test(f)).map((f) =>
      path.join(root, f)
    )
  ];
  const missing = [];
  const requireRe = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  const importRe = /(?:from|import)\s+['"](\.\.?\/[^'"]+)['"]/g;

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const re of [requireRe, importRe]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(src))) {
        if (!resolveRelative(file, match[1])) {
          missing.push({
            file: path.relative(root, file),
            req: match[1]
          });
        }
      }
    }
  }

  if (missing.length) {
    fail(
      `Broken relative imports (would crash after npx install):\n${missing
        .map((m) => `  - ${m.file} → ${m.req}`)
        .join('\n')}`
    );
  }
  console.log(`verify:imports OK (${files.length} files scanned)`);
}

function verifyPackedInstall() {
  // Ensure embedded panel is fresh before pack
  execSync('node scripts/embed-panel.js', { cwd: root, stdio: 'inherit' });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-pack-'));
  try {
    const packOut = execSync('npm pack --silent', {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    const tgzName = packOut.split(/\n/).filter(Boolean).pop();
    const tgzPath = path.join(root, tgzName);
    if (!fs.existsSync(tgzPath)) {
      fail(`npm pack did not produce ${tgzName}`);
    }

    // List tarball contents — catch "files" omissions before install
    const listed = execSync(`tar -tzf "${tgzPath}"`, { encoding: 'utf8' })
      .split(/\n/)
      .filter(Boolean)
      .map((l) => l.replace(/^package\//, ''));
    for (const rel of REQUIRED_PACK_FILES) {
      if (!listed.includes(rel)) {
        fail(
          `npm pack tarball missing ${rel}\n` +
            `Check package.json "files". Listed sample:\n  ${listed.slice(0, 20).join('\n  ')}`
        );
      }
    }
    console.log(`verify:tarball OK (${REQUIRED_PACK_FILES.length} required paths present)`);

    execSync('npm init -y', { cwd: tmp, stdio: 'ignore' });
    execSync(`npm install "${tgzPath}"`, {
      cwd: tmp,
      stdio: 'ignore',
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' }
    });

    const pkgRoot = path.join(tmp, 'node_modules', '@ahmednawaz', 'crank');
    for (const rel of REQUIRED_PACK_FILES) {
      if (!fs.existsSync(path.join(pkgRoot, rel))) {
        fail(`Packed install missing ${rel}`);
      }
    }

    // Panel ESM chain (the 0.3.2 failure mode)
    const panelCheck = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import { bootCrankPanel } from ${JSON.stringify(path.join(pkgRoot, 'panel-boot.mjs'))};
          if (typeof bootCrankPanel !== 'function') throw new Error('bootCrankPanel missing');
          console.log('panel-boot OK');
        `
      ],
      { cwd: pkgRoot, encoding: 'utf8' }
    );
    if (panelCheck.status !== 0) {
      fail(`Packed panel-boot import failed:\n${panelCheck.stderr || panelCheck.stdout}`);
    }

    // react.mjs must import panel-boot (static check + resolve path on disk in pack)
    const packedReact = fs.readFileSync(path.join(pkgRoot, 'react.mjs'), 'utf8');
    if (
      !packedReact.includes("from './panel-boot.mjs'") &&
      !packedReact.includes('from "./panel-boot.mjs"')
    ) {
      fail('Packed react.mjs does not import ./panel-boot.mjs');
    }
    if (!fs.existsSync(path.join(pkgRoot, 'panel-boot.mjs'))) {
      fail('Packed react.mjs imports panel-boot.mjs but file is missing');
    }
    console.log('react.mjs → panel-boot.mjs OK');

    // Companion: resolve all CJS requires without starting the HTTP server.
    const loadCheck = `
      process.env.CRANK_PORT = '0';
      require(${JSON.stringify(path.join(pkgRoot, 'lib/env.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/selection-store.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/glean-client.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/asset-bridge.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/text-writer.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/text-dispatch.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/persist-apply.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/agent-queue.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/agent-runner.js'))});
      console.log('companion modules OK');
    `;
    const companion = spawnSync(process.execPath, ['-e', loadCheck], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, CRANK_PROJECT_ROOT: tmp }
    });
    if (companion.status !== 0) {
      fail(
        `Packed companion module load failed:\n${companion.stderr || companion.stdout}`
      );
    }

    const serverPath = path.join(pkgRoot, 'companion', 'server.js');
    const server = spawnSync(
      process.execPath,
      [
        '-e',
        `
          const { spawn } = require('child_process');
          const child = spawn(process.execPath, [${JSON.stringify(serverPath)}], {
            env: { ...process.env, CRANK_PORT: '13344', CRANK_HOST: '127.0.0.1', CRANK_PROJECT_ROOT: ${JSON.stringify(tmp)} },
            stdio: ['ignore', 'pipe', 'pipe']
          });
          let out = '';
          child.stdout.on('data', (d) => { out += d; });
          child.stderr.on('data', (d) => { out += d; });
          setTimeout(() => {
            child.kill('SIGTERM');
            if (/Cannot find module/.test(out)) {
              console.error(out);
              process.exit(1);
            }
            if (!/Companion listening|EADDRINUSE|already in use/.test(out) && child.exitCode) {
              console.error(out || 'companion exited without listen log');
              process.exit(1);
            }
            console.log('companion server OK');
            process.exit(0);
          }, 1500);
        `
      ],
      { encoding: 'utf8', timeout: 8000 }
    );
    if (server.status !== 0) {
      fail(`Packed companion server smoke failed:\n${server.stderr || server.stdout}`);
    }

    const mcpCheck = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import ${JSON.stringify(path.join(pkgRoot, 'mcp-server/tools.js'))}; console.log('mcp tools OK');`
      ],
      { cwd: pkgRoot, encoding: 'utf8' }
    );
    if (mcpCheck.status !== 0) {
      fail(`Packed MCP module load failed:\n${mcpCheck.stderr || mcpCheck.stdout}`);
    }

    try {
      fs.unlinkSync(tgzPath);
    } catch {
      // ignore
    }
    console.log('verify:pack OK (fresh npm pack install + panel/react/companion/mcp)');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

verifyRootDeps();
verifyPackageFilesField();
verifyRelativeImports();
if (process.argv.includes('--skip-pack')) {
  console.log('verify:pack skipped (--skip-pack)');
} else {
  verifyPackedInstall();
}
