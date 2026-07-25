#!/usr/bin/env node
'use strict';

/**
 * Pre-publish integrity checks:
 *  1. Root runtime deps exist in node_modules
 *  2. Every relative require()/import in shipped JS resolves on disk
 *  3. npm pack install can load companion + MCP entrypoints
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

const root = path.resolve(__dirname, '..');
const SHIPPED_DIRS = ['bin', 'lib', 'companion', 'mcp-server'];

const REQUIRED_DEPS = [
  'express',
  'cors',
  'ws',
  '@modelcontextprotocol/sdk',
  'zod',
  '@cursor/sdk'
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
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
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

function verifyRelativeImports() {
  const files = SHIPPED_DIRS.flatMap((d) => walkJs(path.join(root, d)));
  const missing = [];
  const requireRe = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;
  const importRe = /(?:from|import)\s+['"](\.\.?\/[^'"]+)['"]/g;

  for (const file of files) {
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

    execSync('npm init -y', { cwd: tmp, stdio: 'ignore' });
    execSync(`npm install "${tgzPath}"`, {
      cwd: tmp,
      stdio: 'ignore',
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' }
    });

    const pkgRoot = path.join(tmp, 'node_modules', '@ahmednawaz', 'crank');
    const mustExist = [
      'bin/crank.js',
      'lib/env.js',
      'companion/server.js',
      'mcp-server/index.js',
      'mcp-server/tools.js'
    ];
    for (const rel of mustExist) {
      if (!fs.existsSync(path.join(pkgRoot, rel))) {
        fail(`Packed tarball missing ${rel}`);
      }
    }

    // Companion: resolve all CJS requires without starting the HTTP server.
    const loadCheck = `
      process.env.CRANK_PORT = '0';
      const Module = require('module');
      const orig = Module.prototype.require;
      // Intercept listen-side effects by loading only the dependency graph first.
      require(${JSON.stringify(path.join(pkgRoot, 'lib/env.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/selection-store.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/glean-client.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/vizpatch-bridge.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/text-dispatch.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/persist-apply.js'))});
      require(${JSON.stringify(path.join(pkgRoot, 'companion/agent-queue.js'))});
      // agent-runner may pull @cursor/sdk; that is fine if installed.
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

    // server.js starts listening on require — spawn briefly and expect no MODULE_NOT_FOUND.
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

    // MCP: import graph (ESM).
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
    console.log('verify:pack OK (fresh npm pack install)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

verifyRootDeps();
verifyRelativeImports();
if (process.argv.includes('--skip-pack')) {
  console.log('verify:pack skipped (--skip-pack)');
  process.exit(0);
}
verifyPackedInstall();
