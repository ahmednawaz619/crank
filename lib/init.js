'use strict';

const fs = require('fs');
const path = require('path');
const {
  exists,
  readJson,
  writeJson,
  detectEnvironment,
  findViteConfig
} = require('./detect');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const { resolveUrls } = require('./urls');

function ensureGitignore(projectRoot) {
  const file = path.join(projectRoot, '.gitignore');
  const lines = [
    '.env',
    '.env.local',
    '.crank/secrets.json',
    '.crank/runtime.json',
    'node_modules/'
  ];
  let current = exists(file) ? fs.readFileSync(file, 'utf8') : '';
  let changed = false;
  for (const line of lines) {
    if (!current.split(/\r?\n/).includes(line)) {
      current = `${current.trimEnd()}\n${line}\n`;
      changed = true;
    }
  }
  if (changed || !exists(file)) {
    fs.writeFileSync(file, current.endsWith('\n') ? current : `${current}\n`);
  }
}

function mcpServerEntry(projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const companionUrl = `http://127.0.0.1:${process.env.CRANK_PORT || '3344'}`;
  const envBlock = {
    CRANK_COMPANION_URL: companionUrl,
    CRANK_MCP_MODE: 'stdio',
    CRANK_PROJECT_ROOT: root
  };

  const localBin = path.join(root, 'node_modules', 'crank', 'bin', 'crank.js');
  if (exists(localBin)) {
    return {
      command: 'npx',
      args: ['crank', 'mcp'],
      env: envBlock
    };
  }

  // Retune-style — npx resolves @ahmednawaz/crank from npm (no git clone, no absolute paths).
  return {
    command: 'npx',
    args: ['@ahmednawaz/crank', 'mcp'],
    env: envBlock
  };
}

function mergeMcpServers(file, serverKey = 'crank', projectRoot) {
  const existing = readJson(file, { mcpServers: {} }) || { mcpServers: {} };
  if (!existing.mcpServers) {
    existing.mcpServers = {};
  }
  existing.mcpServers[serverKey] = mcpServerEntry(projectRoot);
  writeJson(file, existing);
  return file;
}

/** VS Code / Copilot style uses `servers` in some versions; write both shapes safely. */
function mergeVsCodeMcp(file, projectRoot) {
  const existing = readJson(file, {}) || {};
  if (!existing.servers && !existing.mcpServers) {
    existing.servers = {};
  }
  const entryBase = mcpServerEntry(projectRoot);
  const entry = {
    type: 'stdio',
    command: entryBase.command,
    args: entryBase.args,
    env: entryBase.env
  };
  if (existing.servers) {
    existing.servers.crank = entry;
  } else {
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers.crank = entryBase;
  }
  writeJson(file, existing);
  return file;
}

