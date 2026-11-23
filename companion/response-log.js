'use strict';

/**
 * Local history of Glean responses, keyed to the strings that were sent.
 * Stored in PROJECT_ROOT/.crank/responses.json — gitignored so it stays
 * on this machine unless someone force-adds it.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_RUNS = 300;
/** A "running" row with no live request older than this is not still working. */
const STALE_RUNNING_MS = 2 * 60 * 1000;

function responsesPath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.crank', 'responses.json');
}

function nodeText(node) {
  if (!node) return '';
  if (node.originalText != null && String(node.originalText).length) {
    return String(node.originalText);
  }
  return node.text != null ? String(node.text) : '';
}

function sourceSignature(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => nodeText(node).trim())
    .join('\n');
}

function loadRuns(projectRoot) {
  const file = responsesPath(projectRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.runs)) return parsed.runs;
  } catch (_) {
    // missing or unreadable — start empty
  }
  return [];
}

function writeRuns(projectRoot, runs) {
  const file = responsesPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const body = JSON.stringify(
    { version: 1, runs: runs.slice(0, MAX_RUNS) },
    null,
    2
  );
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

function snapshotNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => ({
    id: node && node.id != null ? String(node.id) : '',
    path: node && node.path != null ? String(node.path) : '',
    role: node && node.role != null ? String(node.role) : '',
    selector: node && node.selector != null ? String(node.selector) : '',
    label: node && node.label != null ? String(node.label) : '',
    text: node && node.text != null ? String(node.text) : '',
    originalText: nodeText(node)
  }));
}

function cleanShot(value) {
  const shot = String(value || '');
  if (/^\/shots\/[a-f0-9]{16}\.png$/.test(shot)) return shot;
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(shot)) return '';
  if (shot.length > 180000) return '';
  return shot;
}

function shotFilePath(projectRoot, shot) {
  const match = String(shot || '').match(/^\/shots\/([a-f0-9]{16}\.png)$/);
  if (!match) return '';
  return path.join(path.resolve(projectRoot), '.crank', 'shots', match[1]);
}

function beginResponse(projectRoot, session, shots) {
  const sourceNodes = snapshotNodes(session && session.nodes);
  const images = shots && typeof shots === 'object' ? shots : {};
  const run = {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
    status: 'running',
    pageUrl: session && session.pageUrl ? String(session.pageUrl) : '',
    origin: session && session.origin ? String(session.origin) : '',
    selector: session && session.selector ? String(session.selector) : '',
    source: {
      combinedText:
        (session && session.combinedText) ||
        sourceNodes.map((node) => node.originalText).join('\n'),
      nodes: sourceNodes
    },
    shots: {
      tight: cleanShot(images.tight),
      context: cleanShot(images.context)
    },
    variants: []
  };
  const runs = loadRuns(projectRoot);
  runs.unshift(run);
  writeRuns(projectRoot, runs);
  return run;
}

function completeResponse(projectRoot, id, variants) {
  const runs = loadRuns(projectRoot);
  const run = runs.find((item) => item && item.id === id);
  if (!run) return null;
  const list = Array.isArray(variants) ? variants : [];
  run.completedAt = new Date().toISOString();
  run.variants = list;
  const withTable = list.find((v) => v && v.agentTable);
  if (withTable) run.table = String(withTable.agentTable);
  if (!list.length) {
    run.status = 'expired';
    run.error = 'No response';
  } else {
    run.status = 'ready';
    delete run.error;
  }
  writeRuns(projectRoot, runs);
  return run;
}

function expireResponse(projectRoot, id, error) {
  const runs = loadRuns(projectRoot);
  const run = runs.find((item) => item && item.id === id);
  if (!run || run.status !== 'running') return run || null;
  run.status = 'expired';
  run.completedAt = new Date().toISOString();
  run.error = String(error || 'No response').slice(0, 300);
  writeRuns(projectRoot, runs);
  return run;
}

