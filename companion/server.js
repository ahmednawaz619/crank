'use strict';

/**
 * Crank companion — local bridge between:
 *   - browser bookmarklet / panel (WebSocket + HTTP)
 *   - Glean agent client (stubbed)
 *   - MCP server (HTTP API used by @crank/mcp-server)
 *
 * Pattern adapted from a companion Express + ws bridge on a fixed port,
 * stripped of CSS/source-map machinery and focused on copy selection + variants.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const store = require('./selection-store');
const { proposeCopyVariants } = require('./glean-client');
const { crankAsset } = require('./asset-bridge');
const { saveTextChange, writeTextChangeAvailable } = require('./text-dispatch');
const { persistAppliedVariant } = require('./persist-apply');
const agentQueue = require('./agent-queue');
const agentRunner = require('./agent-runner');
const { env } = require('../lib/env');
const { loadTeamEnvFile } = require('../lib/load-team-env');
const { describeEnvironment } = require('../lib/resolve-project');
const { readRuntimeManifest } = require('../lib/urls');

function loadEnvFile() {
  const candidates = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(process.cwd(), '.env')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
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
    break;
  }
}

// Load .env before resolving PROJECT_ROOT so CRANK_PROJECT_ROOT applies.
loadTeamEnvFile(path.resolve(__dirname, '..'));
loadEnvFile();

const PORT = Number(env('PORT', '3344'));
const HOST = env('HOST', '127.0.0.1');
const PROJECT_ROOT = env('PROJECT_ROOT')
  ? path.resolve(env('PROJECT_ROOT'))
  : path.resolve(__dirname, '..');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

const {
  teamAuthMiddleware,
  getAuthStatus,
  extractTeamToken,
  isTeamTokenValid,
  teamAuthRequired
} = require('../lib/team-auth');

app.get('/api/auth/status', (_req, res) => {
  res.json({ ok: true, ...getAuthStatus() });
});

app.post('/api/auth/verify', (req, res) => {
  const token = req.body?.token || extractTeamToken(req);
  if (!teamAuthRequired()) {
    res.json({ ok: true, authenticated: true, teamAuthRequired: false });
    return;
  }
  if (isTeamTokenValid(token)) {
    res.json({ ok: true, authenticated: true, teamAuthRequired: true });
    return;
  }
  res.status(401).json({
    ok: false,
    code: 'TEAM_TOKEN_INVALID',
    error: 'Invalid Crank team token'
  });
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  if (req.path === '/api/auth/status' && req.method === 'GET') {
    next();
    return;
  }
  if (req.path === '/api/auth/verify' && req.method === 'POST') {
    next();
    return;
  }
  teamAuthMiddleware(req, res, next);
});

/** @type {Set<import('ws').WebSocket>} */
const browserClients = new Set();

function broadcast(message) {
  let raw;
  try {
    raw = JSON.stringify(message);
  } catch (err) {
    console.error('[Crank] broadcast stringify failed:', err.message);
    return;
  }
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(raw);
      } catch (err) {
        console.error('[Crank] broadcast send failed:', err.message);
      }
    }
  }
}

function mcpConfigPresent() {
  const candidates = [
    path.join(PROJECT_ROOT, '.cursor', 'mcp.json'),
    path.join(PROJECT_ROOT, '.vscode', 'mcp.json')
  ];
  return candidates.some((file) => fs.existsSync(file));
}

function publicCompanionUrl(req) {
  const override = process.env.CRANK_PUBLIC_URL || env('PUBLIC_URL', '');
  if (override) {
    return override.replace(/\/$/, '');
  }
  if (req) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host && !/^127\.0\.0\.1:/.test(host) && !/^localhost:/.test(host)) {
      return `${proto}://${host}`;
    }
  }
  const host = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  return `http://${host}:${PORT}`;
}

