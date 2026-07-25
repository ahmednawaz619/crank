'use strict';

/**
 * Pending Crank copy changes queued from the panel "Agent" button.
 * Retune-parity: store structured old→new mappings; MCP tools pull/format/watch/clear.
 */

const crypto = require('crypto');
const { unitDisplayLabel } = require('../lib/copy-labels');

/** @type {object|null} */
let pending = null;

/** @type {Array<{ sinceId: string|null, resolve: Function, timer: NodeJS.Timeout }>} */
const watchers = [];

function roleLabel(role, node, index, nodes) {
  if (node && node.label) return node.label;
  if (node && nodes) return unitDisplayLabel(node, index, nodes);
  const r = String(role || 'text').toLowerCase();
  if (r === 'heading') return 'Heading';
  if (r === 'action' || r === 'button') return 'CTA';
  if (r === 'label') return 'Label';
  return 'Copy';
}

function findSessionNode(sessionNodes, vn) {
  if (!vn) return null;
  if (vn.id) {
    const byId = sessionNodes.find((n) => n && String(n.id) === String(vn.id));
    if (byId) return byId;
  }
  if (vn.path != null) {
    const byPath = sessionNodes.find(
      (n) => n && String(n.path) === String(vn.path)
    );
    if (byPath) return byPath;
  }
  if (vn.selector) {
    return (
      sessionNodes.find((n) => n && n.selector && n.selector === vn.selector) ||
      null
    );
  }
  return null;
}

/**
 * Build an executable prompt the Cursor agent can follow to update source.
 * Always lists per-string old→new pairs (one row per copy unit).
 * @param {{ session: object, variant: object }} opts
 */
