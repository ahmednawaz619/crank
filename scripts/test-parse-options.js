#!/usr/bin/env node
'use strict';

/**
 * Assert Glean option markdown parses into distinct Heading / Body / CTA
 * (and Body 1..N) node texts — not one mashed string.
 */

const assert = require('assert');
const {
  parseOptionsFromText,
  formatDraft,
  buildAgentInput
} = require('../companion/glean-client.js');

const classicMd = `
| Option | Copy |
| --- | --- |
| **Option 1 (original)** | Heading: Welcome back, dispatcher<br>Body: Review yesterday's safety events before your shift starts.<br>CTA: Open safety feed |
| **Option 2 (AI-written) ✅ Recommended** | Heading: Review yesterday's safety events<br>Body: Check for issues before you start your shift.<br>CTA: Go to Safety Hub |
`;

const bodyNMd = `
| **Option 1 (original)** | Heading: Cursor MCP (Agent handoff) Body 1: MCP cannot push into Cursor chat by itself. Body 2: Point .cursor/mcp.json at vizcopy. Body 3: Reload MCP after config changes. CTA: Open Cursor |
| **Option 2 (AI-written) ✅ Recommended** | Heading: Hand off to Cursor Agent<br>Body 1: The agent must call tools — MCP cannot push chat alone.<br>Body 2: Confirm .cursor/mcp.json for vizcopy.<br>Body 3: Reload MCP servers after changes.<br>CTA: Apply pending change |
`;

// Robot Content Designer score/rubric columns after Heading/Body/CTA
const scoredMd = `
| Option | Heading | Body | CTA | Information density | Pattern packing | Length | Voice | Clarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Option 1 (original)** | Heading: Open the Companion panel<br>Body: Use Get options, then Preview or Apply.<br>CTA: Open panel |Good Baseline density.|No Pattern|Weak A bit short.|Good Neutral tone.|Good Clear steps. |
| **Option 2 (AI-written) ✅ Recommended** | Heading: Finish in the Companion<br>Body: In the panel, click Agent and confirm the prefilled chat, or type: Apply the pending Crank change.|Good Drops the redundant "no public API" line; each sentence adds new information.|No Pattern|Weak Still ~90 words; second-longest option in the set.|Good Positive contraction ("there's") and active voice read more human.|Good Steps use clear imperative verbs. |
`;

const classicSession = {
  nodes: [
    { path: '0', role: 'heading', selector: 'h1', text: 'Welcome back, dispatcher' },
    {
      path: '1',
      role: 'text',
      selector: 'p',
      text: "Review yesterday's safety events before your shift starts."
    },
    { path: '2', role: 'action', selector: 'button', text: 'Open safety feed' }
  ]
};

const multiBodySession = {
  nodes: [
    { path: '0', role: 'heading', selector: 'h2', text: 'Cursor MCP (Agent handoff)' },
    { path: '1', role: 'text', selector: 'p', text: 'old body 1' },
    { path: '2', role: 'text', selector: 'li:1', text: 'old body 2' },
    { path: '3', role: 'text', selector: 'li:2', text: 'old body 3' },
    { path: '4', role: 'action', selector: 'a', text: 'Open Cursor' }
  ]
};

function assertDistinctTexts(nodes, expected) {
  assert.strictEqual(nodes.length, expected.length, 'node count');
  for (let i = 0; i < expected.length; i++) {
    assert.strictEqual(
      nodes[i].text,
      expected[i],
      `node[${i}] text mismatch`
    );
  }
  const unique = new Set(nodes.map((n) => n.text));
  assert.strictEqual(
    unique.size,
    expected.length,
    'expected distinct node texts (no single-string mash)'
  );
}

// Classic Heading / Body / CTA
{
  const variants = parseOptionsFromText(classicMd, classicSession);
  assert.ok(variants.length >= 1, 'classic: expected >=1 new option after filter');
  assert.ok(
    !variants.some((v) => /original/i.test(v.label)),
    'classic: no label should contain "original"'
  );
  const v1 = variants.find((v) => /recommended/i.test(v.label));
  assert.ok(v1, 'classic: recommended option is renumbered to option 1');
  assert.strictEqual(v1.id, 'glean-option-1');
  assert.strictEqual(v1.fields.heading, "Review yesterday's safety events");
  assert.strictEqual(
    v1.fields.body,
    'Check for issues before you start your shift.'
  );
  assert.strictEqual(v1.fields.cta, 'Go to Safety Hub');
  assertDistinctTexts(v1.nodes, [
    "Review yesterday's safety events",
    'Check for issues before you start your shift.',
    'Go to Safety Hub'
  ]);
}

// Body 1 / Body 2 / Body 3 (same-line + <br>) — the live failure mode
{
  const variants = parseOptionsFromText(bodyNMd, multiBodySession);
  assert.ok(variants.length >= 1, 'bodyN: expected >=1 new option after filter');
  const v1 = variants.find((v) => v.id === 'glean-option-1');
  assert.ok(v1, 'bodyN: option 1');
  assert.strictEqual(v1.fields.heading, 'Hand off to Cursor Agent');
  assert.ok(
    Array.isArray(v1.fields.bodies) && v1.fields.bodies.length === 3,
    'bodyN: fields.bodies has 3 entries'
  );
  assert.ok(
    !String(v1.fields.heading || '').includes('Body 1:'),
    'heading must not swallow Body 1..N'
  );
  assertDistinctTexts(v1.nodes, [
    'Hand off to Cursor Agent',
    'The agent must call tools — MCP cannot push chat alone.',
    'Confirm .cursor/mcp.json for vizcopy.',
    'Reload MCP servers after changes.',
    'Apply pending change'
  ]);
  assert.ok(/recommended/i.test(v1.label), 'bodyN: recommended is option 1');
}