app.get('/api/runtime', (req, res) => {
  const runtimeFile = path.join(PROJECT_ROOT, '.crank', 'runtime.json');
  if (fs.existsSync(runtimeFile)) {
    try {
      res.json(JSON.parse(fs.readFileSync(runtimeFile, 'utf8')));
      return;
    } catch {
      // fall through
    }
  }
  res.json({
    companion: {
      publicUrl: publicCompanionUrl(req),
      devLoader: `${publicCompanionUrl(req)}/dev-loader.js`,
      bookmarklet: `${publicCompanionUrl(req)}/bookmarklet.js`
    }
  });
});

app.get('/health', (_req, res) => {
  const pending = agentQueue.getPendingAgentTask();
  const status = agentQueue.getAgentQueueStatus();
  res.json({
    ok: true,
    service: 'crank-companion',
    port: PORT,
    host: HOST,
    publicUrl: publicCompanionUrl(_req),
    projectRoot: PROJECT_ROOT,
    ...getAuthStatus(),
    activeSessionId: store.getActiveSession()?.id || null,
    gleanStub: String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false',
    textWriter: writeTextChangeAvailable(),
    mcpConfig: mcpConfigPresent(),
    apiKeyConfigured: status.apiKeyConfigured,
    pendingAgentTask: pending
      ? {
          id: pending.id,
          variantId: pending.variantId,
          createdAt: pending.createdAt,
          changeCount: Array.isArray(pending.changes) ? pending.changes.length : 0,
          status: pending.status
        }
      : null,
    latestAgentRun: agentRunner.getLatestAgentRun()
  });
});

app.get('/bookmarklet.js', (_req, res) => {
  const file = path.resolve(__dirname, '..', 'bookmarklet', 'crank-bookmarklet.js');
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('application/javascript');
  res.sendFile(file);
});

app.get('/dev-loader.js', (_req, res) => {
  const file = path.resolve(__dirname, 'dev-loader.js');
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('application/javascript');
  res.sendFile(file);
});

app.get('/ui/crank-ui.css', (_req, res) => {
  const file =
    crankAsset('bookmarklet', 'crank-ui.css') ||
    path.resolve(__dirname, '..', 'bookmarklet', 'crank-ui.css');
  if (!fs.existsSync(file)) {
    res.status(404).type('text/plain').send('crank-ui.css not found in package');
    return;
  }
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('text/css');
  res.sendFile(file);
});

// Back-compat alias for older bookmarklets still requesting the old path.
app.get('/ui/vizpatch-ui.css', (_req, res) => {
  res.redirect(301, '/ui/crank-ui.css');
});

app.get('/ui/text-source.js', (_req, res) => {
  const file = path.resolve(__dirname, '..', 'bookmarklet', 'text-source.js');
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('application/javascript');
  res.sendFile(file);
});

app.get('/ui/crank-ui-helpers.js', (_req, res) => {
  const file = path.resolve(__dirname, '..', 'bookmarklet', 'crank-ui-helpers.js');
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0'
  });
  res.type('application/javascript');
  res.sendFile(file);
});

app.post('/api/save-text', (req, res) => {
  const result = saveTextChange(req.body || {}, PROJECT_ROOT);
  if (!result.success) {
    res.status(400).json({ ok: false, ...result });
    return;
  }
  broadcast({
    type: 'TEXT_SAVED',
    payload: result
  });
  res.json({ ok: true, ...result });
});