function buildAgentPrompt({ session, variant }) {
  const lines = [
    'Apply this Crank copy change to the product source files.',
    '',
    'Context:',
    `- Page: ${session?.pageUrl || '(unknown)'}`,
    `- Selection selector: ${session?.selector || '(unknown)'}`,
    `- Variant: ${variant?.label || variant?.id || '(unnamed)'}`,
    '',
    'Update each string below independently (old → new). Do not reuse one New value for every field.',
    'Prefer hardcoded JSX/HTML string literals; do not invent i18n keys. Skip dynamic/bound/API-driven values.',
    '',
    'Per-string mapping:'
  ];

  const changes = [];
  const sessionNodes = Array.isArray(session?.nodes) ? session.nodes : [];
  const variantNodes = Array.isArray(variant?.nodes) ? variant.nodes : [];

  // Primary: node-aligned mapping (id/path) — never collapse to a single blob.
  if (variantNodes.length) {
    for (let vi = 0; vi < variantNodes.length; vi++) {
      const vn = variantNodes[vi];
      const sn = findSessionNode(sessionNodes, vn);
      const oldText =
        sn?.originalText ?? sn?.previousText ?? sn?.text ?? '';
      const newText = vn.text != null ? vn.text : '';
      if (String(oldText) === String(newText)) continue;
      const snIndex = sn
        ? sessionNodes.findIndex((n) => n && String(n.path) === String(sn.path))
        : vi;
      changes.push({
        id: vn.id || sn?.id || `copy-${vn.path}`,
        role: vn.role || sn?.role || 'text',
        label: roleLabel(
          vn.role || sn?.role,
          sn || vn,
          snIndex >= 0 ? snIndex : vi,
          sessionNodes
        ),
        selector: vn.selector || sn?.selector || session?.selector || '',
        path: vn.path != null ? vn.path : sn?.path,
        editable: sn?.editable !== false && vn.editable !== false,
        oldText: String(oldText),
        newText: String(newText)
      });
    }
  } else {
    // Fallback: fields object with exclusive role/positional assignment
    const fields = variant?.fields || {};
    const bodies = Array.isArray(fields.bodies)
      ? fields.bodies
      : fields.body
        ? [fields.body]
        : [];
    const slots = [
      { role: 'heading', value: fields.heading },
      ...bodies.map((value) => ({ role: 'text', value })),
      { role: 'action', value: fields.cta }
    ].filter((s) => s.value != null && s.value !== '');

    const used = new Set();
    for (const slot of slots) {
      let match = sessionNodes.find(
        (n, i) =>
          !used.has(i) &&
          String(n.role || '').toLowerCase() === slot.role
      );
      if (!match && slot.role === 'action') {
        match = sessionNodes.find(
          (n, i) =>
            !used.has(i) &&
            String(n.role || '').toLowerCase() === 'button'
        );
      }
      if (!match) {
        const idx = sessionNodes.findIndex((_, i) => !used.has(i));
        match = idx >= 0 ? sessionNodes[idx] : null;
        if (idx >= 0) used.add(idx);
      } else {
        used.add(sessionNodes.indexOf(match));
      }
      if (!match) continue;
      const oldText =
        match.originalText ?? match.previousText ?? match.text ?? '';
      changes.push({
        id: match.id || `copy-${match.path}`,
        role: match.role || slot.role,
        label: roleLabel(
          match.role || slot.role,
          match,
          sessionNodes.indexOf(match),
          sessionNodes
        ),
        selector: match.selector || session?.selector || '',
        path: match.path,
        editable: match.editable !== false,
        oldText: String(oldText),
        newText: String(slot.value)
      });
    }
  }

  if (!changes.length) {
    lines.push('(No text deltas found — inspect the variant nodes and selection.)');
  } else {
    lines.push('| Field | Selector | Old | New |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of changes) {
      lines.push(
        `| ${c.label} | \`${c.selector || '(none)'}\` | ${JSON.stringify(c.oldText)} | ${JSON.stringify(c.newText)} |`
      );
    }
    lines.push('');
    for (const c of changes) {
      lines.push(`${c.label} (id=${c.id}, path=${c.path}):`);
      lines.push(`  Selector: ${c.selector || '(none)'}`);
      lines.push(
        `  Editable: ${c.editable ? 'yes' : 'no (likely dynamic/bound — report if blocked)'}`
      );
      lines.push(`  Old: ${JSON.stringify(c.oldText)}`);
      lines.push(`  New: ${JSON.stringify(c.newText)}`);
      lines.push('');
    }
  }

  lines.push('Instructions:');
  lines.push('1. Locate the source file(s) containing each Old string (HTML/JSX/TSX).');
  lines.push('2. Replace each Old with its matching New only — keep mappings 1:1.');
  lines.push('3. If a string is i18n/dynamic/bound, say so and do not invent translations.');
  lines.push('4. After edits, briefly confirm which files changed.');
  lines.push(
    '5. Prefer MCP tools when available: crank_get_formatted_changes / get_pending_agent_prompt, then apply_copy_variant (persist) or edit source, then crank_clear_changes / ack_pending_agent_prompt.'
  );

  return {
    prompt: lines.join('\n'),
    changes
  };
}

function notifyWatchers() {
  const id = pending?.id || null;
  const ready = watchers.splice(0, watchers.length);
  for (const w of ready) {
    clearTimeout(w.timer);
    w.resolve({
      ok: true,
      timedOut: false,
      pending: pending
        ? publicPending(pending)
        : null
    });
  }
  return id;
}

function publicPending(task) {
  if (!task) return null;
  return {
    id: task.id,
    createdAt: task.createdAt,
    status: task.status,
    source: task.source,
    sessionId: task.sessionId,
    variantId: task.variantId,
    variantLabel: task.variantLabel,
    pageUrl: task.pageUrl,
    selector: task.selector,
    prompt: task.prompt,
    changes: task.changes,
    changeCount: Array.isArray(task.changes) ? task.changes.length : 0
  };
}

