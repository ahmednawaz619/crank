'use strict';

/**
 * In-memory selection + variant session store.
 * Browser bookmarklet writes here; MCP tools and Glean client read/write here.
 */

const crypto = require('crypto');

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
function setSelection(payload) {
  const id = createSessionId();
  const session = {
    id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: payload.origin || '',
    pageUrl: payload.pageUrl || '',
    selector: payload.selector || '',
    tagName: payload.tagName || '',
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    combinedText: payload.combinedText || '',
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
    const next = byPath.get(String(node.path));
    if (!next) {
      return node;
    }
    return {
      ...node,
      text: next.text,
      previousText: node.text
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

module.exports = {
  setSelection,
  getActiveSession,
  getSession,
  listSessions,
  setVariants,
  applyVariant,
  clearSessions
};