app.post('/api/preview-text', (req, res) => {
  const sessionId = req.body?.sessionId;
  const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
  broadcast({
    type: 'PREVIEW_TEXT',
    sessionId,
    nodes,
    preview: true
  });
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  const publicUrl = publicCompanionUrl(req);
  const bookmarkUrl = `${publicUrl}/bookmarklet.js`;
  const mcpPath = path.resolve(__dirname, '..', 'mcp-server', 'index.js');
  const runtimeFile = path.join(PROJECT_ROOT, '.crank', 'runtime.json');
  let mcpEndpoint = '';
  if (fs.existsSync(runtimeFile)) {
    try {
      mcpEndpoint = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'))?.mcp?.endpoint || '';
    } catch {
      mcpEndpoint = '';
    }
  }
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Crank companion</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; line-height: 1.5; }
    code { background: #f3f3f3; padding: 0.1em 0.35em; border-radius: 4px; }
    a.bookmarklet { display: inline-block; margin-top: 1rem; padding: 0.55rem 0.9rem; background: #0f766e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .muted { color: #555; font-size: 0.95rem; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 1rem 1.1rem; margin: 1.25rem 0; background: #fafafa; }
    h2 { font-size: 1rem; margin: 0 0 0.4rem; }
    pre { background: #f3f3f3; padding: 0.75rem 0.9rem; border-radius: 8px; overflow: auto; font-size: 0.82rem; }
    ol { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>Crank</h1>
  <p class="muted">One-command copy iteration — select a <code>div</code>, send text to Glean, apply via MCP.</p>
  <p>Companion is running at <code>${publicUrl}</code>.</p>
  <p>Project root: <code>${PROJECT_ROOT}</code></p>
  ${mcpEndpoint ? `<p>Replit MCP endpoint: <code>${mcpEndpoint}</code></p>` : ''}

  <div class="card">
    <h2>One command</h2>
    <p class="muted" style="margin:0">From your app repo run <code>npx crank</code>. Vite apps auto-load the panel on <code>npm run dev</code>.</p>
  </div>

  <p>Fallback — drag this to your bookmarks bar (works on any page, any environment):</p>
  <a class="bookmarklet" href="javascript:(function(){var s=document.createElement('script');s.src='${bookmarkUrl}?v='+Date.now();document.documentElement.appendChild(s);})();">Crank</a>

  <div class="card">
    <h2>Continue in your current Cursor chat</h2>
    <p class="muted">Panel <strong>Agent</strong> queues structured old→new copy changes on this companion and copies <code>Apply the pending Crank change</code> to the clipboard. Paste that in your <strong>current</strong> Cursor chat — the <code>crank-apply-changes</code> skill pulls via MCP. Cursor has no public API to inject into an open Composer; the optional deeplink opens a <em>new</em> chat.</p>
    <p class="muted">Optional fully automatic background run: set <code>CURSOR_API_KEY</code> in <code>.env</code>, then use <strong>Run fully automatic</strong> in the panel (SDK/CLI — separate agent, not your open chat).</p>
    <ol>
      <li class="muted">Run <code>npx crank</code> / init so <code>.cursor/mcp.json</code> and the skill are installed.</li>
      <li class="muted">Reload your MCP servers or restart Cursor after updating the config.</li>
      <li class="muted">In the panel click <strong>Agent</strong>, then paste <code>Apply the pending Crank change</code> in your current Cursor chat (already copied). Skill/tools pull pending changes.</li>
    </ol>
    <pre>{
  "mcpServers": {
    "crank": {
      "command": "node",
      "args": ["${mcpPath}"],
      "env": {
        "CRANK_COMPANION_URL": "${publicUrl}",
        "CRANK_MCP_MODE": "stdio"
      }
    }
  }
}</pre>
  </div>

  <p class="muted">Health: <a href="/health">/health</a> · Active selection: <a href="/api/selection">/api/selection</a> · Loader: <a href="/dev-loader.js">/dev-loader.js</a></p>
</body>
</html>`);
});

/** Browser / bookmarklet: push a new selection */
app.post('/api/selection', (req, res) => {
  try {
    const session = store.setSelection(req.body || {});
    broadcast({ type: 'SELECTION_UPDATED', session });
    res.status(201).json({ ok: true, session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/selection', (req, res) => {
  const session = store.getSession(req.query.sessionId);
  if (!session) {
    res.status(404).json({ ok: false, error: 'No active selection' });
    return;
  }
  res.json({ ok: true, session });
});

app.get('/api/sessions', (_req, res) => {
  res.json({ ok: true, sessions: store.listSessions() });
});

/** Latest Glean progress for a session (HTTP poll while /api/variants blocks). */
app.get('/api/glean-progress', (req, res) => {
  const sessionId = req.query?.sessionId;
  const session = store.getSession(sessionId);
  if (!session) {
    res.status(404).json({ ok: false, error: 'No active selection' });
    return;
  }
  res.json({
    ok: true,
    sessionId: session.id,
    progress: store.getGleanProgress(session.id),
    updatedAt: session.gleanProgressAt || null
  });
});

/** @type {Set<string>} session ids with an in-flight Glean propose */
const variantsInFlight = new Set();

/** Ask Glean for 3–4 copy variants (waits; also broadcasts progress on WS) */
app.post('/api/variants', async (req, res) => {
  // Glean wait often takes 60–120s — disable socket timeouts for this route.
  try {
    req.setTimeout?.(0);
    res.setTimeout?.(0);
    if (req.socket) req.socket.setTimeout(0);
  } catch {
    // ignore
  }

  let lockId = null;
  try {
    const sessionId = req.body?.sessionId;
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    if (variantsInFlight.has(session.id)) {
      res.status(409).json({
        ok: false,
        error: 'Glean variants already in progress for this selection'
      });
      return;
    }
    lockId = session.id;
    variantsInFlight.add(lockId);
    console.log(`[Crank] Glean variants requested for session ${session.id}`);
    const variants = await proposeCopyVariants(
      session,
      {
        ...(req.body?.options || {}),
        optionCount: req.body?.optionCount ?? req.body?.options?.optionCount
      },
      (progress) => {
        store.setGleanProgress(session.id, progress);
        broadcast({
          type: 'GLEAN_PROGRESS',
          sessionId: session.id,
          progress
        });
      }
    );
    const updated = store.setVariants(session.id, variants);
    console.log(
      `[Crank] Glean returned ${variants.length} variant(s) for ${session.id}`
    );
    // Respond before WS broadcast so a socket error cannot drop the HTTP body.
    res.json({ ok: true, session: updated, variants });
    try {
      broadcast({ type: 'VARIANTS_READY', session: updated });
    } catch (broadcastErr) {
      console.error('[Crank] VARIANTS_READY broadcast failed:', broadcastErr.message);
    }
  } catch (err) {
    console.error('[Crank] Glean propose failed:', err.message);
    broadcast({
      type: 'GLEAN_ERROR',
      error: err.message
    });
    if (!res.headersSent) {
      res.status(502).json({ ok: false, error: err.message });
    }
  } finally {
    if (lockId) variantsInFlight.delete(lockId);
  }
});

/** Apply a chosen variant (MCP or panel). DOM broadcast + optional source persist. */
app.post('/api/apply', (req, res) => {
  try {
    const { sessionId, variantId } = req.body || {};
    const persist = req.body?.persist !== false && req.body?.preview !== true;
    const sessionBefore = store.getSession(sessionId);
    if (!sessionBefore) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    const preApplyNodes = (sessionBefore.nodes || []).map((n) => ({ ...n }));
    const { session, variant } = store.applyVariant(sessionId, variantId);

    let persistResult = null;
    if (persist) {
      persistResult = persistAppliedVariant(session, variant, PROJECT_ROOT, {
        preApplyNodes
      });
      if (persistResult.persisted) {
        broadcast({ type: 'TEXT_SAVED', payload: persistResult });
      }
    }

    broadcast({
      type: 'APPLY_VARIANT',
      sessionId: session.id,
      variantId: variant.id,
      nodes: variant.nodes,
      session,
      persist: !!persist,
      persistResult
    });
    res.json({
      ok: true,
      session,
      variant,
      persist: !!persist,
      persistResult
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Preview-only apply — DOM only, never writes source. */
app.post('/api/preview-variant', (req, res) => {
  try {
    const { sessionId, variantId } = req.body || {};
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    const variant = (session.variants || []).find((v) => v.id === variantId);
    if (!variant) {
      res.status(404).json({ ok: false, error: `Unknown variant: ${variantId}` });
      return;
    }
    broadcast({
      type: 'APPLY_VARIANT',
      sessionId: session.id,
      variantId: variant.id,
      nodes: variant.nodes,
      session,
      persist: false,
      preview: true
    });
    res.json({ ok: true, session, variant, persist: false });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Queue structured pending copy changes (Retune-parity; does not save). */
app.post('/api/agent-prompt', (req, res) => {
  try {
    const { sessionId, variantId, source } = req.body || {};
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    const variant = (session.variants || []).find((v) => v.id === variantId);
    if (!variant) {
      res.status(404).json({ ok: false, error: `Unknown variant: ${variantId}` });
      return;
    }
    const task = agentQueue.enqueueAgentTask({
      session,
      variant,
      source: source || 'panel'
    });
    const publicTask = agentQueue.publicPending(task);
    broadcast({
      type: 'AGENT_PROMPT_QUEUED',
      sessionId: session.id,
      variantId: variant.id,
      task: publicTask
    });
    res.status(201).json({
      ok: true,
      queued: true,
      task: publicTask,
      status: agentQueue.getAgentQueueStatus(),
      howto:
        'Queued for same-chat handoff. Paste “Apply the pending Crank change” in your current Cursor chat (panel copies it). Skill pulls via crank_get_formatted_changes. Optional: Open new chat instead (deeplink) or set CURSOR_API_KEY + POST /api/agent-run for fully automatic.'
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/agent-prompt', (_req, res) => {
  const task = agentQueue.getPendingAgentTask();
  if (!task) {
    res.status(404).json({ ok: false, error: 'No pending agent prompt' });
    return;
  }
  res.json({ ok: true, task });
});

app.post('/api/agent-prompt/ack', (req, res) => {
  const result = agentQueue.ackPendingAgentTask(req.body?.id);
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }
  broadcast({ type: 'AGENT_PROMPT_ACKED', task: result.task });
  res.json(result);
});

app.delete('/api/agent-prompt', (_req, res) => {
  const result = agentQueue.clearPendingAgentTask();
  broadcast({ type: 'AGENT_PROMPT_CLEARED', task: result.task });
  res.json(result);
});

/** Retune-parity pending change APIs */
app.get('/api/pending-changes', (req, res) => {
  const enriched =
    String(req.query.enriched || '').toLowerCase() === 'true' ||
    req.query.enriched === '1';
  const changes = agentQueue.getPendingChanges({ enriched });
  if (!changes) {
    res.status(404).json({ ok: false, error: 'No pending Crank copy changes' });
    return;
  }
  res.json({ ok: true, pending: changes });
});

app.get('/api/pending-changes/formatted', (req, res) => {
  const clear =
    req.query.clear == null
      ? true
      : String(req.query.clear).toLowerCase() !== 'false' &&
        req.query.clear !== '0';
  const fidelity = req.query.fidelity || 'standard';
  const result = agentQueue.getFormattedChanges({ fidelity, clear });
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }
  if (result.cleared) {
    broadcast({ type: 'AGENT_PROMPT_CLEARED', task: result.task });
  }
  res.json(result);
});

app.get('/api/pending-changes/watch', async (req, res) => {
  const timeoutMs = Number(req.query.timeoutMs) || 30000;
  const sinceId = req.query.sinceId || null;
  const result = await agentQueue.watchPendingChanges({ timeoutMs, sinceId });
  res.json(result);
});

app.delete('/api/pending-changes', (_req, res) => {
  const result = agentQueue.clearPendingAgentTask();
  broadcast({ type: 'AGENT_PROMPT_CLEARED', task: result.task });
  res.json(result);
});

app.get('/api/agent-status', (_req, res) => {
  res.json({
    ...agentQueue.getAgentQueueStatus(),
    latestRun: agentRunner.getLatestAgentRun()
  });
});

/** Retune-style: tell the agent which repo, environment, and URLs are active. */
app.get('/api/environment', (req, res) => {
  const runtimeFile = path.join(PROJECT_ROOT, '.crank', 'runtime.json');
  let runtime = null;
  if (fs.existsSync(runtimeFile)) {
    try {
      runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    } catch {
      runtime = null;
    }
  }
  const resolved = describeEnvironment(PROJECT_ROOT);
  res.json({
    ok: true,
    projectRoot: PROJECT_ROOT,
    resolved,
    companion: {
      publicUrl: publicCompanionUrl(req),
      localUrl: `http://127.0.0.1:${PORT}`,
      healthy: true
    },
    runtime,
    mcp: runtime?.mcp || null,
    agent: {
      pastePhrase: 'Apply the pending Crank change',
      startCommand: 'npx crank',
      setupCommand: 'npx crank setup'
    },
    auth: getAuthStatus(),
    pending: agentQueue.getAgentQueueStatus()
  });
});