function settleStaleRuns(projectRoot, activeIds) {
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds || []);
  const runs = loadRuns(projectRoot);
  const now = Date.now();
  let changed = false;
  runs.forEach((run) => {
    if (!run || run.status !== 'running') return;
    if (active.has(run.id)) return;
    const started = Date.parse(run.createdAt || '');
    if (Number.isFinite(started) && now - started < STALE_RUNNING_MS) return;
    run.status = 'expired';
    run.completedAt = new Date().toISOString();
    run.error = 'No response';
    changed = true;
  });
  if (changed) writeRuns(projectRoot, runs);
  return changed;
}

function failResponse(projectRoot, id, error) {
  const runs = loadRuns(projectRoot);
  const run = runs.find((item) => item && item.id === id);
  if (!run) return null;
  run.status = 'error';
  run.completedAt = new Date().toISOString();
  run.error = String(error || 'Glean failed').slice(0, 300);
  writeRuns(projectRoot, runs);
  return run;
}

function recordResponse(projectRoot, session, variants, shots) {
  const run = beginResponse(projectRoot, session, shots);
  return completeResponse(projectRoot, run.id, variants) || run;
}

function collectedTexts(nodes) {
  const out = [];
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    const original = nodeText(node).trim();
    if (original) out.push(original);
    const current = node && node.text != null ? String(node.text).trim() : '';
    if (current && current !== original) out.push(current);
  });
  return out;
}

function runTextBag(run) {
  const bag = collectedTexts(run && run.source && run.source.nodes);
  (run && run.variants ? run.variants : []).forEach((variant) => {
    collectedTexts(variant && variant.nodes).forEach((text) => bag.push(text));
  });
  return new Set(bag);
}

function listResponses(projectRoot) {
  return loadRuns(projectRoot).map((run) => {
    const nodes = run && run.source && Array.isArray(run.source.nodes) ? run.source.nodes : [];
    return {
      id: run.id,
      createdAt: run.createdAt,
      status: run.status || 'ready',
      pageUrl: run.pageUrl || '',
      optionCount: Array.isArray(run.variants) ? run.variants.length : 0,
      strings: nodes.map((node) => nodeText(node).trim()).filter(Boolean),
      shots: {
        tight: run.shots && run.shots.tight ? run.shots.tight : '',
        context: run.shots && run.shots.context ? run.shots.context : ''
      }
    };
  });
}

function deleteResponse(projectRoot, id) {
  const key = String(id || '');
  if (!key) return false;
  const runs = loadRuns(projectRoot);
  const index = runs.findIndex((run) => run && run.id === key);
  if (index < 0) return false;
  const run = runs[index];
  ['tight', 'context'].forEach((name) => {
    const file = shotFilePath(projectRoot, run && run.shots && run.shots[name]);
    if (!file) return;
    try {
      fs.unlinkSync(file);
    } catch (_) {
      // the history row is still removed if the file is already gone
    }
  });
  runs.splice(index, 1);
  writeRuns(projectRoot, runs);
  return true;
}

function getResponse(projectRoot, id) {
  const key = String(id || '');
  if (!key) return null;
  return loadRuns(projectRoot).find((run) => run && run.id === key) || null;
}

function findResponse(projectRoot, pageUrl, nodes) {
  const selected = collectedTexts(nodes);
  if (!selected.length) return null;
  const runs = loadRuns(projectRoot);
  const url = String(pageUrl || '');
  const samePage = runs.filter((run) => !url || run.pageUrl === url);
  const pool = (samePage.length ? samePage : runs).filter(
    (run) => run && run.status !== 'running' && run.status !== 'error'
  );
  const covering = pool.filter((run) => {
    const bag = runTextBag(run);
    return selected.every((text) => bag.has(text));
  });
  if (!covering.length) return null;
  covering.sort((a, b) => {
    const aCount = (a.source && a.source.nodes ? a.source.nodes : []).length;
    const bCount = (b.source && b.source.nodes ? b.source.nodes : []).length;
    if (bCount !== aCount) return bCount - aCount;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return covering[0];
}

module.exports = {
  responsesPath,
  sourceSignature,
  loadRuns,
  recordResponse,
  beginResponse,
  completeResponse,
  failResponse,
  expireResponse,
  settleStaleRuns,
  findResponse,
  listResponses,
  deleteResponse,
  getResponse,
  snapshotNodes
};
