'use strict';

/**
 * Figma “Crank Copy” plugin parity — prompt shape, field vocabulary, JSON response parsing.
 * Keep in sync with crank-copy code.ts PROMPT_TEMPLATE + ui.html buildPrompt().
 */

const STRING_TYPE_OPTIONS = [
  'General UI string',
  'Action menu',
  'Button',
  'Dialog',
  'Error',
  'Feedback (e.g. toasts)',
  'File upload',
  'Placeholder text',
  'Sidebar',
  'Tables (bulk selection, sort, statuses)',
  'Forms and inputs (cards, fields, dropdown, checkbox, radio, toggle, switch, slider)',
  'Tooltip (popover)',
  'Hyperlink',
  'Pendo'
];

const TIMING_OPTIONS = ['Before', 'After'];
const USER_TYPE_OPTIONS = ['Fleet user', 'Driver'];

const STRING_TYPE_DEFAULTS = {
  'General UI string': 'Before',
  Button: 'Before',
  Dialog: 'After',
  Error: 'After'
};

const PROMPT_TEMPLATE = `Source: {{SOURCE}}

1. Human-written string: {{HUMAN_STRINGS}}
2. Component type: {{COMPONENT_TYPE}}
3. Timing: {{TIMING}} user action
4. Functional requirements:
   - Fleet user or driver: {{USER_TYPE}}
   - How did they get to this screen: {{ENTRY_POINT}}
   - What is the user trying to do: {{USER_GOAL}}
   - What happens next: {{NEXT_STEP}}
   - What are the action options for the user: {{ACTION_OPTIONS}}
   - What do the other existing strings around the component say: {{SURROUNDING_STRINGS}}
   - PRD/PDP link: {{PRD_LINK}}
   - Additional context: {{ADDITIONAL_CONTEXT}}

The agent will follow the UI writing rules and string patterns in this doc: https://k2labs.atlassian.net/wiki/spaces/AD2/pages/6454837249

The agent will follow the US English capitalization rules in this doc: https://docs.google.com/spreadsheets/d/1_CldJmSfW0Nh3zRDapKcXNB13IMVkC2BKkJI8E3XZo8/edit?gid=553787719#gid=553787719`;

const FIELD_CONTINUATION_INDENT = '     ';

function fieldValue(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'Not provided';
  return trimmed
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n' + FIELD_CONTINUATION_INDENT);
}

function defaultGleanContext(session = {}) {
  return {
    componentType: 'General UI string',
    timing: 'Before',
    userType: 'Fleet user',
    entryPoint: '',
    userGoal: '',
    nextStep: '',
    actionOptions: '',
    surroundingStrings: '',
    prdLink: '',
    additionalContext: '',
    humanStrings: ''
  };
}

function normalizeGleanContext(raw, session = {}) {
  const base = defaultGleanContext(session);
  const ctx = raw && typeof raw === 'object' ? raw : {};
  return {
    componentType: String(ctx.componentType || base.componentType).trim(),
    timing: String(ctx.timing || base.timing).trim(),
    userType: String(ctx.userType || base.userType).trim(),
    entryPoint: String(ctx.entryPoint || base.entryPoint || ''),
    userGoal: String(ctx.userGoal || base.userGoal || ''),
    nextStep: String(ctx.nextStep || base.nextStep || ''),
    actionOptions: String(ctx.actionOptions || base.actionOptions || ''),
    surroundingStrings: String(ctx.surroundingStrings || base.surroundingStrings || ''),
    prdLink: String(ctx.prdLink || base.prdLink || ''),
    additionalContext: String(ctx.additionalContext || base.additionalContext || ''),
    humanStrings: String(
      ctx.humanStrings ||
        ctx.strings ||
        session.combinedText ||
        ''
    ).trim()
  };
}

function isValidUrl(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Required fields mirror Figma generate-btn gating (PRD optional if empty).
 * Optional text fields: actionOptions, surroundingStrings, additionalContext.
 */
function validateGleanContext(ctx) {
  const c = normalizeGleanContext(ctx);
  const errors = [];
  const fieldErrors = {};

  const requiredMsg = 'This field is required.';
  if (!c.humanStrings.trim()) {
    errors.push(requiredMsg);
    fieldErrors.humanStrings = requiredMsg;
  }
  if (!STRING_TYPE_OPTIONS.includes(c.componentType)) {
    errors.push(requiredMsg);
    fieldErrors.componentType = requiredMsg;
  }
  if (!TIMING_OPTIONS.includes(c.timing)) {
    errors.push(requiredMsg);
    fieldErrors.timing = requiredMsg;
  }
  if (!USER_TYPE_OPTIONS.includes(c.userType)) {
    errors.push(requiredMsg);
    fieldErrors.userType = requiredMsg;
  }
  if (!c.entryPoint.trim()) {
    errors.push(requiredMsg);
    fieldErrors.entryPoint = requiredMsg;
  }
  if (!c.userGoal.trim()) {
    errors.push(requiredMsg);
    fieldErrors.userGoal = requiredMsg;
  }
  if (!c.nextStep.trim()) {
    errors.push(requiredMsg);
    fieldErrors.nextStep = requiredMsg;
  }
  if (c.prdLink.trim() && !isValidUrl(c.prdLink)) {
    const msg = 'Enter a valid link, like https://…';
    errors.push(msg);
    fieldErrors.prdLink = msg;
  }

  return { ok: !errors.length, errors, fieldErrors, context: c };
}

function applyPromptTemplate(template, values) {
  return String(template || PROMPT_TEMPLATE).replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key) => values[key] || ''
  );
}