/**
 * Optional secondary path: headless Cursor SDK/CLI when CURSOR_API_KEY is set.
 * Primary UX remains MCP + skill pull (Retune-parity).
 */
app.post('/api/agent-run', (req, res) => {
  try {
    let task = agentQueue.getPendingAgentTask();
    const { sessionId, variantId } = req.body || {};
    if (!task && sessionId && variantId) {
      const session = store.getSession(sessionId);
      if (!session) {
        res.status(404).json({ ok: false, error: 'No active selection' });
        return;
      }
      const variant = (session.variants || []).find((v) => v.id === variantId);
      if (!variant) {
        res.status(404).json({ ok: false, error: `Unknown variant: ${variantId}` });
        return;
      }
      task = agentQueue.enqueueAgentTask({
        session,
        variant,
        source: 'panel-auto'
      });
      broadcast({
        type: 'AGENT_PROMPT_QUEUED',
        sessionId: session.id,
        variantId: variant.id,
        task: agentQueue.publicPending(task)
      });
    }
    if (!task) {
      res.status(404).json({
        ok: false,
        error: 'No pending Crank changes — click Agent first or pass sessionId+variantId'
      });
      return;
    }
    if (!agentRunner.apiKeyConfigured()) {
      res.status(400).json({
        ok: false,
        error: 'Set CURSOR_API_KEY to enable one-click Agent apply',
        apiKeyConfigured: false
      });
      return;
    }
    const job = agentRunner.startAgentRun({
      task,
      projectRoot: PROJECT_ROOT,
      onUpdate: (j) => {
        broadcast({ type: 'AGENT_RUN_UPDATE', job: j });
      }
    });
    broadcast({ type: 'AGENT_RUN_UPDATE', job });
    res.status(202).json({
      ok: true,
      job,
      task: agentQueue.publicPending(task)
    });
  } catch (err) {
    const status = err.code === 'MISSING_API_KEY' ? 400 : 500;
    res.status(status).json({
      ok: false,
      error: err.message,
      apiKeyConfigured: agentRunner.apiKeyConfigured()
    });
  }
});

