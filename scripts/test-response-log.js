'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  recordResponse,
  findResponse,
  responsesPath,
  beginResponse,
  completeResponse,
  listResponses,
  settleStaleRuns,
  getResponse
} = require('../companion/response-log');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crank-responses-'));
const session = {
  pageUrl: 'http://localhost:5173/',
  origin: 'http://localhost:5173',
  selector: 'article',
  combinedText: 'Headline\nBody',
  nodes: [
    { id: 'copy-0', path: '0', role: 'heading', selector: 'h1', text: 'Headline', originalText: 'Headline' },
    { id: 'copy-1', path: '1', role: 'text', selector: 'p', text: 'Body', originalText: 'Body' }
  ]
};
const variants = [
  {
    id: 'glean-option-1',
    label: 'Option 1',
    nodes: [
      { path: '0', role: 'heading', text: 'New headline' },
      { path: '1', role: 'text', text: 'New body' }
    ]
  }
];

const run = recordResponse(root, session, variants);
assert.ok(fs.existsSync(responsesPath(root)));
const matched = findResponse(root, session.pageUrl, [
  { text: 'Headline' },
  { text: 'Body' }
]);
assert.strictEqual(matched.id, run.id);
assert.strictEqual(matched.variants[0].nodes[0].text, 'New headline');

const afterPreview = findResponse(root, session.pageUrl, [
  { text: 'New headline' },
  { text: 'New body' }
]);
assert.strictEqual(afterPreview.id, run.id);

const subset = findResponse(root, session.pageUrl, [{ text: 'Headline' }]);
assert.strictEqual(subset.id, run.id);
assert.strictEqual(subset.variants[0].nodes.length, 2);

const wider = {
  pageUrl: session.pageUrl,
  selector: 'article',
  nodes: session.nodes.concat([
    { id: 'copy-2', path: '2', role: 'text', text: 'Extra line', originalText: 'Extra line' }
  ])
};
const widerRun = recordResponse(root, wider, [
  {
    id: 'glean-option-1',
    label: 'Option 1',
    nodes: [
      { path: '0', text: 'New headline', originalText: 'Headline' },
      { path: '1', text: 'New body', originalText: 'Body' },
      { path: '2', text: 'Extra line', originalText: 'Extra line' }
    ]
  }
]);
const keptFull = findResponse(root, session.pageUrl, [
  { text: 'Headline' },
  { text: 'Body' }
]);
assert.strictEqual(keptFull.id, widerRun.id);
assert.strictEqual(keptFull.variants[0].nodes.length, 3);

const other = findResponse(root, session.pageUrl, [{ text: 'Something else' }]);
assert.strictEqual(other, null);

const empty = beginResponse(root, session, {});
assert.strictEqual(completeResponse(root, empty.id, []).status, 'expired');
assert.strictEqual(getResponse(root, empty.id).error, 'No response');

const stuck = beginResponse(root, session, {});
const runsFile = responsesPath(root);
const stored = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
const stuckRow = stored.runs.find((item) => item.id === stuck.id);
stuckRow.createdAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
fs.writeFileSync(runsFile, JSON.stringify(stored));
assert.strictEqual(settleStaleRuns(root, new Set()), true);
assert.strictEqual(listResponses(root).find((item) => item.id === stuck.id).status, 'expired');

const fresh = beginResponse(root, session, {});
assert.strictEqual(settleStaleRuns(root, new Set()), false);
assert.strictEqual(getResponse(root, fresh.id).status, 'running');
assert.strictEqual(settleStaleRuns(root, new Set([fresh.id])), false);

console.log('ok — response log keeps source text and options');
