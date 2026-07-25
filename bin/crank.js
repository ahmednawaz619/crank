#!/usr/bin/env node
'use strict';

/**
 * Crank — one command for any repo / IDE.
 *
 *   cd your-app
 *   npx crank
 *
 * Auto: init → companion → MCP (stdio local / HTTP Replit) → npm run dev when present.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const {
  initProject,
  PACKAGE_ROOT,
  writeReplitGuide
} = require('../lib/init');
const { detectEnvironment } = require('../lib/detect');
const { env } = require('../lib/env');
const { loadTeamEnvFile } = require('../lib/load-team-env');
const {
  resolveUrls,
  writeRuntimeManifest,
  applyUrlEnv,
  readRuntimeManifest
} = require('../lib/urls');
const { resolveProjectRoot, describeEnvironment } = require('../lib/resolve-project');

const LOG_FILE = env('LOG', '/tmp/crank-companion.log');
const PID_FILE = env('PID_FILE', '/tmp/crank-companion.pid');

function printHelp() {
  process.stdout.write(`Usage: crank [command] [project-root]

Commands:
  (default)     Init + start everything (companion, MCP, dev server when present)
  setup         Same as init — Retune-style one-time config (alias for init)
  init          Only write IDE / Vite / MCP setup into the project
  mcp           Start stdio MCP server (used by npx crank mcp in IDE configs)
  start         Start companion (assumes init already done)
  stop          Stop daemon companion + HTTP MCP listeners
  doctor        Print detected environment + runtime URLs
  status        Print whether companion /health responds

Flags:
  --daemon      Detach durable supervisor (default on local; Replit stays foreground)
  --no-daemon   Keep companion in this terminal
  --no-mcp      Skip writing MCP config files
  --no-vite     Skip Vite config patch
  --no-open     Do not open the setup page in a browser
  --no-dev      Do not auto-run npm run dev
  --dev         Force npm run dev even if not auto-detected
  --no-claude   Skip Claude Desktop MCP merge
  --http-mcp    Force HTTP MCP (Replit auto-enables this)
  -h, --help    Show help

Examples:
  cd ~/code/my-app && npx crank setup && npx crank
  npx crank
  npx crank mcp
  npx crank stop
`);
}

function parseArgs(argv) {
  const flags = {
    mcp: true,
    vite: true,
    open: true,
    dev: null,
    httpMcp: false,
    claude: true,
    help: false,
    daemon: null,
    explicit: {}
  };
  const positional = [];
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      flags.help = true;
    } else if (arg === '--no-mcp') {
      flags.mcp = false;
    } else if (arg === '--no-vite') {
      flags.vite = false;
    } else if (arg === '--no-open') {
      flags.open = false;
    } else if (arg === '--dev') {
      flags.dev = true;
      flags.explicit.dev = true;
    } else if (arg === '--no-dev') {
      flags.dev = false;
      flags.explicit.dev = true;
    } else if (arg === '--no-claude') {
      flags.claude = false;
    } else if (arg === '--http-mcp') {
      flags.httpMcp = true;
      flags.explicit.httpMcp = true;
    } else if (arg === '--daemon') {
      flags.daemon = true;
      flags.explicit.daemon = true;
    } else if (arg === '--no-daemon') {
      flags.daemon = false;
      flags.explicit.daemon = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  let command = 'run';
  let projectRoot = process.cwd();
  const cmds = new Set(['init', 'setup', 'start', 'doctor', 'stop', 'status', 'mcp']);
  if (positional[0] === 'setup') {
    command = 'init';
  } else if (cmds.has(positional[0])) {
    command = positional[0];
    if (positional[1]) {
      projectRoot = path.resolve(positional[1]);
    }
  } else if (positional[0]) {
    projectRoot = path.resolve(positional[0]);
  }

  let resolved = null;
  if (command !== 'mcp' && command !== 'stop' && command !== 'status') {
    resolved = resolveProjectRoot(projectRoot);
    projectRoot = resolved.projectRoot;
  }

  return { command, projectRoot, flags, resolved };
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) {
    return;
  }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function loadAllEnv(projectRoot) {
  loadTeamEnvFile(PACKAGE_ROOT);
  loadEnvFile(path.join(PACKAGE_ROOT, '.env'));
  loadEnvFile(path.join(projectRoot, '.env'));
  loadEnvFile(path.join(projectRoot, '.env.local'));
  if (!process.env.CRANK_PROJECT_ROOT) {
    process.env.CRANK_PROJECT_ROOT = path.resolve(projectRoot);
  }
}

function hasDevScript(detectEnv) {
  return Boolean(detectEnv.packageJson?.scripts?.dev);
}

function applySmartDefaults(flags, detectEnv) {
  if (detectEnv.isReplit) {
    flags.httpMcp = true;
    if (!flags.explicit.daemon) {
      flags.daemon = false;
    }
  } else if (!flags.explicit.daemon) {
    flags.daemon = true;
  }

  if (flags.dev == null) {
    flags.dev = hasDevScript(detectEnv);
  }

  if (flags.httpMcp || detectEnv.isReplit) {
    process.env.CRANK_MCP_MODE = 'http';
  }
}

function companionBaseUrl() {
  const publicUrl = process.env.CRANK_PUBLIC_URL;
  if (publicUrl) {
    return publicUrl.replace(/\/$/, '');
  }
  const urls = resolveUrls({
    isReplit: Boolean(
      process.env.REPL_ID ||
        process.env.REPLIT_DEV_DOMAIN ||
        process.env.REPL_SLUG
    )
  });
  return urls.companionPublic;
}

function checkHealth(timeoutMs = 1500, baseUrl) {
  const base = baseUrl || companionBaseUrl();
  return new Promise((resolve) => {
    const req = http.get(`${base}/health`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        try {
          resolve({ ok: res.statusCode === 200, status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ ok: res.statusCode === 200, status: res.statusCode, body: null });
        }
      });
    });
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

function openUrl(url) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // ignore
  }
}

function printBanner(projectRoot, detectEnv, initResult, runtime, modeLabel, resolvedInfo) {
  const setup = runtime?.companion?.publicUrl || companionBaseUrl();

  console.log('');
  console.log('┌──────────────────────────────────────────┐');
  console.log('│  Crank — one-command copy tooling      │');
  console.log('└──────────────────────────────────────────┘');
  console.log(`  Project:    ${projectRoot}`);
  if (resolvedInfo?.repoRoot && resolvedInfo.repoRoot !== projectRoot) {
    console.log(`  Repo:       ${resolvedInfo.repoRoot} (${resolvedInfo.reason})`);
  } else if (resolvedInfo?.reason) {
    console.log(`  Detected:   ${resolvedInfo.source} — ${resolvedInfo.reason}`);
  }
  console.log(`  Companion:  ${setup}`);
  if (runtime?.mcp?.mode === 'http' && runtime?.mcp?.endpoint) {
    console.log(`  MCP (HTTP): ${runtime.mcp.endpoint}`);
  }
  if (process.env.CRANK_TEAM_TOKEN) {
    console.log('  Team lock: ON (CRANK_TEAM_TOKEN set)');
  } else {
    console.log('  Team lock: OFF — set CRANK_TEAM_TOKEN in .env to require a passphrase');
  }
  if (modeLabel) {
    console.log(`  Mode:       ${modeLabel}`);
  }
  if (initResult?.wrote?.length) {
    console.log(`  Config:     ${initResult.wrote.slice(0, 5).join(', ')}`);
  }
  console.log('');

  if (detectEnv.isReplit) {
    console.log('  Replit:');
    console.log('    • Keep this process running (companion + HTTP MCP + dev).');
    console.log('    • Register MCP URL in Agent → Integrations (see .crank/replit-platform.md).');
    console.log('    • Open the webview — select copy → Get options.');
  } else if (detectEnv.hasVite && hasDevScript(detectEnv)) {
    console.log('  Ready:');
    console.log('    • Dev server starting (or already running).');
    console.log('    • Open your app — Crank panel loads automatically.');
    console.log('    • Reload MCP in Cursor / VS Code / Claude after first init.');
  } else {
    console.log('  Ready:');
    console.log(`    • Open ${setup} and drag the Crank bookmarklet.`);
    console.log('    • Click it on any page → Select → Get options.');
    console.log('    • Reload MCP in Cursor / VS Code / Claude after first init.');
  }
  console.log('');
}

function writePid(pid) {
  try {
    fs.writeFileSync(PID_FILE, String(pid) + '\n', 'utf8');
  } catch {
    // ignore
  }
}

function readPid() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function clearPid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPortListeners(port) {
  try {
    const out = require('child_process').execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8'
    });
    for (const line of out.split(/\s+/).filter(Boolean)) {
      const pid = Number(line);
      if (pid > 0 && pid !== process.pid) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // nothing listening
  }
}

function startHttpMcp(foreground) {
  process.env.CRANK_MCP_MODE = 'http';
  const mcpPath = path.join(PACKAGE_ROOT, 'mcp-server', 'index.js');
  const stdio = foreground
    ? 'inherit'
    : ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')];
  return spawn(process.execPath, [mcpPath], {
    stdio,
    env: process.env,
    cwd: PACKAGE_ROOT
  });
}

function startNpmDev(projectRoot) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawn(npm, ['run', 'dev'], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: process.env
  });
}

/**
 * Foreground or in-process supervisor: companion + optional HTTP MCP.
 */
