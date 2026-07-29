'use strict';

/**
 * Display/draft labels for copy units — semantic roles when obvious,
 * otherwise numbered Copy 1..N (never forced Heading/Body/CTA).
 */

function normalizeRole(role) {
  return String(role || 'text').toLowerCase();
}

function isTextLikeRole(role) {
  const r = normalizeRole(role);
  return r === 'text' || r === 'label' || r === 'body';
}

/** Table / rubric junk — not real UI copy (causes off-by-one mapping if kept). */
function isJunkCopyValue(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (/^[\|\\/\u2014\u2013\-–—.\s]+$/.test(s)) return true;
  if (/\|\s*Strong\b/i.test(s) || /^Strong\b/i.test(s)) return true;
  return false;
}

function hasSemanticStructure(nodes) {
  return (Array.isArray(nodes) ? nodes : []).some((n) => {
    const r = normalizeRole(n.role);
    return r === 'heading' || r === 'action' || r === 'button';
  });
}

function textLikeNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).filter((n) =>
    isTextLikeRole(n.role)
  );
}

/**
 * @param {object} node
 * @param {number} index - index in full nodes array
 * @param {object[]} nodes
 * @returns {string}
 */
function unitDisplayLabel(node, index, nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const role = normalizeRole(node && node.role);
  if (role === 'heading') return 'Heading';
  if (role === 'action' || role === 'button') return 'CTA';
  if (role === 'label') return 'Label';

  const semantic = hasSemanticStructure(list);
  const texts = textLikeNodes(list);

  if (semantic) {
    const bodyIndex = texts.findIndex((n) => n === node);
    if (bodyIndex >= 0) {
      return texts.length > 1 ? `Body ${bodyIndex + 1}` : 'Body';
    }
  }

  if (list.length <= 1) return 'Copy 1';
  return `Copy ${index + 1}`;
}

/**
 * @param {object[]} nodes
 * @returns {object[]}
 */
function assignUnitLabels(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((node, index) =>
    Object.assign({}, node, {
      label: node.label || unitDisplayLabel(node, index, list)
    })
  );
}

/**
 * Draft label for Glean (same as display, with trailing colon added by caller).
 * @param {object} node
 * @param {number} index
 * @param {object[]} nodes
 */
function unitDraftLabel(node, index, nodes) {
  return unitDisplayLabel(node, index, nodes);
}

module.exports = {
  unitDisplayLabel,
  unitDraftLabel,
  assignUnitLabels,
  hasSemanticStructure,
  isTextLikeRole,
  isJunkCopyValue
};