app.get('/api/agent-run/:id', (req, res) => {
  const job = agentRunner.getAgentRun(req.params.id);
  if (!job) {
    res.status(404).json({ ok: false, error: 'Unknown agent run' });
    return;
  }
  res.json({ ok: true, job });
});

app.get('/api/agent-run', (_req, res) => {
  const job = agentRunner.getLatestAgentRun();
  if (!job) {
    res.status(404).json({ ok: false, error: 'No agent runs yet' });
    return;
  }
  res.json({ ok: true, job });
});

/** Optional: push arbitrary node text updates (edited by agent before apply) */
app.post('/api/apply-nodes', (req, res) => {
  try {
    const session = store.getSession(req.body?.sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
    const byPath = new Map(nodes.map((n) => [String(n.path), n]));
    session.nodes = session.nodes.map((node) => {
      const next = byPath.get(String(node.path));
      return next
        ? {
            ...node,
            text: next.text,
            previousText: node.text,
            originalText:
              node.originalText != null ? node.originalText : node.text
          }
        : node;
    });
    session.combinedText = session.nodes.map((n) => n.text).join('\n');
    session.appliedVariantId = req.body?.variantId || 'custom';
    session.updatedAt = new Date().toISOString();
    broadcast({
      type: 'APPLY_VARIANT',
      sessionId: session.id,
      variantId: session.appliedVariantId,
      nodes: session.nodes,
      session
    });
    res.json({ ok: true, session });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  path: '/ws',
  verifyClient(info, cb) {
    if (!teamAuthRequired()) {
      cb(true);
      return;
    }
    cb(isTeamTokenValid(extractTeamToken(info.req)));
  }
});

wss.on('connection', (socket, req) => {
  if (teamAuthRequired() && !isTeamTokenValid(extractTeamToken(req))) {
    try {
      socket.send(
        JSON.stringify({
          type: 'ERROR',
          code: 'TEAM_TOKEN_REQUIRED',
          error: 'Crank team token required'
        })
      );
    } catch {
      // ignore
    }
    socket.close(4401, 'Team token required');
    return;
  }
  browserClients.add(socket);
  socket.send(
    JSON.stringify({
      type: 'HELLO',
      service: 'crank-companion',
      activeSession: store.getActiveSession()
    })
  );

  socket.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    try {
      if (message.type === 'SET_SELECTION') {
        const session = store.setSelection(message.payload || {});
        broadcast({ type: 'SELECTION_UPDATED', session });
        socket.send(JSON.stringify({ type: 'SELECTION_ACK', session }));
        return;
      }

      if (message.type === 'REQUEST_VARIANTS') {
        const session = store.getSession(message.sessionId);
        if (!session) {
          socket.send(JSON.stringify({ type: 'ERROR', error: 'No active selection' }));
          return;
        }
        if (variantsInFlight.has(session.id)) {
          socket.send(
            JSON.stringify({
              type: 'ERROR',
              error: 'Glean variants already in progress for this selection'
            })
          );
          return;
        }
        variantsInFlight.add(session.id);
        try {
          const variants = await proposeCopyVariants(
            session,
            message.options || {},
            (progress) => {
              store.setGleanProgress(session.id, progress);
              broadcast({
                type: 'GLEAN_PROGRESS',
                sessionId: session.id,
                progress
              });
            }
          );
          const updated = store.setVariants(session.id, variants);
          broadcast({ type: 'VARIANTS_READY', session: updated });
        } catch (err) {
          broadcast({ type: 'GLEAN_ERROR', error: err.message });
          socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
        } finally {
          variantsInFlight.delete(session.id);
        }
        return;
      }

      if (message.type === 'APPLY_VARIANT') {
        const persist =
          message.persist !== false && message.preview !== true;
        const sessionBefore = store.getSession(message.sessionId);
        if (!sessionBefore) {
          socket.send(
            JSON.stringify({ type: 'ERROR', error: 'No active selection' })
          );
          return;
        }
        const preApplyNodes = (sessionBefore.nodes || []).map((n) => ({ ...n }));
        const { session, variant } = store.applyVariant(
          message.sessionId,
          message.variantId
        );
        let persistResult = null;
        if (persist) {
          persistResult = persistAppliedVariant(session, variant, PROJECT_ROOT, {
            preApplyNodes
          });
          if (persistResult.persisted) {
            broadcast({ type: 'TEXT_SAVED', payload: persistResult });
          }
        }
        broadcast({
          type: 'APPLY_VARIANT',
          sessionId: session.id,
          variantId: variant.id,
          nodes: variant.nodes,
          session,
          persist: !!persist,
          persistResult
        });
        socket.send(
          JSON.stringify({
            type: 'APPLY_RESULT',
            ok: true,
            persist: !!persist,
            persistResult,
            variantId: variant.id
          })
        );
        return;
      }

      if (message.type === 'PREVIEW_VARIANT') {
        const session = store.getSession(message.sessionId);
        if (!session) {
          socket.send(
            JSON.stringify({ type: 'ERROR', error: 'No active selection' })
          );
          return;
        }
        const variant = (session.variants || []).find(
          (v) => v.id === message.variantId
        );
        if (!variant) {
          socket.send(
            JSON.stringify({
              type: 'ERROR',
              error: `Unknown variant: ${message.variantId}`
            })
          );
          return;
        }
        broadcast({
          type: 'APPLY_VARIANT',
          sessionId: session.id,
          variantId: variant.id,
          nodes: variant.nodes,
          session,
          persist: false,
          preview: true
        });
        socket.send(
          JSON.stringify({
            type: 'APPLY_RESULT',
            ok: true,
            persist: false,
            preview: true,
            variantId: variant.id
          })
        );
        return;
      }

      if (message.type === 'QUEUE_AGENT_PROMPT') {
        const session = store.getSession(message.sessionId);
        if (!session) {
          socket.send(
            JSON.stringify({ type: 'ERROR', error: 'No active selection' })
          );
          return;
        }
        const variant = (session.variants || []).find(
          (v) => v.id === message.variantId
        );
        if (!variant) {
          socket.send(
            JSON.stringify({
              type: 'ERROR',
              error: `Unknown variant: ${message.variantId}`
            })
          );
          return;
        }
        const task = agentQueue.enqueueAgentTask({
          session,
          variant,
          source: message.source || 'panel-ws'
        });
        const publicTask = agentQueue.publicPending(task);
        broadcast({
          type: 'AGENT_PROMPT_QUEUED',
          sessionId: session.id,
          variantId: variant.id,
          task: publicTask
        });
        socket.send(
          JSON.stringify({
            type: 'AGENT_PROMPT_QUEUED',
            ok: true,
            task: publicTask,
            howto:
              'Queued for same-chat handoff. Paste “Apply the pending Crank change” in your current Cursor chat — skill pulls via crank_get_formatted_changes.'
          })
        );
        return;
      }

      if (message.type === 'PREVIEW_TEXT_CHANGE') {
        broadcast({
          type: 'PREVIEW_TEXT',
          sessionId: message.sessionId || message.payload?.sessionId,
          nodes: message.payload?.nodes || message.nodes || [],
          preview: true
        });
        socket.send(JSON.stringify({ type: 'PREVIEW_ACK', ok: true }));
        return;
      }

      if (message.type === 'SAVE_TEXT_CHANGE') {
        const result = saveTextChange(message.payload || {}, PROJECT_ROOT);
        socket.send(
          JSON.stringify({
            type: 'SAVE_RESULT',
            payload: result
          })
        );
        if (result.success) {
          broadcast({ type: 'TEXT_SAVED', payload: result });
        }
        return;
      }

      if (message.type === 'DISCARD_TEXT_PREVIEW') {
        broadcast({
          type: 'DISCARD_TEXT_PREVIEW',
          sessionId: message.sessionId || message.payload?.sessionId
        });
        return;
      }
    } catch (err) {
      socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
    }
  });

  socket.on('close', () => {
    browserClients.delete(socket);
  });
});