function runCompanionSupervisor(projectRoot, { foreground, httpMcp }) {
  process.env.CRANK_PROJECT_ROOT = projectRoot;
  const serverPath = path.join(PACKAGE_ROOT, 'companion', 'server.js');
  let companionChild = null;
  let mcpChild = null;
  let shuttingDown = false;
  let restartDelayMs = 400;
  let spawnGeneration = 0;

  writePid(process.pid);

  const log = (msg) => {
    const line = `[Crank supervisor] ${msg}`;
    if (foreground) {
      console.error(line);
    } else {
      try {
        fs.appendFileSync(LOG_FILE, line + '\n');
      } catch {
        // ignore
      }
    }
  };

  function spawnMcpOnce() {
    if (!httpMcp || shuttingDown) return;
    if (mcpChild) return;
    mcpChild = startHttpMcp(foreground);
    log(`spawned http mcp pid=${mcpChild.pid}`);
    mcpChild.on('exit', (code, signal) => {
      mcpChild = null;
      if (shuttingDown) return;
      log(`http mcp exited code=${code} signal=${signal || ''} — restart in 800ms`);
      setTimeout(spawnMcpOnce, 800);
    });
  }

  function spawnCompanionOnce() {
    if (shuttingDown) return;
    const gen = ++spawnGeneration;
    const stdio = foreground
      ? 'inherit'
      : ['ignore', fs.openSync(LOG_FILE, 'a'), fs.openSync(LOG_FILE, 'a')];
    companionChild = spawn(process.execPath, [serverPath], {
      stdio,
      env: process.env,
      cwd: PACKAGE_ROOT
    });
    log(`spawned companion pid=${companionChild.pid} gen=${gen}`);

    companionChild.on('exit', async (code, signal) => {
      if (gen !== spawnGeneration) return;
      companionChild = null;
      if (shuttingDown) return;

      if (code === 0 && !signal) {
        const health = await checkHealth(800);
        if (health.ok) {
          log('port already served by healthy companion — supervisor idle');
          const watch = setInterval(async () => {
            if (shuttingDown) {
              clearInterval(watch);
              return;
            }
            const h = await checkHealth(800);
            if (!h.ok) {
              clearInterval(watch);
              log('health lost — respawning companion');
              restartDelayMs = 400;
              spawnCompanionOnce();
            }
          }, 5000);
          return;
        }
      }

      log(
        `companion exited code=${code} signal=${signal || ''} — restart in ${restartDelayMs}ms`
      );
      setTimeout(() => {
        restartDelayMs = Math.min(restartDelayMs * 2, 8000);
        spawnCompanionOnce();
      }, restartDelayMs);
    });

    companionChild.on('spawn', () => {
      restartDelayMs = 400;
    });
  }

  const shutdown = (signal) => {
    shuttingDown = true;
    log(`shutdown ${signal}`);
    for (const child of [companionChild, mcpChild]) {
      if (child) {
        try {
          child.kill(signal);
        } catch {
          // ignore
        }
      }
    }
    clearPid();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  spawnCompanionOnce();
  spawnMcpOnce();
}

function launchDetachedDaemon(projectRoot, argvFlags) {
  const args = [__filename, 'start', '--daemon', '--no-open', projectRoot];
  if (argvFlags.httpMcp) {
    args.push('--http-mcp');
  }
  const outFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: {
      ...process.env,
      CRANK_SUPERVISOR: '1',
      CRANK_PROJECT_ROOT: projectRoot
    },
    cwd: PACKAGE_ROOT
  });
  writePid(child.pid);
  child.unref();
  console.log(`[Crank] Daemon supervisor started (pid ${child.pid})`);
  console.log(`[Crank] Log: ${LOG_FILE}`);
  console.log(`[Crank] Stop: npx crank stop`);
  if (argvFlags.open) {
    setTimeout(() => openUrl(companionBaseUrl()), 900);
  }
}

