'use strict';

/**
 * Vizcopy companion — local bridge between:
 *   - browser bookmarklet / panel (WebSocket + HTTP)
 *   - Glean agent client (stubbed)
 *   - MCP server (HTTP API used by @vizcopy/mcp-server)
 *
 * Pattern adapted from Vizpatch companion/server.js (Express + ws on a fixed port),
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

const PORT = Number(process.env.VIZCOPY_PORT || 3344);
const HOST = process.env.VIZCOPY_HOST || '127.0.0.1';
const PROJECT_ROOT = process.env.VIZCOPY_PROJECT_ROOT
  ? path.resolve(process.env.VIZCOPY_PROJECT_ROOT)
  : process.cwd();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

/** @type {Set<import('ws').WebSocket>} */
const browserClients = new Set();

function broadcast(message) {
  const raw = JSON.stringify(message);
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

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

loadEnvFile();

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'vizcopy-companion',
    port: PORT,
    projectRoot: PROJECT_ROOT,
    activeSessionId: store.getActiveSession()?.id || null,
    gleanStub: String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false'
  });
});

app.get('/bookmarklet.js', (_req, res) => {
  const file = path.resolve(__dirname, '..', 'bookmarklet', 'vizcopy-bookmarklet.js');
  res.type('application/javascript');
  res.sendFile(file);
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Vizcopy companion</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1.25rem; color: #1a1a1a; line-height: 1.5; }
    code { background: #f3f3f3; padding: 0.1em 0.35em; border-radius: 4px; }
    a.bookmarklet { display: inline-block; margin-top: 1rem; padding: 0.55rem 0.9rem; background: #0f766e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .muted { color: #555; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>Vizcopy</h1>
  <p class="muted">Internal copy iteration bridge — select a <code>div</code>, send text to Glean, apply via MCP.</p>
  <p>Companion is running on <code>http://${HOST}:${PORT}</code>.</p>
  <p>Drag this to your bookmarks bar:</p>
  <a class="bookmarklet" href="javascript:(function(){var s=document.createElement('script');s.src='http://${HOST}:${PORT}/bookmarklet.js?t='+Date.now();document.documentElement.appendChild(s);})();">Vizcopy</a>
  <p class="muted">Health: <a href="/health">/health</a> · Active selection: <a href="/api/selection">/api/selection</a></p>
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

/** Ask Glean for 3–4 copy variants */
app.post('/api/variants', async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const session = store.getSession(sessionId);
    if (!session) {
      res.status(404).json({ ok: false, error: 'No active selection' });
      return;
    }
    const variants = await proposeCopyVariants(session, req.body?.options || {});
    const updated = store.setVariants(session.id, variants);
    broadcast({ type: 'VARIANTS_READY', session: updated });
    res.json({ ok: true, session: updated, variants });
  } catch (err) {
    console.error('[Vizcopy] Glean propose failed:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

/** Apply a chosen variant (MCP or panel). Pushes live DOM patch to browsers. */
app.post('/api/apply', (req, res) => {
  try {
    const { sessionId, variantId } = req.body || {};
    const { session, variant } = store.applyVariant(sessionId, variantId);
    broadcast({
      type: 'APPLY_VARIANT',
      sessionId: session.id,
      variantId: variant.id,
      nodes: variant.nodes,
      session
    });
    res.json({ ok: true, session, variant });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
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
      return next ? { ...node, text: next.text, previousText: node.text } : node;
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
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (socket) => {
  browserClients.add(socket);
  socket.send(
    JSON.stringify({
      type: 'HELLO',
      service: 'vizcopy-companion',
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
        const variants = await proposeCopyVariants(session, message.options || {});
        const updated = store.setVariants(session.id, variants);
        broadcast({ type: 'VARIANTS_READY', session: updated });
        return;
      }

      if (message.type === 'APPLY_VARIANT') {
        const { session, variant } = store.applyVariant(
          message.sessionId,
          message.variantId
        );
        broadcast({
          type: 'APPLY_VARIANT',
          sessionId: session.id,
          variantId: variant.id,
          nodes: variant.nodes,
          session
        });
      }
    } catch (err) {
      socket.send(JSON.stringify({ type: 'ERROR', error: err.message }));
    }
  });

  socket.on('close', () => {
    browserClients.delete(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Vizcopy] Companion listening on http://${HOST}:${PORT}`);
  console.log(`[Vizcopy] WebSocket ws://${HOST}:${PORT}/ws`);
  console.log(`[Vizcopy] Project root: ${PROJECT_ROOT}`);
  console.log(
    `[Vizcopy] Glean: ${
      String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false'
        ? 'STUB mode'
        : process.env.GLEAN_API_URL || '(missing GLEAN_API_URL)'
    }`
  );
});