server.requestTimeout = 600000; // 10 min — Glean wait can take ~2 min
server.headersTimeout = 610000;
server.timeout = 600000;
server.keepAliveTimeout = 120000;

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[Crank] Port ${PORT} already in use — companion may already be running at http://${HOST}:${PORT}`
    );
    // Exit 0 so supervisors treat this as "already up", not a crash loop.
    process.exit(0);
  }
  console.error('[Crank] HTTP server error:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[Crank] Companion listening on http://${HOST}:${PORT}`);
  console.log(`[Crank] WebSocket ws://${HOST}:${PORT}/ws`);
  console.log(`[Crank] Project root: ${PROJECT_ROOT}`);
  console.log(
    `[Crank] Glean: ${
      String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false'
        ? 'STUB mode'
        : process.env.GLEAN_BASE_URL ||
          process.env.GLEAN_API_URL ||
          '(missing GLEAN_BASE_URL)'
    }`
  );
  console.log(
    `[Crank] Text-writer: ${writeTextChangeAvailable() ? 'ok (bundled)' : 'missing'}`
  );
});

// Keep the process alive on non-fatal async errors. Agents previously saw the
// companion vanish when an uncaughtException (or listen race) took down Node.
process.on('uncaughtException', (err) => {
  console.error('[Crank] uncaughtException (process kept alive):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[Crank] unhandledRejection (process kept alive):', err);
});
