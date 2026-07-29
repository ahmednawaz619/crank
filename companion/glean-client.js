'use strict';

/**
 * Glean agent client for Crank.
 * Uses short form payloads (long feature/proactive strings → HTTP 400).
 *
 * Streaming: POST /agents/runs/stream returns SSE `event: message` chunks.
 * Motive Robot Content Designer typically emits a quick USER ack, then ~55–90s
 * of silence while the agent runs, then GLEAN_AI token deltas until done
 * (~90–140s total). Stream vs /runs/wait does not materially change latency —
 * both block until the agent finishes. Stream only adds live progress UI.
 * Set GLEAN_USE_STREAM=false to force wait-only.
 *
 * Option count: CRANK_GLEAN_OPTION_COUNT (default 3). Fewer options may reduce
 * agent work slightly; most latency is inherent agent runtime (~1–2 min).
 */

const fs = require('fs');
const path = require('path');
const { env, envInt } = require('../lib/env');
const {
  unitDraftLabel,
  assignUnitLabels,
  hasSemanticStructure
} = require('../lib/copy-labels');
const {
  gleanEligibleNodes,
  mergeVariantNodes,
  isExcludedGleanValue
} = require('../lib/copy-dynamic');

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');
const DEFAULT_AGENT_ID = 'a866095fd53b419ab08338e3559fb7aa';
const STREAM_FIRST_BYTE_MS = Number(process.env.GLEAN_STREAM_FIRST_BYTE_MS || 12000);
const WAIT_HEARTBEAT_MS = Number(process.env.GLEAN_WAIT_HEARTBEAT_MS || 3500);
/** Overall cap for /runs/wait and stream-to-completion (Robot Content Designer ~90–140s). */
const GLEAN_AGENT_TIMEOUT_MS = Number(
  process.env.GLEAN_AGENT_TIMEOUT_MS || 300000
);
/** Max copy options to parse/return (default 3; was 4, was 6). */
const DEFAULT_OPTION_COUNT = envInt('GLEAN_OPTION_COUNT', 3);

function extractAiDelta(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const parts = [];
  for (const msg of messages) {
    const role = String(msg.role || msg.author || '').toUpperCase();
    if (role === 'USER') continue;
    const content = msg.content || msg.fragments || [];
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('');
}

/** One-line status for UI: tail of stream text so it visibly changes each token. */
function extractLatestThought(text, fallback = 'Working…') {
  const raw = String(text || '').trim();
  if (!raw) return fallback;

  const compact = raw.replace(/\s+/g, ' ').trim();
  if (compact.length > 16) {
    const tail = compact.slice(-160).trim();
    if (tail.length >= 6) return tail;
  }

  const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 2);
  if (sentences.length) {
    const last = sentences[sentences.length - 1].trim();
    if (last.length <= 220 && !/^\|/.test(last) && !/^[-*#]{2,}/.test(last)) {
      return last.slice(0, 220);
    }
  }

  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\|[-:\s|]+\|$/.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 1) {
        const label = cells[0].replace(/\*\*/g, '').trim();
        if (/option\s*\d/i.test(label)) return `Drafting ${label}…`;
        if (cells[1] && cells[1].length < 100) {
          return cells[1].replace(/\*\*/g, '').slice(0, 180);
        }
      }
      continue;
    }
    if (/^(Heading|Body|CTA|Copy\s*\d+)/i.test(line)) return line.slice(0, 180);
    if (line.length > 3 && !/^```/.test(line)) return line.slice(0, 180);
  }

  return compact.slice(0, 180) || fallback;
}

function loadSkillsContext() {
  const files = [];
  try {
    for (const name of fs.readdirSync(SKILLS_DIR)) {
      if (!/\.(md|txt)$/i.test(name)) continue;
      files.push({
        name,
        content: fs.readFileSync(path.join(SKILLS_DIR, name), 'utf8').slice(0, 8000)
      });
    }
  } catch {
    // optional
  }
  return files;
}

function stubVariants(session) {
  const allNodes = assignUnitLabels(Array.isArray(session.nodes) ? session.nodes : []);
  const nodes = gleanEligibleNodes(allNodes);
  const base = nodes.map((n, i) => {
    const path = n.path != null ? String(n.path) : String(i);
    return {
      id: n.id || `copy-${path}`,
      path,
      role: n.role || 'text',
      text: n.text,
      selector: n.selector,
      originalText:
        n.originalText != null ? String(n.originalText) : String(n.text || '')
    };
  });

  const mk = (id, label, transform) => {
    const mapped = base.map((n) => ({
      id: n.id,
      path: n.path,
      role: n.role,
      selector: n.selector,
      originalText: n.originalText,
      text: transform(String(n.text || ''))
    }));
    const fields = {};
    mapped.forEach((n, idx) => {
      const role = String(n.role || 'text').toLowerCase();
      if (role === 'heading' && fields.heading == null) fields.heading = n.text;
      else if (
        (role === 'action' || role === 'button') &&
        fields.cta == null
      ) {
        fields.cta = n.text;
      } else if (fields.body == null && !hasSemanticStructure(mapped)) {
        fields[`copy${idx + 1}`] = n.text;
      } else if (fields.body == null) {
        fields.body = n.text;
      }
    });
    return {
      id,
      label,
      summary: `${label} pass over ${base.length} copy unit(s)`,
      fields,
      nodes: mapped
    };
  };

  return [
    mk('glean-stub-concise', 'Concise', (t) =>
      t.replace(/\s+/g, ' ').trim().replace(/\.$/, '')
    ),
    mk('glean-stub-clear', 'Clearer', (t) =>
      t.trim().length ? `${t.trim().replace(/\.$/, '')}.` : t
    ),
    mk('glean-stub-action', 'More actionable', (t) => {
      const trimmed = t.trim();
      if (!trimmed) return trimmed;
      if (/^(get|start|try|open|view|add|create|save)/i.test(trimmed)) return trimmed;
      return `Try: ${trimmed}`;
    }),
    mk('glean-stub-tone', 'Product tone', (t) =>
      t.replace(/\butilize\b/gi, 'use').replace(/\bleverage\b/gi, 'use')
    )
  ];
}

function authHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.GLEAN_API_KEY}`,
    ...extra
  };
  if (process.env.GLEAN_ACT_AS) {
    headers['X-Glean-ActAs'] = process.env.GLEAN_ACT_AS;
  }
  return headers;
}

