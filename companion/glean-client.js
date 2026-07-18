'use strict';

/**
 * Glean agent client — stubbed until Motive provides the real Glean API.
 *
 * Env:
 *   GLEAN_API_URL   — POST endpoint for copy variant generation
 *   GLEAN_API_KEY   — bearer / API key
 *   GLEAN_AGENT_ID  — optional agent / workflow id
 *   GLEAN_STUB      — "true" (default) returns local stub variants without network
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');

function loadSkillsContext() {
  const files = [];
  try {
    for (const name of fs.readdirSync(SKILLS_DIR)) {
      if (!/\.(md|txt)$/i.test(name)) {
        continue;
      }
      const full = path.join(SKILLS_DIR, name);
      files.push({
        name,
        content: fs.readFileSync(full, 'utf8').slice(0, 8000)
      });
    }
  } catch {
    // skills dir optional during early bootstrap
  }
  return files;
}

function stubVariants(session) {
  const nodes = Array.isArray(session.nodes) ? session.nodes : [];
  const base = nodes.map((n) => ({
    path: n.path,
    role: n.role || 'text',
    text: n.text
  }));

  const mk = (id, label, transform) => ({
    id,
    label,
    summary: `${label} pass over ${base.length} text node(s)`,
    nodes: base.map((n) => ({
      path: n.path,
      role: n.role,
      text: transform(String(n.text || ''))
    }))
  });

  return [
    mk('glean-stub-concise', 'Concise', (t) =>
      t.replace(/\s+/g, ' ').trim().replace(/\.$/, '')
    ),
    mk('glean-stub-clear', 'Clearer', (t) =>
      t.trim().length ? `${t.trim().replace(/\.$/, '')}.` : t
    ),
    mk('glean-stub-action', 'More actionable', (t) => {
      const trimmed = t.trim();
      if (!trimmed) {
        return trimmed;
      }
      if (/^(get|start|try|open|view|add|create|save)/i.test(trimmed)) {
        return trimmed;
      }
      return `Try: ${trimmed}`;
    }),
    mk('glean-stub-tone', 'Product tone', (t) =>
      t.replace(/\butilize\b/gi, 'use').replace(/\bleverage\b/gi, 'use')
    )
  ];
}

/**
 * Ask Glean for 3–4 copy iterations for the selected div's text nodes.
 * @param {object} session — selection-store session
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
async function proposeCopyVariants(session, options = {}) {
  const stub =
    String(process.env.GLEAN_STUB || 'true').toLowerCase() !== 'false';

  if (stub || !process.env.GLEAN_API_KEY) {
    return stubVariants(session);
  }

  const url = process.env.GLEAN_API_URL;
  if (!url) {
    throw new Error('GLEAN_API_URL is required when GLEAN_STUB=false');
  }

  const skills = loadSkillsContext();
  const body = {
    agentId: process.env.GLEAN_AGENT_ID || undefined,
    sessionId: session.id,
    origin: session.origin,
    pageUrl: session.pageUrl,
    selector: session.selector,
    nodes: session.nodes,
    combinedText: session.combinedText,
    skills: skills.map((s) => ({ name: s.name, content: s.content })),
    options: {
      variantCount: options.variantCount || 4,
      ...options
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GLEAN_API_KEY}`,
      ...(process.env.GLEAN_AGENT_ID
        ? { 'X-Glean-Agent-Id': process.env.GLEAN_AGENT_ID }
        : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Glean API error ${response.status}: ${text.slice(0, 400)}`
    );
  }

  const data = await response.json();
  // Expected shape (to be confirmed with real Glean API):
  // { variants: [{ id, label, summary?, nodes: [{ path, text }] }] }
  if (!data || !Array.isArray(data.variants)) {
    throw new Error('Glean API response missing variants[]');
  }
  return data.variants;
}

module.exports = {
  proposeCopyVariants,
  loadSkillsContext,
  stubVariants
};