function patchViteConfig(projectRoot) {
  const configPath = findViteConfig(projectRoot);
  if (!configPath) {
    return { patched: false, reason: 'no-vite-config' };
  }
  let source = fs.readFileSync(configPath, 'utf8');
  if (/(\bcrank)\s*\(/.test(source) && /plugins/.test(source)) {
    return { patched: false, reason: 'already-present', file: configPath };
  }

  // Copy plugin into the project so Vite can resolve a relative import everywhere.
  const localPluginDir = path.join(projectRoot, '.crank');
  fs.mkdirSync(localPluginDir, { recursive: true });
  const localPlugin = path.join(localPluginDir, 'vite-plugin.cjs');
  fs.copyFileSync(path.join(PACKAGE_ROOT, 'vite.js'), localPlugin);

  const rel = './.crank/vite-plugin.cjs';
  const isEsm =
    configPath.endsWith('.mjs') ||
    (/^import\s/m.test(source) && !configPath.endsWith('.cjs'));
  const importLine = isEsm
    ? `import { crank } from '${rel}';\n`
    : `const { crank } = require('${rel}');\n`;

  if (!/vite-plugin\.cjs|from ['"]crank/.test(source)) {
    source = importLine + source;
  }

  if (/plugins\s*:\s*\[\s*\]/.test(source)) {
    source = source.replace(/plugins\s*:\s*\[\s*\]/, 'plugins: [crank()]');
  } else if (/plugins\s*:\s*\[/.test(source)) {
    source = source.replace(/plugins\s*:\s*\[/, 'plugins: [crank(), ');
  } else if (/defineConfig\s*\(\s*\{/.test(source)) {
    source = source.replace(
      /defineConfig\s*\(\s*\{/,
      'defineConfig({\n  plugins: [crank()],'
    );
  } else if (/export\s+default\s+\{/.test(source)) {
    source = source.replace(
      /export\s+default\s+\{/,
      'export default {\n  plugins: [crank()],'
    );
  } else if (/module\.exports\s*=\s*\{/.test(source)) {
    source = source.replace(
      /module\.exports\s*=\s*\{/,
      'module.exports = {\n  plugins: [crank()],'
    );
  } else {
    return { patched: false, reason: 'unrecognized-vite-shape', file: configPath };
  }

  fs.writeFileSync(configPath, source);
  return { patched: true, file: configPath, plugin: localPlugin };
}

function writeProjectEnvExample(projectRoot) {
  const dest = path.join(projectRoot, '.env.crank.example');
  const src = path.join(PACKAGE_ROOT, '.env.example');
  if (exists(src) && !exists(dest)) {
    fs.copyFileSync(src, dest);
  }
  // If package root has a real .env (dev machine), do NOT copy secrets into target repos.
}

/**
 * Retune-style skill sync — update ~/.cursor and ~/.claude skills when bundled skill changes.
 * Also writes project skill when .cursor/skills exists or on setup.
 */
function syncCrankSkill(projectRoot, options = {}) {
  const skillSrc = path.join(PACKAGE_ROOT, 'skill', 'SKILL.md');
  if (!exists(skillSrc)) {
    return { synced: [], error: 'skill/SKILL.md missing from crank package' };
  }
  const src = fs.readFileSync(skillSrc, 'utf8');
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const targets = [];
  const forceProject = options.forceProject === true;

  if (home && exists(path.join(home, '.cursor'))) {
    targets.push(
      path.join(home, '.cursor', 'skills', 'crank-apply-changes', 'SKILL.md')
    );
  }
  if (home && exists(path.join(home, '.claude'))) {
    targets.push(
      path.join(home, '.claude', 'skills', 'crank-apply-changes', 'SKILL.md')
    );
  }
  if (projectRoot && (forceProject || exists(path.join(projectRoot, '.cursor', 'skills')))) {
    targets.push(
      path.join(projectRoot, '.cursor', 'skills', 'crank-apply-changes', 'SKILL.md')
    );
  }

  const synced = [];
  for (const dest of targets) {
    try {
      if (exists(dest) && fs.readFileSync(dest, 'utf8') === src) {
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, src);
      synced.push(dest);
    } catch (err) {
      return { synced, error: `${dest}: ${err.message}` };
    }
  }
  return { synced };
}

function installCrankSkill(projectRoot, results) {
  const out = syncCrankSkill(projectRoot, { forceProject: true });
  if (out.error) {
    results.skillError = out.error;
  }
  for (const dest of out.synced || []) {
    results.wrote.push(dest);
  }
}

/**
 * Retune-style MCP bootstrap: global ~/.cursor + ~/.claude only (no project MCP by default).
 * Set CRANK_PROJECT_MCP=true to also merge .cursor/mcp.json in the repo.
 */
function configureMcpRetuneStyle(env, projectRoot, results, options = {}) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  let configured = false;

  if (home && exists(path.join(home, '.cursor'))) {
    mergeUserCursorMcp(projectRoot, results);
    configured = true;
  }

  const claudePath =
    env.claudeConfig ||
    (home ? path.join(home, '.claude', 'claude_desktop_config.json') : '');
  if (
    options.claude !== false &&
    claudePath &&
    exists(path.dirname(claudePath))
  ) {
    try {
      mergeMcpServers(claudePath, 'crank', projectRoot);
      results.wrote.push(claudePath);
      configured = true;
    } catch (err) {
      results.claudeError = err.message;
    }
  }

  const projectMcp =
    options.projectMcp === true || process.env.CRANK_PROJECT_MCP === 'true';
  if (projectMcp && !env.isReplit) {
    const cursorMcp = path.join(projectRoot, '.cursor', 'mcp.json');
    mergeMcpServers(cursorMcp, 'crank', projectRoot);
    results.wrote.push('.cursor/mcp.json');
    const vsMcp = path.join(projectRoot, '.vscode', 'mcp.json');
    mergeVsCodeMcp(vsMcp, projectRoot);
    results.wrote.push('.vscode/mcp.json');
    configured = true;
  }

  if (!configured) {
    results.mcpNote =
      'No ~/.cursor or ~/.claude found — install Cursor or Claude Code, then re-run setup.';
  }
}

function mergeUserCursorMcp(projectRoot, results) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return;
  const userMcp = path.join(home, '.cursor', 'mcp.json');
  try {
    if (!exists(path.dirname(userMcp))) {
      fs.mkdirSync(path.dirname(userMcp), { recursive: true });
    }
    mergeMcpServers(userMcp, 'crank', projectRoot);
    results.wrote.push(userMcp);
  } catch (err) {
    results.userMcpError = err.message;
  }
}

/**
 * Retune-style: add crank to devDependencies so `npx crank` works with no path.
 */
function ensureCrankDependency(projectRoot, results) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!exists(pkgPath)) {
    return;
  }
  if (path.resolve(projectRoot) === path.resolve(PACKAGE_ROOT)) {
    return;
  }

  const pkg = readJson(pkgPath, {});
  const crankPkg = readJson(path.join(PACKAGE_ROOT, 'package.json'), {});
  pkg.devDependencies = pkg.devDependencies || {};

  let spec;
  if (process.env.CRANK_NPM_SPEC) {
    spec = process.env.CRANK_NPM_SPEC;
  } else {
    spec = `@ahmednawaz/crank@^${crankPkg.version || '0.1.0'}`;
  }

  if (pkg.devDependencies.crank === spec) {
    return;
  }
  pkg.devDependencies.crank = spec;
  writeJson(pkgPath, pkg);
  results.wrote.push('package.json#devDependencies.crank');
  results.crankDependencyAdded = spec;
}

function writeConfig(projectRoot, env) {
  const dir = path.join(projectRoot, '.crank');
  const configPath = path.join(dir, 'config.json');
  fs.mkdirSync(dir, { recursive: true });
  if (exists(configPath)) {
    const existing = readJson(configPath, {}) || {};
    existing.projectRoot = projectRoot;
    existing.packageRoot = PACKAGE_ROOT;
    writeJson(configPath, existing);
    return existing;
  }
  const config = {
    version: 1,
    packageRoot: PACKAGE_ROOT,
    projectRoot,
    createdAt: new Date().toISOString(),
    environment: {
      isReplit: env.isReplit,
      hasVite: env.hasVite
    }
  };
  writeJson(configPath, config);
  return config;
}

/**
 * One-shot init into the target repo. Idempotent.
 */
function initProject(projectRoot, options = {}) {
  const env = detectEnvironment(projectRoot);
  const results = {
    projectRoot,
    environment: env,
    wrote: []
  };

  ensureGitignore(projectRoot);
  results.wrote.push('.gitignore');

  writeConfig(projectRoot, env);
  results.wrote.push('.crank/config.json');

  copyAgentsDoc(projectRoot, results);

  writeProjectEnvExample(projectRoot);
  if (exists(path.join(projectRoot, '.env.crank.example'))) {
    results.wrote.push('.env.crank.example');
  }

  // MCP + skill (Retune-style: global IDE config, automatic skill sync)
  if (options.mcp !== false) {
    if (!env.isReplit) {
      ensureCrankDependency(projectRoot, results);
    }
    configureMcpRetuneStyle(env, projectRoot, results, options);
  }

  if (options.skill !== false) {
    installCrankSkill(projectRoot, results);
  }

  if (env.hasVite && options.vite !== false) {
    const viteResult = patchViteConfig(projectRoot);
    results.vite = viteResult;
    if (viteResult.patched) {
      results.wrote.push(path.relative(projectRoot, viteResult.file));
    }
  }

  // package.json script convenience
  if (env.hasPackageJson && options.scripts !== false) {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = readJson(pkgPath, {});
    pkg.scripts = pkg.scripts || {};
    if (!pkg.scripts.crank) {
      pkg.scripts.crank = 'crank';
      writeJson(pkgPath, pkg);
      results.wrote.push('package.json#scripts.crank');
    }
  }

  if (env.isReplit) {
    writeReplitPlatformGuide(projectRoot, results);
  }

  if (results.crankDependencyAdded && options.install !== false && !env.isReplit) {
    try {
      const { execSync } = require('child_process');
      execSync('npm install', { cwd: projectRoot, stdio: 'inherit' });
      results.installed = true;
    } catch (err) {
      results.installError = err.message;
    }
  }

  return results;
}

/**
 * Replit blocks agents from editing `.replit` directly — use Workflows + Networking UI instead.
 * Writes a guide only; does not touch `.replit` (Retune-style: user/platform configures run + ports).
 */
function writeReplitPlatformGuide(projectRoot, results) {
  const companionPort = Number(process.env.CRANK_PORT || 3344);
  const mcpPort = Number(process.env.CRANK_MCP_HTTP_PORT || 3345);
  const runCommand = 'npx @ahmednawaz/crank start';
  const guide = path.join(projectRoot, '.crank', 'replit-platform.md');
  fs.mkdirSync(path.dirname(guide), { recursive: true });
  fs.writeFileSync(
    guide,
    [
      '# Replit platform setup (manual — do not edit `.replit` via agent)',
      '',
      'Crank **does not** auto-edit `.replit` (Replit Agent is blocked from that).',
      'Configure the Repl using **Workflows** and **Networking**, like Retune.',
      '',
      '## 1. Secret',
      '',
      'Tools → Secrets → `CRANK_TEAM_TOKEN` = your team passphrase (user sets this).',
      '',
      '## 2. Run command (Workflows — not `.replit`)',
      '',
      'Workflows pane (Cmd+K → Workflows) → **+ New Workflow** → task: **Execute Shell Command**:',
      '',
      '```bash',
      runCommand,
      '```',
      '',
      'Assign that workflow to the **Run** button (dropdown next to Run).',
      '',
      'Or run the same command once in **Shell** and leave it running.',
      '',
      '## 3. Ports (Networking tool — not `.replit`)',
      '',
      'When Crank starts it listens on `0.0.0.0`. Open **Networking** and ensure these are exposed:',
      '',
      `| Service | localPort | Purpose |`,
      `|---------|-----------|---------|`,
      `| Companion (panel, bookmarklet) | **${companionPort}** | Web UI + selection API |`,
      `| MCP (Replit Agent) | **${mcpPort}** | HTTP MCP at \`/mcp\` |`,
      '',
      'Replit often auto-binds ports when the process opens them. If Agent MCP URL is wrong,',
      'manually expose both ports in Networking.',
      '',
      'Equivalent `.replit` snippet (for humans editing config only — **not** via agent):',
      '',
      '```toml',
      `run = "${runCommand}"`,
      '',
      '[[ports]]',
      `localPort = ${companionPort}`,
      'externalPort = 80',
      '',
      '[[ports]]',
      `localPort = ${mcpPort}`,
      'externalPort = 80',
      '```',
      '',
      '## 4. Agent MCP',
      '',
      'After Crank is running: `npx @ahmednawaz/crank doctor` → copy `runtime.mcp.endpoint`',
      '→ Agent → Integrations → MCP Servers.',
      ''
    ].join('\n')
  );
  results.wrote.push('.crank/replit-platform.md');
  results.replitRun = runCommand;
  results.replitNote =
    'Configure Run via Workflows and ports via Networking — see .crank/replit-platform.md';
}

function patchReplitConfig(projectRoot, results) {
  // Deprecated: Replit Agent cannot edit `.replit`. Kept for explicit opt-in only.
  if (process.env.CRANK_PATCH_REPLIT !== 'true') {
    return;
  }
  const replitFile = path.join(projectRoot, '.replit');
  const companionPort = Number(process.env.CRANK_PORT || 3344);
  const mcpPort = Number(process.env.CRANK_MCP_HTTP_PORT || 3345);
  let source = exists(replitFile) ? fs.readFileSync(replitFile, 'utf8') : '';

  if (!/localPort\s*=\s*3344/.test(source)) {
    source += `\n[[ports]]\nlocalPort = ${companionPort}\nexternalPort = 80\n`;
  }
  if (!/localPort\s*=\s*3345/.test(source)) {
    source += `\n[[ports]]\nlocalPort = ${mcpPort}\nexternalPort = 80\n`;
  }

  if (!/^run\s*=/m.test(source)) {
    source = `run = "npx @ahmednawaz/crank"\n\n${source}`;
    results.replitRun = 'npx @ahmednawaz/crank';
  }

  fs.writeFileSync(replitFile, source.trimEnd() + '\n');
  results.wrote.push('.replit');
}

function copyAgentsDoc(projectRoot, results) {
  const copies = [
    { name: 'AGENTS.md', dests: [path.join(projectRoot, 'AGENTS.md')] },
    { name: 'REPLIT.md', dests: [path.join(projectRoot, 'REPLIT.md')] }
  ];
  for (const { name, dests } of copies) {
    const src = path.join(PACKAGE_ROOT, name);
    if (!exists(src)) {
      continue;
    }
    const content = fs.readFileSync(src, 'utf8');
    for (const dest of dests) {
      const crankDir = path.join(projectRoot, '.crank', name);
      fs.mkdirSync(path.dirname(crankDir), { recursive: true });
      fs.writeFileSync(crankDir, content);
      results.wrote.push(`.crank/${name}`);
      if (!exists(dest) || fs.readFileSync(dest, 'utf8') !== content) {
        fs.writeFileSync(dest, content);
        results.wrote.push(name);
      }
    }
  }
}

function printSetupNextSteps(env, runtime, results) {
  console.log('');
  console.log('  Setup complete (Retune-style):');
  if (results?.wrote?.some((w) => String(w).includes('.cursor/mcp.json') || String(w).includes('claude'))) {
    console.log('    • MCP configured in ~/.cursor and/or ~/.claude — reload MCP in your IDE');
  }
  if (results?.wrote?.some((w) => String(w).includes('skills'))) {
    console.log('    • Skill crank-apply-changes installed (auto-syncs on start)');
  }
  if (env.isReplit) {
    console.log('    • Workflow command: npx @ahmednawaz/crank start');
    console.log('    • Add CRANK_TEAM_TOKEN in Secrets (not in the command)');
    if (runtime?.mcp?.endpoint) {
      console.log('    • Register Agent MCP URL:');
      console.log(`      ${runtime.mcp.endpoint}`);
    } else {
      console.log('    • After start, register runtime.mcp.endpoint from: npx @ahmednawaz/crank doctor');
    }
    console.log('    • See REPLIT.md and .crank/replit-platform.md');
  } else {
    console.log('    • Run: npx @ahmednawaz/crank  (or npm run crank)');
    console.log('    • Agent paste: Apply the pending Crank change');
  }
  console.log('');
}

function writeReplitGuide(projectRoot, detectEnv, results, runtime) {
  const urls = runtime ? null : resolveUrls(detectEnv);
  const mcpEndpoint =
    runtime?.mcp?.endpoint || urls?.mcpEndpoint || 'https://3345-<repl-host>/mcp';
  const companionUrl =
    runtime?.companion?.publicUrl || urls?.companionPublic || 'https://3344-<repl-host>';
  const hint = path.join(projectRoot, '.crank', 'replit.md');
  const apiKeyLine = process.env.CRANK_MCP_API_KEY
    ? '3. Header: `X-API-Key` = your `CRANK_MCP_API_KEY` secret.'
    : '3. Optional: set `CRANK_MCP_API_KEY` in Secrets and pass `X-API-Key` in MCP headers.';
  fs.writeFileSync(
    hint,
    [
      '# Crank on Replit',
      '',
      '## Run (no secrets in the command)',
      '',
      '1. **Secrets:** add `CRANK_TEAM_TOKEN` (team passphrase — user sets this in Tools → Secrets).',
      '2. **Shell or Run:**',
      '',
      '```bash',
      'npx @ahmednawaz/crank start',
      '```',
      '',
      'See **AGENTS.md** (repo root) if Replit Agent refuses to run npx — it explains what Crank is and approved commands.',
      '',
      '## Replit Agent MCP',
      '',
      'Integrations → MCP Servers → Add custom server:',
      `- URL: \`${mcpEndpoint}\``,
      apiKeyLine,
      '',
      '## Panel in preview',
      '',
      `- Companion: ${companionUrl}`,
      '- Vite apps: panel auto-loads in the webview.',
      '- Other stacks: open the companion URL and use the bookmarklet on your preview tab.',
      ''
    ].join('\n')
  );
  results.wrote.push('.crank/replit.md');
}

module.exports = {
  initProject,
  PACKAGE_ROOT,
  mcpServerEntry,
  installCrankSkill,
  syncCrankSkill,
  configureMcpRetuneStyle,
  printSetupNextSteps,
  writeReplitGuide,
  patchReplitConfig
};