function baseUrl() {
  const raw =
    process.env.GLEAN_BASE_URL ||
    process.env.GLEAN_API_URL ||
    'https://motive-prod-be.glean.com';
  return String(raw).replace(/\/+$/, '').replace(/\/rest\/api\/v1.*$/i, '');
}

/**
 * Build Robot Content Designer form fields.
 * Keep payloads short (long feature/proactive strings → HTTP 400) but always
 * include the real selected Heading/Body/CTA so the agent rewrites those strings.
 * Component type must match the agent's vocabulary or it asks clarifying questions
 * and falls back to generic assumptions.
 */
function formatDraft(session) {
  const allNodes = assignUnitLabels(
    Array.isArray(session.nodes) ? session.nodes : []
  );
  const nodes = gleanEligibleNodes(allNodes);
  if (!nodes.length) {
    return '';
  }
  return nodes
    .map((n) => {
      const label =
        n.label ||
        unitDraftLabel(n, n._sessionIndex != null ? n._sessionIndex : 0, allNodes);
      return `${label}: ${String(n.text || '').trim()}`;
    })
    .join('\n')
    .slice(0, 1500);
}

function draftLabelHint(session) {
  const allNodes = assignUnitLabels(
    Array.isArray(session.nodes) ? session.nodes : []
  );
  const nodes = gleanEligibleNodes(allNodes);
  if (!nodes.length) return 'Copy 1:';
  if (hasSemanticStructure(allNodes)) {
    const labels = nodes.map(
      (n) =>
        n.label ||
        unitDraftLabel(n, n._sessionIndex != null ? n._sessionIndex : 0, allNodes)
    );
    return labels.join(', ');
  }
  if (nodes.length === 1) return 'Copy 1:';
  return 'Copy 1:, Copy 2:, … (same count as draft)';
}

function buildAgentInput(session, options = {}) {
  const draft = formatDraft(session);
  const optionCount = Math.min(
    Math.max(
      Number(options.optionCount || options.variantCount || DEFAULT_OPTION_COUNT) ||
        DEFAULT_OPTION_COUNT,
      2
    ),
    6
  );
  // Short feature blurb — long strings → HTTP 400. Ask for copy-only output (no rubric).
  const labelHint = draftLabelHint(session);
  const feature =
    options.feature ||
    (draft
      ? `Return exactly ${optionCount} new rewritten alternatives only — do not include the original draft as an option. Label fields like the draft (${labelHint}). Each field value must be UI copy only — no inline scores (Strong/Weak/Good), no rationale about the draft, no pipe rubric columns. Table only. No questions.`
      : `Return exactly ${optionCount} new UI copy alternatives only (not the original draft). No clarifying questions.`);

  return {
    'Enter in a human-written draft': draft,
    'Explain the functionality of the feature': String(feature).slice(0, 220),
    'Proactive or reactive': options.proactiveOrReactive || 'Proactive',
    // Must be from agent vocabulary (e.g. General UI string) — not "Hero / landing card"
    'Type of component': options.componentType || 'General UI string',
    'What is the difficulty of the user experience':
      options.uxDifficulty || 'Easy',
    _crankOptionCount: optionCount
  };
}

