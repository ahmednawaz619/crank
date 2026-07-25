'use strict';

/**
 * In-memory selection + variant session store.
 * Browser bookmarklet writes here; MCP tools and Glean client read/write here.
 */

const crypto = require('crypto');
const { assignUnitLabels } = require('../lib/copy-labels');

/** @type {Map<string, object>} */
const sessions = new Map();

let activeSessionId = null;

function createSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * @param {object} payload
 * @returns {object}
 */
function normalizeNodes(nodes) {
  return assignUnitLabels(
    (Array.isArray(nodes) ? nodes : []).map((n, i) => {
    const text = n && n.text != null ? String(n.text) : '';
    const path = n && n.path != null ? String(n.path) : String(i);
    return {
      ...n,
      id: (n && n.id) || `copy-${path}`,
      path,
      text,
      previousText: n.previousText != null ? String(n.previousText) : text,
      // Freeze source baseline for SAVE_TEXT_CHANGE oldValue across applies.
      originalText:
        n.originalText != null ? String(n.originalText) : text
    };
  })
  );
}

function setSelection(payload) {
  const id = createSessionId();
  const nodes = normalizeNodes(payload.nodes);
  const session = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: payload.origin || '',
    pageUrl: payload.pageUrl || '',
    selector: payload.selector || '',
    tagName: payload.tagName || '',
    nodes,
    combinedText: payload.combinedText || nodes.map((n) => n.text).join('\n'),
    variants: [],
    appliedVariantId: null,
    meta: payload.meta || {}
  };
  sessions.set(id, session);
  activeSessionId = id;
  return session;
}

function getActiveSession() {
  if (!activeSessionId) {
    return null;
  }
  return sessions.get(activeSessionId) || null;
}

function getSession(id) {
  if (!id) {
    return getActiveSession();
  }
  return sessions.get(id) || null;
}

function listSessions() {
  return Array.from(sessions.values()).sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
}

/**
 * @param {string} sessionId
 * @param {object[]} variants
 */
function setVariants(sessionId, variants) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  session.variants = Array.isArray(variants) ? variants : [];
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  activeSessionId = session.id;
  return session;
}

/**
 * Apply a variant's node map onto the stored selection (source of truth for MCP).
 * Live DOM apply is pushed to connected browsers via WebSocket by the server.
 */
function applyVariant(sessionId, variantId) {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  const variant = (session.variants || []).find((v) => v.id === variantId);
  if (!variant) {
    throw new Error(`Unknown variant: ${variantId}`);
  }

  const byPath = new Map(
    (variant.nodes || []).map((n) => [String(n.path), n])
  );

  session.nodes = (session.nodes || []).map((node) => {
    const next =
      byPath.get(String(node.path)) ||
      (node.id
        ? (variant.nodes || []).find((n) => String(n.id) === String(node.id))
        : null);
    if (!next) {
      return node;
    }
    return {
      ...node,
      id: node.id || next.id || `copy-${node.path}`,
      text: next.text,
      previousText: node.text,
      originalText:
        node.originalText != null ? node.originalText : node.text
    };
  });
  session.combinedText = session.nodes.map((n) => n.text).join('\n');
  session.appliedVariantId = variantId;
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  activeSessionId = session.id;
  return { session, variant };
}

function clearSessions() {
  sessions.clear();
  activeSessionId = null;
}

function setGleanProgress(sessionId, progress) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.gleanProgress = progress || null;
  session.gleanProgressAt = new Date().toISOString();
  sessions.set(session.id, session);
  return session.gleanProgress;
}

function getGleanProgress(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  return session.gleanProgress || null;
}

module.exports = {
  setSelection,
  getActiveSession,
  getSession,
  listSessions,
  setVariants,
  applyVariant,
  clearSessions,
  setGleanProgress,
  getGleanProgress
};