/**
 * Build the same prompt shape as Figma Crank Copy (ui.html buildPrompt).
 * @param {object} ctx
 * @param {{ source?: string }} [opts]
 */
function buildFigmaStylePrompt(ctx, opts = {}) {
  const c = normalizeGleanContext(ctx);
  const source = String(
    opts.source || process.env.GLEAN_AGENT_SOURCE || 'figma-plugin'
  ).trim();
  const values = {
    SOURCE: source,
    HUMAN_STRINGS: c.humanStrings,
    COMPONENT_TYPE: c.componentType,
    TIMING: c.timing,
    USER_TYPE: c.userType,
    ENTRY_POINT: fieldValue(c.entryPoint),
    USER_GOAL: fieldValue(c.userGoal),
    NEXT_STEP: fieldValue(c.nextStep),
    ACTION_OPTIONS: fieldValue(c.actionOptions),
    SURROUNDING_STRINGS: fieldValue(c.surroundingStrings),
    PRD_LINK: fieldValue(c.prdLink),
    ADDITIONAL_CONTEXT: fieldValue(c.additionalContext)
  };
  return applyPromptTemplate(PROMPT_TEMPLATE, values);
}

function unescapeLiteralNewlines(text) {
  return String(text || '').replace(/\\r\\n|\\n|\\r/g, '\n');
}

function parseCopywritingAgentJson(rawText) {
  let jsonText = String(rawText || '').trim();
  if (!jsonText) return { cards: null, table: '', rawText: '' };
  const fenced =
    jsonText.match(/```json\s*([\s\S]*?)\s*```/) ||
    jsonText.match(/```\s*([\s\S]*?)\s*```/);
  if (fenced) jsonText = fenced[1];
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  const candidates = [jsonText];
  if (start !== -1 && end > start) {
    candidates.push(jsonText.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      let cards = null;
      if (parsed.cards && Array.isArray(parsed.cards.options)) {
        cards = parsed.cards;
      } else if (Array.isArray(parsed.cards)) {
        cards = { options: parsed.cards };
      } else if (Array.isArray(parsed.options)) {
        cards = { options: parsed.options };
      }
      const table =
        typeof parsed.table === 'string'
          ? unescapeLiteralNewlines(parsed.table).trim()
          : '';
      return { cards, table, rawText: String(rawText || '') };
    } catch {
      // try next
    }
  }
  return { cards: null, table: '', rawText: String(rawText || '') };
}

const GRADE_LABELS = {
  clear: 'Clarity',
  consistent: 'Consistency',
  concise: 'Conciseness',
  conversational: 'Conversation',
  coaching: 'Coaching'
};

function formatGradesForPanel(grades) {
  if (!grades || typeof grades !== 'object') return '';
  const parts = [];
  for (const [key, label] of Object.entries(GRADE_LABELS)) {
    const g = grades[key];
    if (!g || typeof g !== 'object') continue;
    const score = String(g.score || '').trim();
    const explanation = String(g.explanation || g.rationale || '').trim();
    if (!score && !explanation) continue;
    parts.push(
      `${label}: ${score || '—'}${explanation ? ` — ${explanation}` : ''}`
    );
  }
  return parts.join(' · ');
}

/**
 * Map copywriting agent cards.options → Crank variant[] (before node zip).
 * @param {object} parsed - parseCopywritingAgentJson result
 * @param {number} maxOptions
 */
function variantsFromCopywritingCards(parsed, maxOptions = 10) {
  const options =
    parsed && parsed.cards && Array.isArray(parsed.cards.options)
      ? parsed.cards.options
      : [];
  if (!options.length) return [];

  const cap = Math.min(Math.max(Number(maxOptions) || 10, 2), 12);
  const variants = [];
  for (let i = 0; i < Math.min(options.length, cap); i++) {
    const option = options[i] || {};
    const text = String(option.string || '').trim();
    if (!text) continue;
    const gradesNote = formatGradesForPanel(option.grades);
    const human = option.isHumanWritten === true;
    variants.push({
      id: `glean-option-${i + 1}`,
      label: human ? `Option ${i + 1} (original)` : `Option ${i + 1}`,
      summary: text.slice(0, 240),
      fields: { body: text },
      nodes: [{ path: '0', role: 'text', text }],
      recommended: false,
      isHumanWritten: human,
      scores: gradesNote || undefined,
      rawOption: option
    });
  }
  return variants;
}

module.exports = {
  STRING_TYPE_OPTIONS,
  TIMING_OPTIONS,
  USER_TYPE_OPTIONS,
  STRING_TYPE_DEFAULTS,
  defaultGleanContext,
  normalizeGleanContext,
  validateGleanContext,
  buildFigmaStylePrompt,
  parseCopywritingAgentJson,
  variantsFromCopywritingCards,
  formatGradesForPanel,
  isValidUrl
};