async function stopDaemon() {
  const pid = readPid();
  if (pid && isPidAlive(pid)) {
    try {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
      console.log(`[Crank] Sent SIGTERM to supervisor pid ${pid}`);
    } catch (err) {
      console.error(`[Crank] Could not signal pid ${pid}:`, err.message);
    }
  } else if (pid) {
    console.log(`[Crank] Stale PID file (${pid}); clearing`);
  } else {
    console.log('[Crank] No PID file; stopping listeners on companion/MCP ports if any');
  }
  await new Promise((r) => setTimeout(r, 500));
  killPortListeners(process.env.CRANK_PORT || '3344');
  killPortListeners(process.env.CRANK_MCP_HTTP_PORT || '3345');
  clearPid();
  await new Promise((r) => setTimeout(r, 400));
  const health = await checkHealth(800);
  console.log(
    health.ok
      ? '[Crank] Warning: /health still responds — another process may own the port'
      : '[Crank] Companion stopped'
  );
}

function prepareRuntime(projectRoot, detectEnv) {
  const urls = resolveUrls(detectEnv);
  applyUrlEnv(urls);
  const runtime = writeRuntimeManifest(projectRoot, detectEnv);
  if (detectEnv.isReplit) {
    writeReplitGuide(projectRoot, detectEnv, { wrote: [] }, runtime);
  }
  return runtime;
}