function extractMessageText(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const parts = [];
  for (const msg of messages) {
    if (msg.role && String(msg.role).toUpperCase() === 'USER') continue;
    const content = msg.content || msg.fragments || [];
    if (typeof content === 'string') {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block.text === 'string') parts.push(block.text);
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * Robot Content Designer tables append rubric/score cells after Heading/Body/CTA:
 *   |Good …|No Pattern|Weak …|
 * Inline scores also appear after field labels:
 *   Copy 3: Strong Fixes the … from the draft, and "Actual copy" reads instantly…
 * Those are evaluation notes — never user-facing copy.
 */
const SCORE_CELL_RE = /\|\s*(?:Good|Weak|No\s+Pattern)\b/i;
const INLINE_SCORE_PREFIX_RE =
  /^(?:(?:Strong|Weak|Good|Fair|Poor|Excellent|Acceptable|No\s+Pattern)\s*[-–—:]?\s*)+/i;
const META_RATIONALE_RE =
  /\b(?:fixes?|addresses?|corrects?|resolves?)\s+the\b|\bfrom the draft\b|\breads instantly\b|\brequiring the user\b|\bsingular\/plural\b|\bthis option\b|\bthe draft\b|\bwithout requiring\b/i;

function trimTableCell(value) {
  return stripCellDelimiterArtifacts(
    String(value || '')
      .replace(/\s*\|\s*$/g, '')
      .replace(/^\s*\|\s*/g, '')
      .trim()
  );
}

/** Strip markdown table cell delimiter junk (pipes, stray slashes/backslashes at edges). */
function stripCellDelimiterArtifacts(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  // Trailing row/cell markers — require whitespace before "/" so "50/50" stays intact.
  s = s.replace(/\s+\/\s*$/g, '').replace(/\\+\s*$/g, '');
  // Leading escaped line breaks from broken table cells.
  s = s.replace(/^\s*\\+/g, '');
  // Residual pipe fragments at edges (after trimTableCell pass).
  s = s.replace(/^\s*\|+\s*/g, '').replace(/\s*\|+\s*$/g, '');
  return s.trim();
}

function splitCopyAndScores(block) {
  const text = String(block || '');
  const m = SCORE_CELL_RE.exec(text);
  if (!m || m.index == null) return { copy: text, scores: '' };
  return {
    copy: text.slice(0, m.index),
    scores: stripCellDelimiterArtifacts(
      text
        .slice(m.index)
        .replace(/^\|+/, '')
        .replace(/\s*\|\s*/g, ' · ')
        .replace(/\s+/g, ' ')
        .trim()
    )
  };
}

function stripInlineScorePrefix(text) {
  return String(text || '')
    .replace(INLINE_SCORE_PREFIX_RE, '')
    .trim();
}

/** Pull UI copy embedded in agent rationale, e.g. … and "This month vs. last month" reads instantly… */
function extractEmbeddedQuotedCopy(text) {
  const s = String(text || '');
  const andReads = s.match(
    /\band\s+"([^"]{2,200})"\s+(?:reads|is|was|sounds|works|feels|stays)\b/i
  );
  if (andReads && !META_RATIONALE_RE.test(andReads[1])) {
    return andReads[1].trim();
  }
  const quotes = [...s.matchAll(/"([^"]{2,200})"/g)].map((m) => m[1].trim());
  for (let i = quotes.length - 1; i >= 0; i--) {
    const q = quotes[i];
    if (q.length <= 120 && !META_RATIONALE_RE.test(q)) return q;
  }
  return null;
}

