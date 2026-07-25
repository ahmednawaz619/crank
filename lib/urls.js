'use strict';

const fs = require('fs');
const path = require('path');
const { readJson } = require('./detect');
const { env } = require('./env');

function companionPort() {
  return Number(env('PORT', '3344')) || 3344;
}

function mcpHttpPort() {
  return Number(env('MCP_HTTP_PORT', '3345')) || 3345;
}

/**
 * Public HTTPS host for Replit exposed ports.
 * Pattern: https://{port}-{replSlug}.{owner}.repl.co
 */
function replitPortHost(port) {
  const explicit = env('PUBLIC_URL', '');
  if (explicit) {
    try {
      const u = new URL(explicit);
      return `${u.protocol}//${port}-${u.host}`;
    } catch {
      // fall through
    }
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN || '';
  if (devDomain) {
    const host = devDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (/^\d+-/.test(host)) {
      return `https://${port}-${host.replace(/^\d+-/, '')}`;
    }
    return `https://${port}-${host}`;
  }

  const slug = process.env.REPL_SLUG;
  const owner = process.env.REPL_OWNER;
  if (slug && owner) {
    return `https://${port}-${slug}.${owner}.repl.co`;
  }

  return null;
}

/**
 * Resolve listen + public URLs for companion and HTTP MCP.
 */
function resolveUrls(detectEnv = {}) {
  const port = companionPort();
  const mcpPort = mcpHttpPort();
  const isReplit = Boolean(detectEnv.isReplit);
  const publicOverride = env('PUBLIC_URL', '');

  let listenHost = env('HOST', isReplit ? '0.0.0.0' : '127.0.0.1');
  if (listenHost === 'localhost') {
    listenHost = '127.0.0.1';
  }

  let companionPublic;
  let mcpPublic;

  if (publicOverride) {
    companionPublic = publicOverride.replace(/\/$/, '');
    if (isReplit) {
      mcpPublic = replitPortHost(mcpPort) || `http://127.0.0.1:${mcpPort}`;
    } else {
      mcpPublic = `http://127.0.0.1:${mcpPort}`;
    }
  } else if (isReplit) {
    companionPublic = replitPortHost(port) || `http://127.0.0.1:${port}`;
    mcpPublic = replitPortHost(mcpPort) || `http://127.0.0.1:${mcpPort}`;
  } else {
    companionPublic = `http://127.0.0.1:${port}`;
    mcpPublic = `http://127.0.0.1:${mcpPort}`;
  }

  const companionLocal = `http://127.0.0.1:${port}`;
  const mcpLocal = `http://127.0.0.1:${mcpPort}`;

  return {
    isReplit,
    listenHost,
    companionPort: port,
    mcpHttpPort: mcpPort,
    companionPublic,
    companionLocal,
    companionWs: companionPublic.replace(/^http/i, 'ws'),
    mcpPublic,
    mcpLocal,
    mcpEndpoint: `${mcpPublic}/mcp`
  };
}

function readRuntimeManifest(projectRoot) {
  const file = path.join(projectRoot, '.crank', 'runtime.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  return readJson(file, null);
}

function writeRuntimeManifest(projectRoot, detectEnv) {
  const urls = resolveUrls(detectEnv);
  const dir = path.join(projectRoot, '.crank');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    version: 1,
    updatedAt: new Date().toISOString(),
    projectRoot: path.resolve(projectRoot),
    environment: {
      isReplit: urls.isReplit,
      hasVite: Boolean(detectEnv.hasVite)
    },
    companion: {
      listenHost: urls.listenHost,
      port: urls.companionPort,
      publicUrl: urls.companionPublic,
      localUrl: urls.companionLocal,
      wsUrl: urls.companionWs,
      devLoader: `${urls.companionPublic}/dev-loader.js`,
      bookmarklet: `${urls.companionPublic}/bookmarklet.js`
    },
    mcp: {
      mode:
        urls.isReplit || String(process.env.CRANK_MCP_MODE || '').toLowerCase() === 'http'
          ? 'http'
          : 'stdio',
      httpPort: urls.mcpHttpPort,
      publicUrl: urls.mcpPublic,
      localUrl: urls.mcpLocal,
      endpoint: urls.mcpEndpoint
    }
  };
  const file = path.join(dir, 'runtime.json');
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function applyUrlEnv(urls) {
  process.env.CRANK_HOST = urls.listenHost;
  process.env.CRANK_PORT = String(urls.companionPort);
  process.env.HOST = urls.listenHost;
  process.env.PORT = String(urls.companionPort);
  process.env.CRANK_COMPANION_URL = urls.companionLocal;
  process.env.CRANK_PUBLIC_URL = urls.companionPublic;
  process.env.CRANK_MCP_HTTP_PORT = String(urls.mcpHttpPort);
  if (urls.isReplit) {
    process.env.CRANK_MCP_MODE = 'http';
  }
}

module.exports = {
  companionPort,
  mcpHttpPort,
  resolveUrls,
  readRuntimeManifest,
  writeRuntimeManifest,
  applyUrlEnv,
  replitPortHost
};
