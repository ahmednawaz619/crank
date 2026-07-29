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

// Copy N must map to session node N-1 — junk Copy 1 ("/") must not shift prompts
{
  const statNodes = [
    {
      path: '0',
      role: 'text',
      text: 'Current vs. previous month',
      originalText: 'Current vs. previous month',
      editable: true,
      textSource: { type: 'static-label' }
    },
    {
      path: '1',
      role: 'text',
      text: '285',
      originalText: '285',
      editable: false,
      textSource: { type: 'dynamic-data' }
    },
    {
      path: '2',
      role: 'text',
      text: 'Total',
      originalText: 'Total',
      editable: true,
      textSource: { type: 'static-label' }
    }
  ];
  const { parseOptionsFromText, formatDraft } = require('../companion/glean-client.js');
  const draft = formatDraft({ nodes: statNodes });
  assert.ok(draft.includes('Current vs. previous month'));
  assert.ok(draft.includes('Total'));
  assert.ok(!draft.includes('285'), 'dynamic stat must not be sent to Glean');

  const shiftedMd =
    '| **Option 1 ✅ Recommended** | Copy 1: /<br>Copy 2: This month vs. last month<br>Copy 3: 285<br>Copy 4: Total |';
  const variant = parseOptionsFromText(shiftedMd, { nodes: statNodes })[0];
  const dynamicNode = variant.nodes.find((n) => n.path === '1');
  assert.strictEqual(dynamicNode.text, '285', 'dynamic node keeps runtime value');
  const changes = collectCopyChanges({ session: { nodes: statNodes }, variant });
  assert.strictEqual(changes.length, 1, 'only static Copy 2 should change');
  assert.strictEqual(changes[0].label, 'Copy 2');
  assert.strictEqual(changes[0].oldText, 'Current vs. previous month');
  assert.strictEqual(changes[0].newText, 'This month vs. last month');
  assert.ok(
    !changes.some((c) => c.oldText === '285' || c.newText === '285'),
    'dynamic values must not appear in copy prompt'
  );
}

console.log('test-copy-prompt: ok');
