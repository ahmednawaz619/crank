'use strict';

/**
 * Persist an applied variant to source via Crank text-writer (SAVE_TEXT_CHANGE).
 * Skips locked/dynamic nodes with an explicit reason — never silent.
 */

const { saveTextChange, pathHintsFromUrl } = require('./text-dispatch');

function roleLabel(role) {
  const r = String(role || 'text').toLowerCase();
  if (r === 'heading') return 'Heading';
  if (r === 'action' || r === 'button') return 'CTA';
  if (r === 'label') return 'Label';
  return 'Body';
}

/**
 * @param {object} session - session AFTER store.applyVariant (nodes already updated)
 * @param {object} variant
 * @param {string} projectRoot
 * @param {object} [options]
 * @param {object[]} [options.preApplyNodes] - session.nodes snapshot before apply
 */
function persistAppliedVariant(session, variant, projectRoot, options = {}) {
  const preNodes = Array.isArray(options.preApplyNodes)
    ? options.preApplyNodes
    : session?.nodes || [];
  const preByPath = new Map(preNodes.map((n) => [String(n.path), n]));
  const variantNodes = Array.isArray(variant?.nodes) ? variant.nodes : [];

  const results = [];
  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const vn of variantNodes) {
    const path = String(vn.path);
    const pre =
      preByPath.get(path) ||
      (vn.id
        ? preNodes.find((n) => n && String(n.id) === String(vn.id))
        : null) ||
      {};
    const label = roleLabel(vn.role || pre.role);
    const newText = String(vn.text != null ? vn.text : '');
    const oldText = String(
      pre.originalText != null
        ? pre.originalText
        : pre.previousText != null
          ? pre.previousText
          : pre.text != null
            ? pre.text
            : ''
    );

    if (oldText === newText) {
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'unchanged',
        message: 'No text change'
      });
      skipped += 1;
      continue;
    }

    const editable = pre.editable !== false && vn.editable !== false;
    const sourceType =
      (pre.textSource && pre.textSource.type) ||
      (vn.textSource && vn.textSource.type) ||
      '';

    if (!editable) {
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'skipped',
        reason: 'locked',
        message:
          sourceType === 'dynamic-data'
            ? 'Dynamic/bound data — cannot write hardcoded source'
            : sourceType === 'bound-unknown'
              ? 'Bound text — cannot save to source'
              : 'Node is not editable for source save'
      });
      skipped += 1;
      continue;
    }

    const selectorText =
      vn.selector || pre.selector || session.selector || '';
    if (!selectorText) {
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'failed',
        message: 'No CSS selector available for text save'
      });
      failed += 1;
      continue;
    }

    if (!oldText) {
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'failed',
        message:
          'Missing originalText/oldValue for source resolve — re-select the element'
      });
      failed += 1;
      continue;
    }

    const pageUrl = session.pageUrl || session.meta?.pageUrl || '';
    const pathHints = []
      .concat(Array.isArray(session.meta?.pathHints) ? session.meta.pathHints : [])
      .concat(pathHintsFromUrl(pageUrl));

    const saveResult = saveTextChange(
      {
        selectorText,
        value: newText,
        oldValue: oldText,
        sourceUrl: pageUrl,
        origin: session.origin || '',
        pageUrl,
        pathHints,
        file: session.meta?.file || pre.file || undefined,
        componentName:
          session.meta?.componentName ||
          pre.componentName ||
          vn.componentName ||
          undefined
      },
      projectRoot
    );

    if (saveResult.success) {
      saved += 1;
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'saved',
        file: saveResult.file,
        message: `Saved to ${saveResult.file || 'source'}`
      });
    } else {
      failed += 1;
      results.push({
        path,
        role: vn.role || pre.role,
        label,
        status: 'failed',
        file: saveResult.file,
        message: saveResult.error || 'Save failed',
        attemptedFiles: saveResult.attemptedFiles
      });
    }
  }

  const summaryParts = [];
  if (saved) summaryParts.push(`saved ${saved}`);
  if (failed) summaryParts.push(`failed ${failed}`);
  if (skipped) summaryParts.push(`skipped ${skipped}`);

  return {
    ok: failed === 0,
    persisted: saved > 0,
    saved,
    failed,
    skipped,
    results,
    summary:
      summaryParts.length > 0
        ? `Source: ${summaryParts.join(', ')}`
        : 'Source: nothing to write'
  };
}

module.exports = {
  persistAppliedVariant
};
