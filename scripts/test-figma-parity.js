#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildFigmaStylePrompt,
  validateGleanContext,
  parseCopywritingAgentJson
} = require('../lib/figma-parity');
const {
  parseOptionsFromAgentText,
  mapCardOptionsToVariants
} = require('../companion/glean-client');

const session = {
  nodes: [
    { path: '0', role: 'heading', text: 'Fuel trends', originalText: 'Fuel trends' },
    { path: '1', role: 'text', text: 'Compare this month', originalText: 'Compare this month' }
  ],
  combinedText: 'Fuel trends\nCompare this month'
};

const validation = validateGleanContext({
  humanStrings: 'Heading: Fuel trends\nBody: Compare this month',
  componentType: 'General UI string',
  timing: 'Before',
  userType: 'Fleet user',
  entryPoint: 'Dashboard → Reports',
  userGoal: 'Understand fuel usage',
  nextStep: 'User reviews chart'
});
assert(validation.ok && validation.fieldErrors, 'validation ok');
const bad = validateGleanContext({ humanStrings: '' });
assert(!bad.ok && bad.fieldErrors.humanStrings, 'required strings');
const ctx = validation.context;

const prompt = buildFigmaStylePrompt(ctx, { source: 'figma-plugin' });
assert(prompt.includes('Source: figma-plugin'), 'source line');
assert(prompt.includes('Dashboard → Reports'), 'entry point');
assert(prompt.includes('Before user action'), 'timing');

const agentJson = JSON.stringify({
  cards: {
    options: [
      {
        string:
          'Heading: Fuel efficiency\nBody: Compare this month vs last',
        grades: { clear: { score: 'Strong', explanation: 'Direct' } }
      },
      {
        string: 'Heading: Fuel trends\nBody: See month-over-month fuel',
        grades: { concise: { score: 'Good', explanation: 'Short' } }
      }
    ]
  },
  table:
    '| Option 1 | Heading: Fuel efficiency | Body: Compare this month vs last |\n' +
    '| Option 2 | Heading: Fuel trends | Body: See month-over-month fuel |'
});

const parsed = parseCopywritingAgentJson(agentJson);
assert(parsed.table.includes('Option 1'), 'table parsed');
assert(parsed.cards.options.length === 2, 'cards parsed');

const fromCards = mapCardOptionsToVariants(parsed, session, 5);
assert(fromCards.length >= 1, 'card mapping');

const tableOnly = parseOptionsFromAgentText(agentJson, session, 5);
assert(
  tableOnly.some((v) => v.id && v.id.startsWith('glean-option')),
  'table-first mapping'
);

console.log('test-figma-parity: ok');