function enqueueAgentTask({ session, variant, source = 'panel' }) {
  if (!session || !variant) {
    throw new Error('session and variant are required');
  }
  const built = buildAgentPrompt({ session, variant });
  pending = {
    id: crypto.randomBytes(6).toString('hex'),
    createdAt: new Date().toISOString(),
    status: 'pending',
    source,
    sessionId: session.id,
    variantId: variant.id,
    variantLabel: variant.label || variant.id,
    pageUrl: session.pageUrl || '',
    selector: session.selector || '',
    prompt: built.prompt,
    changes: built.changes,
    session: {
      id: session.id,
      selector: session.selector,
      pageUrl: session.pageUrl,
      nodes: session.nodes
    },
    variant: {
      id: variant.id,
      label: variant.label,
      fields: variant.fields || null,
      nodes: variant.nodes || []
    }
  };
  notifyWatchers();
  return pending;
}

function getPendingAgentTask() {
  return pending;
}

function getPendingChanges({ enriched = false } = {}) {
  if (!pending) return null;
  const base = {
    id: pending.id,
    createdAt: pending.createdAt,
    status: pending.status,
    variantId: pending.variantId,
    variantLabel: pending.variantLabel,
    pageUrl: pending.pageUrl,
    selector: pending.selector,
    changes: pending.changes || []
  };
  if (!enriched) return base;
  return {
    ...base,
    prompt: pending.prompt,
    session: pending.session,
    variant: pending.variant
  };
}

/**
 * Retune-style markdown for the agent skill / paste path.
 * @param {{ fidelity?: 'minimal'|'standard'|'full', clear?: boolean }} opts
 */
