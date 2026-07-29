'use strict';

const assert = require('assert');
const {
  buildCompactCopyPrompt,
  collectCopyChanges,
  collectCopyChangesFromEdits
} = require('../companion/agent-queue');

const session = {
  pageUrl: 'http://localhost:5173/dashboard',
  selector: 'div.hero > h1',
  nodes: [
    {
      id: 'n0',
      path: 0,
      role: 'heading',
      text: 'This month',
      originalText: 'This month',
      selector: 'div.hero > h1'
    },
    {
      id: 'n1',
      path: 1,
      role: 'text',
      text: 'Compare to last month',
      originalText: 'Compare to last month',
      selector: 'div.hero > p'
    }
  ]
};

const variant = {
  id: 'v1',
  label: 'Copy 1',
  nodes: [
    { id: 'n0', path: 0, role: 'heading', text: 'This month vs. last month' },
    { id: 'n1', path: 1, role: 'text', text: 'See trends at a glance' }
  ]
};

const changes = collectCopyChanges({ session, variant });
assert.strictEqual(changes.length, 2);
assert.strictEqual(changes[0].oldText, 'This month');
assert.strictEqual(changes[0].newText, 'This month vs. last month');

const { prompt } = buildCompactCopyPrompt({ session, variant });
assert.ok(prompt.includes('Update UI copy in source files.'));
assert.ok(
  prompt.includes(
    'Search the repo for each Old string and update every occurrence across the product'
  )
);
assert.ok(prompt.includes('"This month" → "This month vs. last month"'));
assert.ok(prompt.includes('"Compare to last month" → "See trends at a glance"'));
assert.ok(!prompt.includes('| Field | Selector | Old | New |'));
assert.ok(prompt.length < 800, 'compact prompt should stay short');

const editChanges = collectCopyChangesFromEdits({
  session,
  nodes: [
    { path: 0, role: 'heading', text: 'This month vs. last month', editable: true },
    { path: 1, role: 'text', text: 'See trends at a glance', editable: true }
  ]
});
assert.strictEqual(editChanges.length, 2);
assert.strictEqual(editChanges[0].oldText, 'This month');
assert.strictEqual(editChanges[0].newText, 'This month vs. last month');

const manualPrompt = buildCompactCopyPrompt({
  session,
  nodes: [
    { path: 0, role: 'heading', text: 'This month vs. last month', editable: true }
  ],
  label: 'Manual edits'
});
assert.ok(manualPrompt.prompt.includes('Option: Manual edits'));
assert.ok(
  manualPrompt.prompt.includes('"This month" → "This month vs. last month"')
);

console.log('test-copy-prompt: ok');