// Score/rubric pipe columns must never land in Body / CTA / nodes
{
  const scoredSession = {
    nodes: [
      { path: '0', role: 'heading', selector: 'h2', text: 'old heading' },
      { path: '1', role: 'text', selector: 'p', text: 'old body' },
      { path: '2', role: 'action', selector: 'button', text: 'old cta' }
    ]
  };
  const variants = parseOptionsFromText(scoredMd, scoredSession);
  assert.ok(variants.length >= 1, 'scored: expected >=1 new option after filter');

  const v1 = variants.find((v) => v.id === 'glean-option-1');
  assert.ok(v1, 'scored: option 1');
  assert.ok(/recommended/i.test(v1.label), 'scored: recommended is option 1');
  assert.strictEqual(v1.fields.heading, 'Finish in the Companion');
  assert.strictEqual(
    v1.fields.body,
    'In the panel, click Agent and confirm the prefilled chat, or type: Apply the pending Crank change.'
  );
  assert.ok(
    !v1.fields.cta || !/Good |Weak |No Pattern/i.test(v1.fields.cta),
    'scored: cta must not include rubric cells'
  );
  assert.ok(
    !/\|Good |Good Drops|No Pattern|Weak Still|Positive contraction/i.test(
      v1.fields.body || ''
    ),
    'scored: recommended body must not include rubric prose'
  );
  for (const n of v1.nodes) {
    assert.ok(
      !/Good Drops|No Pattern|Weak Still|imperative verbs/i.test(n.text || ''),
      `scored: node text must be clean: ${n.text}`
    );
  }
  assert.strictEqual(
    v1.nodes.find((n) => n.role === 'text')?.text,
    'In the panel, click Agent and confirm the prefilled chat, or type: Apply the pending Crank change.'
  );
}

// Flexible Copy 1 / Copy 2 (no forced Heading/Body/CTA)
const copyUnitsSession = {
  nodes: [
    { path: '0', role: 'text', selector: 'p:1', text: 'First paragraph.' },
    { path: '1', role: 'text', selector: 'p:2', text: 'Second paragraph.' },
    { path: '2', role: 'text', selector: 'p:3', text: 'Third paragraph.' }
  ]
};

const copyUnitsMd = `
| **Option 1 (original)** | Copy 1: First paragraph.<br>Copy 2: Second paragraph.<br>Copy 3: Third paragraph. |
| **Option 2 (AI-written) ✅ Recommended** | Copy 1: Para one.<br>Copy 2: Para two.<br>Copy 3: Para three. |
`;

// Draft numbering for multi-body selections
{
  const draft = formatDraft(multiBodySession);
  assert.ok(draft.includes('Heading:'), 'draft has Heading');
  assert.ok(draft.includes('Body 1:'), 'draft numbers Body 1');
  assert.ok(draft.includes('Body 2:'), 'draft numbers Body 2');
  assert.ok(draft.includes('Body 3:'), 'draft numbers Body 3');
  assert.ok(draft.includes('CTA:'), 'draft has CTA');
  assert.ok(!/\nBody: /.test('\n' + draft), 'draft should not use bare Body: when multi');
}

// Arbitrary copy units use Copy N labels in draft
{
  const draft = formatDraft(copyUnitsSession);
  assert.ok(draft.includes('Copy 1:'), 'flex draft has Copy 1');
  assert.ok(draft.includes('Copy 2:'), 'flex draft has Copy 2');
  assert.ok(draft.includes('Copy 3:'), 'flex draft has Copy 3');
  assert.ok(!/\nHeading:/.test('\n' + draft), 'flex draft must not invent Heading');
}

// Copy 1..N parse + 1:1 node mapping
{
  const variants = parseOptionsFromText(copyUnitsMd, copyUnitsSession);
  assert.ok(variants.length >= 1, 'copyUnits: expected >=1 new option after filter');
  const v1 = variants.find((v) => v.id === 'glean-option-1');
  assert.ok(v1, 'copyUnits: recommended is option 1');
  assert.ok(/recommended/i.test(v1.label), 'copyUnits: option 1 is recommended');
  assertDistinctTexts(v1.nodes, ['Para one.', 'Para two.', 'Para three.']);
  for (const v of variants) {
    for (const n of v.nodes) {
      assert.ok(
        !['First paragraph.', 'Second paragraph.', 'Third paragraph.'].includes(
          n.text
        ),
        'copyUnits: no variant should repeat original draft copy'
      );
    }
  }
}

// Per-request option count in agent input
{
  const input = buildAgentInput(classicSession, { optionCount: 5 });
  assert.strictEqual(input._crankOptionCount, 5);
  const feature = input['Explain the functionality of the feature'];
  assert.match(feature, /Return exactly 5/);
  assert.match(feature, /new rewritten alternatives/i);
  assert.match(feature, /do not include the original draft/i);
}

console.log('ok — parse options keep clean field labels (scores stripped)');