function getFormattedChanges(opts = {}) {
  const fidelity = opts.fidelity || 'standard';
  const shouldClear = opts.clear !== false;
  if (!pending) {
    return { ok: false, error: 'No pending Crank copy changes' };
  }
  const task = pending;
  const changes = Array.isArray(task.changes) ? task.changes : [];
  const lines = [
    '# Copy Changes',
    '',
    `The user queued a Crank copy variant for source apply.`,
    '',
    `**Variant:** ${task.variantLabel || task.variantId}`,
    `**Page:** ${task.pageUrl || '(unknown)'}`,
    `**Selection:** \`${task.selector || '(none)'}\``,
    `**Task id:** ${task.id}`,
    `**Change count:** ${changes.length}`,
    ''
  ];

  if (!changes.length) {
    lines.push('_No text deltas._');
  } else {
    lines.push('## Per-string mapping');
    lines.push('');
    lines.push('| Field | Selector | Path | Before | After | Editable |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const c of changes) {
      lines.push(
        `| ${c.label || c.role || 'Body'} | \`${c.selector || '(none)'}\` | ${c.path != null ? c.path : '—'} | ${JSON.stringify(c.oldText)} | ${JSON.stringify(c.newText)} | ${c.editable === false ? 'no' : 'yes'} |`
      );
    }
    lines.push('');
    if (fidelity !== 'minimal') {
      lines.push('## Details');
      lines.push('');
      for (const c of changes) {
        lines.push(`### ${c.label || 'Body'} (\`${c.id}\`)`);
        lines.push('');
        lines.push(`- **Selector:** \`${c.selector || '(none)'}\``);
        lines.push(`- **Path:** ${c.path != null ? c.path : '—'}`);
        lines.push(
          `- **Editable:** ${c.editable === false ? 'no (likely dynamic/bound)' : 'yes'}`
        );
        lines.push(`- **Before:** ${JSON.stringify(c.oldText)}`);
        lines.push(`- **After:** ${JSON.stringify(c.newText)}`);
        lines.push('');
      }
    }
  }

  if (fidelity === 'full' && task.prompt) {
    lines.push('## Full prompt');
    lines.push('');
    lines.push('```');
    lines.push(task.prompt);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Workflow');
  lines.push('');
  lines.push(
    '1. Locate each Before string in source (HTML/JSX/TSX) under the project root.'
  );
  lines.push('2. Replace with the matching After value only (1:1).');
  lines.push(
    '3. Prefer hardcoded literals; do not invent i18n keys for dynamic/bound strings.'
  );
  lines.push(
    '4. Optionally call `apply_copy_variant` with persist for DOM + Vizpatch text-writer.'
  );
  lines.push(
    '5. Always call `crank_clear_changes` (or `ack_pending_agent_prompt`) when done.'
  );

  const markdown = lines.join('\n');
  const snapshot = publicPending(task);
  if (shouldClear) {
    pending = null;
    notifyWatchers();
  }
  return {
    ok: true,
    markdown,
    task: snapshot,
    cleared: shouldClear
  };
}

/**
 * Long-poll until a pending task exists (or id differs from sinceId).
 * @param {{ timeoutMs?: number, sinceId?: string|null }} opts
 */
function watchPendingChanges(opts = {}) {
  const timeoutMs = Math.min(
    Math.max(Number(opts.timeoutMs) || 30000, 1000),
    120000
  );
  const sinceId = opts.sinceId != null ? String(opts.sinceId) : null;

  if (pending && pending.id !== sinceId) {
    return Promise.resolve({
      ok: true,
      timedOut: false,
      pending: publicPending(pending)
    });
  }

  return new Promise((resolve) => {
    const entry = {
      sinceId,
      resolve,
      timer: setTimeout(() => {
        const idx = watchers.indexOf(entry);
        if (idx >= 0) watchers.splice(idx, 1);
        resolve({
          ok: true,
          timedOut: true,
          pending: pending ? publicPending(pending) : null
        });
      }, timeoutMs)
    };
    watchers.push(entry);
  });
}

function ackPendingAgentTask(id) {
  if (!pending) {
    return { ok: false, error: 'No pending agent task' };
  }
  if (id && pending.id !== id) {
    return { ok: false, error: `Pending id mismatch (have ${pending.id})` };
  }
  const done = { ...pending, status: 'acked', ackedAt: new Date().toISOString() };
  pending = null;
  notifyWatchers();
  return { ok: true, task: done };
}

function clearPendingAgentTask() {
  const had = pending;
  pending = null;
  notifyWatchers();
  return { ok: true, cleared: !!had, task: had ? publicPending(had) : null };
}

function getAgentQueueStatus() {
  let sdkAvailable = false;
  try {
    require.resolve('@cursor/sdk');
    sdkAvailable = true;
  } catch {
    sdkAvailable = false;
  }
  const runtime = String(process.env.CURSOR_AGENT_RUNTIME || 'local')
    .trim()
    .toLowerCase();
  return {
    ok: true,
    hasPending: !!pending,
    pending: pending
      ? {
          id: pending.id,
          variantId: pending.variantId,
          variantLabel: pending.variantLabel,
          createdAt: pending.createdAt,
          changeCount: Array.isArray(pending.changes) ? pending.changes.length : 0,
          status: pending.status
        }
      : null,
    watchers: watchers.length,
    apiKeyConfigured: Boolean(
      process.env.CURSOR_API_KEY && String(process.env.CURSOR_API_KEY).trim()
    ),
    sdkAvailable,
    agentRuntime: runtime === 'cloud' ? 'cloud' : 'local',
    howto:
      'Paste “Apply the pending Crank change” in your current Cursor chat (or keep an agent with the crank-apply-changes skill). Tools: crank_get_formatted_changes → edit source → crank_clear_changes. Cursor has no public inject-into-open-chat API.'
  };
}

module.exports = {
  buildAgentPrompt,
  enqueueAgentTask,
  getPendingAgentTask,
  getPendingChanges,
  getFormattedChanges,
  watchPendingChanges,
  ackPendingAgentTask,
  clearPendingAgentTask,
  getAgentQueueStatus,
  publicPending
};