async function main() {
  const { command, projectRoot, flags: rawFlags, resolved } = parseArgs(process.argv.slice(2));
  const flags = { ...rawFlags };
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  loadAllEnv(projectRoot);
  process.env.CRANK_PROJECT_ROOT = path.resolve(projectRoot);

  if (command === 'mcp') {
    process.env.CRANK_MCP_MODE = process.env.CRANK_MCP_MODE || 'stdio';
    const mcpPath = path.join(PACKAGE_ROOT, 'mcp-server', 'index.js');
    const child = spawn(process.execPath, [mcpPath], {
      stdio: 'inherit',
      env: process.env,
      cwd: PACKAGE_ROOT
    });
    child.on('exit', (code) => process.exit(code || 0));
    return;
  }

  if (command === 'status') {
    const health = await checkHealth(2000);
    const pid = readPid();
    console.log(
      JSON.stringify(
        {
          url: companionBaseUrl(),
          healthy: !!health.ok,
          pidFile: PID_FILE,
          supervisorPid: pid,
          supervisorAlive: pid ? isPidAlive(pid) : false,
          health: health.body || null
        },
        null,
        2
      )
    );
    process.exit(health.ok ? 0 : 1);
  }

  if (command === 'stop') {
    await stopDaemon();
    return;
  }

  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    console.error(`Project root not found: ${projectRoot}`);
    process.exit(1);
  }

  const detectEnv = detectEnvironment(projectRoot);
  applySmartDefaults(flags, detectEnv);

  if (command === 'doctor') {
    const runtime = prepareRuntime(projectRoot, detectEnv);
    console.log(
      JSON.stringify(
        {
          projectRoot,
          resolved,
          packageRoot: PACKAGE_ROOT,
          environment: detectEnv,
          runtime,
          flags,
          commands: {
            setup: 'npx crank setup',
            start: 'npx crank',
            mcp: 'npx crank mcp',
            agentPaste: 'Apply the pending Crank change'
          }
        },
        null,
        2
      )
    );
    return;
  }

  let initResult = null;
  const crankConfig = path.join(projectRoot, '.crank', 'config.json');
  const shouldInit =
    command === 'init' ||
    (command === 'run' && !fs.existsSync(crankConfig) && !detectEnv.isReplit);
  if (shouldInit) {
    initResult = initProject(projectRoot, {
      mcp: flags.mcp,
      vite: flags.vite,
      claude: flags.claude,
      scripts: true
    });
    if (command === 'init') {
      const runtime = prepareRuntime(projectRoot, detectEnv);
      printBanner(projectRoot, detectEnv, initResult, runtime, 'init only', resolved);
      console.log('Init complete. Run `npx crank` to start everything.');
      return;
    }
  }

  const runtime = prepareRuntime(projectRoot, detectEnv);
  const httpMcp = flags.httpMcp || detectEnv.isReplit;

  if (process.env.CRANK_SUPERVISOR === '1' && flags.daemon) {
    process.env.CRANK_PROJECT_ROOT = projectRoot;
    runCompanionSupervisor(projectRoot, { foreground: false, httpMcp });
    return;
  }

  if (flags.daemon && !flags.dev) {
    const existing = await checkHealth(800);
    if (existing.ok) {
      printBanner(projectRoot, detectEnv, initResult, runtime, 'daemon (already running)', resolved);
      console.log('[Crank] Companion already healthy — leaving it running.');
      console.log(`[Crank] ${companionBaseUrl()}/health`);
      return;
    }
    printBanner(projectRoot, detectEnv, initResult, runtime, 'daemon', resolved);
    launchDetachedDaemon(projectRoot, flags);
    await new Promise((r) => setTimeout(r, 1200));
    const health = await checkHealth(2000);
    console.log(health.ok ? '[Crank] Health OK' : `[Crank] Health not ready — check ${LOG_FILE}`);
    return;
  }

  if (flags.daemon && flags.dev) {
    const existing = await checkHealth(800);
    if (!existing.ok) {
      printBanner(projectRoot, detectEnv, initResult, runtime, 'daemon + dev', resolved);
      launchDetachedDaemon(projectRoot, { ...flags, httpMcp });
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      printBanner(projectRoot, detectEnv, initResult, runtime, 'dev (companion already up)', resolved);
    }
    if (flags.open) {
      openUrl(companionBaseUrl());
    }
    const devChild = startNpmDev(projectRoot);
    devChild.on('exit', (code) => process.exit(code || 0));
    return;
  }

  printBanner(
    projectRoot,
    detectEnv,
    initResult,
    runtime,
    detectEnv.isReplit ? 'Replit foreground' : 'foreground',
    resolved
  );

  if (flags.open) {
    setTimeout(() => openUrl(runtime.companion.publicUrl), 800);
  }

  let devChild = null;
  if (flags.dev) {
    devChild = startNpmDev(projectRoot);
  }

  const shutdownDev = (signal) => {
    if (devChild) {
      try {
        devChild.kill(signal);
      } catch {
        // ignore
      }
    }
  };
  process.on('SIGINT', () => shutdownDev('SIGINT'));
  process.on('SIGTERM', () => shutdownDev('SIGTERM'));

  runCompanionSupervisor(projectRoot, { foreground: true, httpMcp });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