/** Drop agent rubric prose; keep only copy meant for the UI. */
function stripRationaleProse(text) {
  let s = stripInlineScorePrefix(text);
  if (!s) return '';
  if (!META_RATIONALE_RE.test(s)) return s;

  const embedded = extractEmbeddedQuotedCopy(s);
  if (embedded) return embedded;

  const tailParts = s.split(/\s*,\s*and\s+/i);
  if (tailParts.length > 1) {
    const tail = tailParts[tailParts.length - 1]
      .replace(/^["']|["']$/g, '')
      .replace(/\s+(?:reads|is|was|sounds|works|feels|stays)\b.*$/i, '')
      .trim();
    if (tail.length >= 2 && tail.length <= 160 && !META_RATIONALE_RE.test(tail)) {
      return tail;
    }
  }

  const sentences = s
    .split(/(?<=[.!?])\s+/)
    .map((sent) => sent.trim())
    .filter((sent) => sent && !META_RATIONALE_RE.test(sent));
  if (sentences.length) return sentences.join(' ').trim();
  return s;
}

function cleanCopyField(value) {
  const { copy } = splitCopyAndScores(value);
  return stripRationaleProse(
    trimTableCell(
      String(copy || '')
        .replace(/\|\s*\*{0,2}Option\s+\d+.*$/i, '')
        .replace(/\|+\s*$/g, '')
        .replace(/\*{1,2}/g, '')
        .replace(/^["'\s]+|["'\s]+$/g, '')
        .replace(/\s+/g, ' ')
    )
  );
}

/** Agent rubric / explanation stripped from a field (for feedback UI). */
function extractFieldRationale(value) {
  const raw = trimTableCell(value);
  if (!raw || !META_RATIONALE_RE.test(raw)) return '';
  const cleaned = cleanCopyField(raw);
  if (normalizeWs(cleaned) === normalizeWs(raw)) return '';
  return trimTableCell(stripInlineScorePrefix(raw)).slice(0, 400);
}

/**
 * Split a Glean option cell into labeled copy fields.
 * Supports Heading / Body / Body 1 / Body 2 / CTA on one line or many
 * (Robot Content Designer often emits Body N when the draft has multiple bodies).
 * Score/critique table cells after the copy are discarded from field values.
 */
function parseLabeledCopyFields(block) {
  const { copy: text } = splitCopyAndScores(block);
  // Copy 1 / Body 1 must match as their own labels (not swallowed by Heading / Body).
  const labelRe =
    /\b(Heading|CTA|Label|Body(?:\s*\d+)?|Copy(?:\s*\d+)?)\s*:/gi;
  const hits = [];
  let m;
  while ((m = labelRe.exec(text)) !== null) {
    hits.push({
      rawLabel: String(m[1] || '').replace(/\s+/g, ' ').trim(),
      labelStart: m.index,
      valueStart: m.index + m[0].length
    });
  }
  if (!hits.length) return [];

  const out = [];
  for (let i = 0; i < hits.length; i++) {
    const valueEnd = i + 1 < hits.length ? hits[i + 1].labelStart : text.length;
    const rawValue = trimTableCell(text.slice(hits[i].valueStart, valueEnd));
    const value = cleanCopyField(rawValue);
    if (!value || isExcludedGleanValue(value)) continue;
    const lower = hits[i].rawLabel.toLowerCase();
    let role = 'text';
    let key = 'body';
    if (lower === 'heading') {
      role = 'heading';
      key = 'heading';
    } else if (lower === 'cta') {
      role = 'action';
      key = 'cta';
    } else if (lower === 'label') {
      role = 'label';
      key = 'label';
    } else if (/^copy(?:\s*\d+)?$/.test(lower)) {
      role = 'text';
      key = lower.replace(/\s+/g, '');
    }
    out.push({
      key,
      role,
      label: hits[i].rawLabel,
      text: value,
      rawText: rawValue
    });
  }
  return out;
}

function fieldsFromLabeled(labeled) {
  const fields = {};
  const bodies = [];
  const copies = [];
  for (const f of labeled) {
    if (f.key === 'heading' && fields.heading == null) fields.heading = f.text;
    else if (f.key === 'cta' && fields.cta == null) fields.cta = f.text;
    else if (f.key === 'body') bodies.push(f.text);
    else if (/^copy\d+$/.test(f.key)) copies.push(f.text);
  }
  if (copies.length) {
    fields.copies = copies;
    if (copies.length === 1) fields.copy1 = copies[0];
  }
  if (bodies.length === 1) fields.body = bodies[0];
  else if (bodies.length > 1) {
    fields.body = bodies[0];
    fields.bodies = bodies;
  }
  return fields;
}

function assignmentListFromFields(fields = {}, labeled = null) {
  if (Array.isArray(labeled) && labeled.length) {
    return labeled
      .map((f) => ({
        role: f.role || 'text',
        value: cleanCopyField(f.text)
      }))
      .filter((a) => a.value && !isExcludedGleanValue(a.value));
  }
  const list = [];
  if (fields.heading) {
    list.push({ role: 'heading', value: cleanCopyField(fields.heading) });
  }
  if (Array.isArray(fields.bodies) && fields.bodies.length) {
    for (const b of fields.bodies) {
      const value = cleanCopyField(b);
      if (value) list.push({ role: 'text', value });
    }
  } else if (fields.body) {
    const value = cleanCopyField(fields.body);
    if (value) list.push({ role: 'text', value });
  }
  if (Array.isArray(fields.copies) && fields.copies.length) {
    for (const c of fields.copies) {
      const value = cleanCopyField(c);
      if (value) list.push({ role: 'text', value });
    }
  }
  if (fields.cta) {
    list.push({ role: 'action', value: cleanCopyField(fields.cta) });
  }
  return list;
}

function roleCompatible(assignRole, nodeRole) {
  const a = String(assignRole || 'text').toLowerCase();
  const n = String(nodeRole || 'text').toLowerCase();
  if (a === 'heading') return n === 'heading';
  if (a === 'action' || a === 'button') return n === 'action' || n === 'button';
  return n === 'text' || n === 'label' || n === 'body';
}

function normalizeWs(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Detect Glean "Option N (original)" rows — header tag or copy identical to session draft.
 */
function isOriginalVariant(headerMeta, mapped, nodes) {
  if (/human-written|\boriginal\b/i.test(String(headerMeta || ''))) {
    return true;
  }
  const sessionNodes = Array.isArray(nodes) ? nodes : [];
  const mappedList = Array.isArray(mapped) ? mapped : [];
  if (!sessionNodes.length || !mappedList.length) return false;

  let compared = 0;
  for (const m of mappedList) {
    const base = sessionNodes.find(
      (n) =>
        (m.id && n.id && m.id === n.id) ||
        (m.path != null &&
          n.path != null &&
          String(m.path) === String(n.path))
    );
    if (!base) continue;
    compared += 1;
    const orig =
      base.originalText != null
        ? String(base.originalText)
        : base.text != null
          ? String(base.text)
          : '';
    if (normalizeWs(m.text) !== normalizeWs(orig)) return false;
  }
  return compared > 0;
}

/**
 * Map Glean labeled fields onto selection nodes in order — skip junk values
 * without shifting (Copy 1: "/" must not push Copy 2 onto session node 2).
 */
function mapLabeledFieldsToNodes(mapped, labeled) {
  if (!Array.isArray(labeled) || !labeled.length || !mapped.length) {
    return mapped;
  }

  let nodeIdx = 0;
  for (const f of labeled) {
    const value = cleanCopyField(f.text);
    if (!value || isExcludedGleanValue(value)) continue;
    if (nodeIdx >= mapped.length) break;
    mapped[nodeIdx].text = value;
    mapped[nodeIdx].copyLabel = f.rawLabel || f.label || `Copy ${nodeIdx + 1}`;
    nodeIdx += 1;
  }

  return mapped;
}

/**
 * Map Glean Heading/Body/CTA (including Body 1..N) onto selected copy units 1:1.
 * Never blast one field onto every node that shares a role (e.g. all `text`).
 * When counts match, zip by order; otherwise exclusive role match then positional.
 */
function mapOptionFieldsToNodes(nodes, fields = {}, labeled = null) {
  const list = Array.isArray(nodes) ? nodes : [];
  const mapped = list.map((n, i) => {
    const path = n.path != null ? String(n.path) : String(i);
    return {
      id: n.id || `copy-${path}`,
      path,
      role: n.role || 'text',
      selector: n.selector,
      text: String(n.text != null ? n.text : ''),
      editable: n.editable,
      textSource: n.textSource,
      label: n.label,
      copyLabel: n.copyLabel,
      originalText:
        n.originalText != null
          ? String(n.originalText)
          : n.text != null
            ? String(n.text)
            : undefined
    };
  });

  if (Array.isArray(labeled) && labeled.length) {
    return mapLabeledFieldsToNodes(mapped, labeled);
  }

  const assignments = assignmentListFromFields(fields, labeled);
  if (!assignments.length || !mapped.length) return mapped;

  // Equal counts → positional zip (Heading + Body 1..N ↔ selection units).
  if (assignments.length === mapped.length) {
    for (let i = 0; i < mapped.length; i++) {
      if (!isExcludedGleanValue(assignments[i].value)) {
        mapped[i].text = assignments[i].value;
      }
    }
    return mapped;
  }

  const usedNodes = new Set();
  const usedAssign = new Set();

  // Heading & CTA first so body values cannot claim those nodes.
  for (let ai = 0; ai < assignments.length; ai++) {
    const a = assignments[ai];
    const r = String(a.role || '').toLowerCase();
    if (r !== 'heading' && r !== 'action' && r !== 'button') continue;
    const idx = mapped.findIndex(
      (n, i) => !usedNodes.has(i) && roleCompatible(a.role, n.role)
    );
    if (idx >= 0) {
      mapped[idx].text = a.value;
      usedNodes.add(idx);
      usedAssign.add(ai);
    }
  }

  // Prefer text-role nodes for remaining body values, then any unused node.
  for (let ai = 0; ai < assignments.length; ai++) {
    if (usedAssign.has(ai)) continue;
    let idx = mapped.findIndex(
      (n, i) => !usedNodes.has(i) && roleCompatible(assignments[ai].role, n.role)
    );
    if (idx < 0) {
      idx = mapped.findIndex((_, i) => !usedNodes.has(i));
    }
    if (idx < 0) break;
    mapped[idx].text = assignments[ai].value;
    usedNodes.add(idx);
    usedAssign.add(ai);
  }

  return mapped;
}

/**
 * Normalize Robot Content Designer markdown/table output into variant cards.
 * Real responses often use HTML <br> inside markdown table cells:
 *   **Option 2 (AI-written) ✅ Recommended**<br>Heading: …<br>Body 1: …<br>Body 2: …
 */
function parseOptionsFromText(text, session, maxOptions = DEFAULT_OPTION_COUNT) {
  const cap = Math.min(Math.max(Number(maxOptions) || DEFAULT_OPTION_COUNT, 2), 6);
  const allNodes = assignUnitLabels(
    Array.isArray(session.nodes) ? session.nodes : []
  );
  const eligibleNodes = gleanEligibleNodes(allNodes);
  const nodes = eligibleNodes;
  const normalized = String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

  const variants = [];
  const seenNums = new Set();
  // Markdown tables put Heading on the same line as "| Option N | Heading: …"
  // so search the option line + following cell body together.
  // Start must allow a bare "|" row (after a prior option ended on lookahead
  // `|| **Option N`), not only (^|\n).
  const optionRe =
    /(?:(?:^|\n)\|{0,1}|\|)\s*\*{0,2}Option\s+(\d+)([^*\n|]*)\*{0,2}([^\n]*)\n?([\s\S]*?)(?=(?:\n\|?\s*\*{0,2}Option\s+\d+)|\|\s*\*{0,2}Option\s+\d+|(?:\n### |\n#### |\n---\n)|$)/gi;
  let match;
  while ((match = optionRe.exec(normalized)) !== null) {
    const num = match[1];
    if (seenNums.has(num)) continue;
    const headerMeta = `${match[2] || ''} ${match[3] || ''}`;
    const rawBlock = `${headerMeta}\n${match[4] || ''}`;
    const { copy: block, scores } = splitCopyAndScores(rawBlock);
    const labeled = parseLabeledCopyFields(block);
    const recommended = /recommended/i.test(headerMeta);
    if (!labeled.length) continue;
    seenNums.add(num);

    const fields = fieldsFromLabeled(labeled);
    const mappedEligible = mapOptionFieldsToNodes(nodes, fields, labeled);
    const mapped = mergeVariantNodes(allNodes, mappedEligible);

    if (isOriginalVariant(headerMeta, mappedEligible, nodes)) continue;

    const rationales = labeled
      .map((f) => extractFieldRationale(f.rawText || f.text))
      .filter(Boolean);
    const summaryParts = mappedEligible
      .map((n) => cleanCopyField(n.text))
      .filter(Boolean);

    const variant = {
      id: `glean-option-${num}`,
      label: recommended ? `Option ${num} (recommended)` : `Option ${num}`,
      summary: summaryParts.join(' · ').slice(0, 240),
      fields,
      nodes: mapped,
      recommended
    };
    const feedback = [scores, ...rationales].filter(Boolean).join(' · ').trim();
    if (feedback) variant.scores = feedback.slice(0, 400);
    variants.push(variant);
  }

  if (variants.length) {
    return variants.slice(0, cap).map((v, i) => {
      const num = i + 1;
      return {
        ...v,
        id: `glean-option-${num}`,
        label: v.recommended ? `Option ${num} (recommended)` : `Option ${num}`
      };
    });
  }

  return [
    {
      id: 'glean-raw',
      label: 'Glean response',
      summary: String(text || '').slice(0, 200),
      fields: {},
      nodes: mergeVariantNodes(allNodes, mapOptionFieldsToNodes(nodes, {})),
      rawText: text
    }
  ];
}

function extractTextFromStreamPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.delta === 'string') return payload.delta;
  if (typeof payload.message === 'string') return payload.message;

  const fromMessages = extractMessageText(payload);
  if (fromMessages) return fromMessages;

  const content = payload.content || payload.delta?.content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

function makeEmitter(onProgress) {
  return (event) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(event);
    } catch {
      // ignore UI progress errors
    }
  };
}

/**
 * Try SSE stream to completion. Rejects if no first byte within
 * STREAM_FIRST_BYTE_MS, or if the stream ends empty.
 * Emits silent-phase heartbeats, then live GLEAN_AI token text.
 */
async function tryStreamAgent(body, emit) {
  const ac = new AbortController();
  const streamUrl = `${baseUrl()}/rest/api/v1/agents/runs/stream`;
  const started = Date.now();

  const firstByteTimer = setTimeout(() => {
    ac.abort(new Error('stream first-byte timeout'));
  }, STREAM_FIRST_BYTE_MS);

  const overallTimer = setTimeout(() => {
    ac.abort(new Error(`stream timed out after ${GLEAN_AGENT_TIMEOUT_MS}ms`));
  }, GLEAN_AGENT_TIMEOUT_MS);

  let heartbeat = null;
  let gotAiTokens = false;

  const emitSilentProgress = () => {
    if (gotAiTokens) return;
    const status = 'Connected — agent running…';
    emit({
      stage: 'stream_wait',
      text: status,
      detail: 'First tokens usually after ~1 min (agent runtime)',
      latestThought: status,
      live: false
    });
  };

  try {
    const response = await fetch(streamUrl, {
      method: 'POST',
      headers: authHeaders({ Accept: 'text/event-stream' }),
      body: JSON.stringify(body),
      signal: ac.signal
    });

    if (!response.ok) {
      throw new Error(`stream ${response.status}`);
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('No stream body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let assembled = '';
    let lastEvent = '';
    let gotByte = false;
    let eventCount = 0;

    heartbeat = setInterval(emitSilentProgress, WAIT_HEARTBEAT_MS);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!gotByte) {
        gotByte = true;
        clearTimeout(firstByteTimer);
        emitSilentProgress();
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split(/\n/);
        let eventName = lastEvent;
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
            lastEvent = eventName;
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (!dataLines.length) continue;
        const raw = dataLines.join('\n');
        if (raw === '[DONE]') continue;
        eventCount += 1;

        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          // Non-JSON SSE data — treat as raw text delta.
          if (raw.trim()) {
            assembled += raw;
            gotAiTokens = true;
            emit({
              stage: eventName || 'thinking',
              text: 'Streaming agent output…',
              partial: assembled.slice(-6000),
              latestThought: extractLatestThought(
                assembled,
                'Generating copy…'
              ),
              streamChars: assembled.length,
              live: true
            });
          }
          continue;
        }

        // Prefer AI-only deltas (skip the initial USER ack message).
        const aiDelta = extractAiDelta(payload);
        const chunkText = aiDelta || extractTextFromStreamPayload(payload);
        if (chunkText) {
          // Token deltas are small appends; full snapshots replace.
          if (
            chunkText.length >= assembled.length &&
            assembled.length > 0 &&
            chunkText.startsWith(assembled.slice(0, Math.min(40, assembled.length)))
          ) {
            assembled = chunkText;
          } else {
            assembled += chunkText;
          }
          gotAiTokens = true;
          emit({
            stage: eventName || 'thinking',
            text: 'Streaming agent output…',
            partial: assembled.slice(-6000),
            latestThought: extractLatestThought(
              assembled,
              'Generating copy…'
            ),
            streamChars: assembled.length,
            live: true
          });
        } else if (payload.status || payload.stage || payload.type) {
          const statusText = String(
            payload.message || payload.detail || payload.status || 'Working…'
          ).slice(0, 280);
          emit({
            stage: String(payload.status || payload.stage || payload.type),
            text: statusText,
            partial: assembled.slice(-2500),
            latestThought: statusText,
            live: !!assembled
          });
        }
      }
    }

    if (!assembled.trim()) {
      throw new Error(
        `Empty stream response (events=${eventCount}, bytes_seen=${gotByte})`
      );
    }
    console.log(
      `[Crank] Glean stream done: ${eventCount} events, ${assembled.length} chars, ${Math.round((Date.now() - started) / 1000)}s`
    );
    return assembled;
  } finally {
    clearTimeout(firstByteTimer);
    clearTimeout(overallTimer);
    if (heartbeat) clearInterval(heartbeat);
  }
}

function emitWaitProgress(emit) {
  // Same stage every tick — UI updates elapsed locally (no rotating fake stages).
  const status = 'Connected — agent running…';
  emit({
    stage: 'waiting',
    text: status,
    detail: 'Robot Content Designer · typically 1–2 min (mostly agent runtime)',
    note: 'Using /runs/wait (stream disabled or unavailable).',
    latestThought: status,
    live: false
  });
}

async function waitForAgent(body, emit) {
  const url = `${baseUrl()}/rest/api/v1/agents/runs/wait`;
  const started = Date.now();
  // Heartbeats are UI-only; /runs/wait blocks until the agent finishes (often 60–120s).
  emitWaitProgress(emit);
  const heartbeat = setInterval(() => {
    emitWaitProgress(emit);
  }, WAIT_HEARTBEAT_MS);

  const ac = new AbortController();
  const overallTimer = setTimeout(() => {
    ac.abort(new Error(`Glean wait timed out after ${GLEAN_AGENT_TIMEOUT_MS}ms`));
  }, GLEAN_AGENT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: ac.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Glean agents/runs/wait ${response.status}: ${text.slice(0, 400)}`
      );
    }
    const data = await response.json();
    const text = extractMessageText(data);
    if (!text) throw new Error('Glean agent returned no text content');
    return text;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Glean wait timed out after ${GLEAN_AGENT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(overallTimer);
    clearInterval(heartbeat);
  }
}

/**
 * Ask Glean for copy variants.
 * Prefers stream when it actually emits; otherwise wait + heartbeats.
 */
async function proposeCopyVariants(session, options = {}, onProgress) {
  const stub =
    String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false';
  const emit = makeEmitter(onProgress);

  const stubOptionCount = Math.min(
    Math.max(
      Number(options.optionCount || options.variantCount || DEFAULT_OPTION_COUNT) ||
        DEFAULT_OPTION_COUNT,
      2
    ),
    6
  );

  if (stub || !process.env.GLEAN_API_KEY) {
    emit({ stage: 'stub', text: 'Using local stub variants…' });
    return stubVariants(session).slice(0, stubOptionCount);
  }

  const agentId = process.env.GLEAN_AGENT_ID || DEFAULT_AGENT_ID;
  const input = buildAgentInput(session, options);
  const optionCount = input._crankOptionCount || DEFAULT_OPTION_COUNT;
  const { _crankOptionCount, ...gleanInput } = input;
  const body = {
    agent_id: agentId,
    input: gleanInput
  };

  const draftPreview = String(
    gleanInput['Enter in a human-written draft'] || ''
  ).slice(0, 180);
  console.log(
    `[Crank] Glean draft (${draftPreview.length} chars shown): ${draftPreview.replace(/\n/g, ' | ')}`
  );
  console.log(
    `[Crank] Glean fields: component=${gleanInput['Type of component']}; options=${optionCount}; feature=${String(
      gleanInput['Explain the functionality of the feature'] || ''
    ).slice(0, 100)}`
  );

  emit({
    stage: 'start',
    text: `Sending copy to Robot Content Designer (${optionCount} options)…`,
    detail: 'Typically 1–2 min — most time is agent runtime, not network',
    partial: draftPreview,
    latestThought: `Sending copy to Robot Content Designer (${optionCount} options)…`
  });

  // Prefer /runs/stream (live GLEAN_AI tokens after a silent agent phase).
  // Fall back to /runs/wait only if stream fails. Never run both to completion.
  // Set GLEAN_USE_STREAM=false to skip stream entirely.
  const useStream =
    String(process.env.GLEAN_USE_STREAM || 'true').toLowerCase() !== 'false';

  if (useStream) {
    try {
      emit({
        stage: 'stream_wait',
        text: 'Connecting to live agent stream…',
        detail: 'Robot Content Designer · typically 1–2 min (mostly agent runtime)',
        latestThought: 'Connecting to live agent stream…',
        live: false
      });
      const streamed = await tryStreamAgent(body, emit);
      emit({
        stage: 'done',
        text: 'Parsing streamed copy options…',
        partial: streamed.slice(0, 2000),
        latestThought: 'Parsing streamed copy options…',
        live: true
      });
      return parseOptionsFromText(streamed, session, optionCount);
    } catch (streamErr) {
      emit({
        stage: 'fallback',
        text: 'Live stream failed — switching to /runs/wait…',
        partial: String(streamErr.message || streamErr).slice(0, 160),
        latestThought: 'Live stream failed — switching to /runs/wait…'
      });
    }
  } else {
    emit({
      stage: 'waiting',
      text: 'Connected — agent running…',
      detail: 'Robot Content Designer · typically 1–2 min (mostly agent runtime)',
      latestThought: 'Connected — agent running…',
      note: 'Using /runs/wait (GLEAN_USE_STREAM=false).',
      live: false
    });
  }

  const text = await waitForAgent(body, emit);
  emit({
    stage: 'done',
    text: 'Parsing copy options…',
    partial: text.slice(0, 2000),
    live: false
  });
  return parseOptionsFromText(text, session, optionCount);
}

module.exports = {
  proposeCopyVariants,
  loadSkillsContext,
  stubVariants,
  parseOptionsFromText,
  splitCopyAndScores,
  cleanCopyField,
  parseLabeledCopyFields,
  mapOptionFieldsToNodes,
  buildAgentInput,
  formatDraft,
  draftLabelHint,
  isOriginalVariant,
  normalizeWs,
  DEFAULT_AGENT_ID
};
