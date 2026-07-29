'use strict';

/**
 * Dynamic vs static copy — runtime data stays in the selection list but is
 * excluded from Glean drafts, variant cards, and agent copy prompts.
 */

const { isJunkCopyValue } = require('./copy-labels');

function looksLikeDataValue(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^[\d,.$%+-]+$/.test(value)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(value) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value)) {
    return true;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (/^[A-Z]{2,}-\d{2,}$/.test(value) || /^#?[A-F0-9]{8,}$/i.test(value)) {
    return true;
  }
  if (/^[↑↓]\s*[\d,]+$/.test(value)) return true;
  if (/^[\u2014\u2013\-–—]+$/.test(value)) return true;
  return false;
}

function looksLikeStaticLabel(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const normalized = value
    .replace(/^[\[\(\{<\s]+/, '')
    .replace(/[\]\)\}>\s]+$/, '')
    .replace(/[.:;!?]+$/, '')
    .trim();
  const candidate = normalized || value;
  if (candidate.length > 40) return false;
  if (looksLikeDataValue(candidate)) return false;
  if (/^[A-Z0-9_\-.]+$/.test(candidate) && candidate.length <= 6) return false;
  return /[A-Za-z]/.test(candidate);
}

function nodeParts(node) {
  return Array.isArray(node?.parts) ? node.parts : [];
}

function isDynamicPart(part) {
  return part && part.type === 'dynamic-data';
}

/** Pure runtime data — visible in selection, excluded from Glean/copy/variants. */
function isDynamicOnlyNode(node) {
  if (!node) return false;

  const ts = node.textSource?.type;
  if (ts === 'dynamic-data') return true;

  const parts = nodeParts(node);
  if (parts.length) {
    const hasEditableStatic = parts.some(
      (p) =>
        !isDynamicPart(p) &&
        p.editable !== false &&
        looksLikeStaticLabel(String(p.text || ''))
    );
    return !hasEditableStatic;
  }

  if (node.editable === false) {
    if (ts === 'static-label') return false;
    return true;
  }

  if (!node.textSource && looksLikeDataValue(node.text) && !looksLikeStaticLabel(node.text)) {
    return true;
  }

  return false;
}

function isEditableCopyNode(node) {
  return !isDynamicOnlyNode(node);
}

/** Static fragments only — for mixed units with Dynamic chips in the panel. */
function draftTextForNode(node) {
  if (isDynamicOnlyNode(node)) return '';

  const parts = nodeParts(node);
  const staticTexts = parts
    .filter((p) => !isDynamicPart(p) && p.editable !== false)
    .map((p) => String(p.text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (staticTexts.length) return staticTexts.join(' ').trim();
  if (node.editable === false) return '';
  return String(node.text || '').trim();
}

/**
 * Copy units sent to Glean and used for response mapping (paths preserved).
 * @param {object[]} nodes
 */
function gleanEligibleNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => {
      const draft = draftTextForNode(node);
      return draft.length > 0 && isEditableCopyNode(node);
    })
    .map(({ node, index }) => {
      const draft = draftTextForNode(node);
      return {
        ...node,
        text: draft,
        originalText:
          node.originalText != null ? String(node.originalText) : draft,
        _sessionIndex: index
      };
    });
}

/** Merge Glean-mapped eligible nodes back onto the full session node list. */
function mergeVariantNodes(fullNodes, mappedEligible) {
  const full = Array.isArray(fullNodes) ? fullNodes : [];
  const mapped = Array.isArray(mappedEligible) ? mappedEligible : [];
  const byPath = new Map(mapped.map((n) => [String(n.path), n]));

  return full.map((node, i) => {
    const path = node.path != null ? String(node.path) : String(i);
    const base = {
      id: node.id || `copy-${path}`,
      path,
      role: node.role || 'text',
      selector: node.selector,
      editable: node.editable,
      textSource: node.textSource,
      label: node.label,
      parts: node.parts,
      originalText:
        node.originalText != null
          ? String(node.originalText)
          : node.text != null
            ? String(node.text)
            : undefined
    };

    if (isDynamicOnlyNode(node)) {
      return Object.assign(base, {
        text: String(node.text != null ? node.text : ''),
        editable: false
      });
    }

    const next = byPath.get(path);
    if (!next) {
      return Object.assign(base, {
        text: String(node.text != null ? node.text : '')
      });
    }

    return Object.assign(base, {
      text: String(next.text != null ? next.text : node.text || ''),
      copyLabel: next.copyLabel
    });
  });
}

/** Values Glean must not map onto static copy units (junk + runtime data). */
function isExcludedGleanValue(text) {
  if (isJunkCopyValue(text)) return true;
  const value = String(text || '').trim();
  if (!value) return true;
  return looksLikeDataValue(value) && !looksLikeStaticLabel(value);
}

module.exports = {
  looksLikeDataValue,
  looksLikeStaticLabel,
  isDynamicOnlyNode,
  isEditableCopyNode,
  isExcludedGleanValue,
  draftTextForNode,
  gleanEligibleNodes,
  mergeVariantNodes
};
