const fs = require('fs');
const { load } = require('cheerio');
const babelParser = require('@babel/parser');
const babelTraverse = require('@babel/traverse').default;

function writeTextChange(filePath, selectorText, value, options = {}) {
  if (!filePath || !selectorText) {
    throw new Error('filePath and selectorText are required');
  }

  if (isHtmlFile(filePath)) {
    return writeHtmlTextChange(filePath, selectorText, value, options);
  }

  if (isScriptSourceFile(filePath)) {
    return writeScriptTextChange(filePath, selectorText, value, options);
  }

  throw new Error('Text save is supported for HTML and JS/TS source files only');
}

function writeHtmlTextChange(filePath, selectorText, value, options = {}) {

  const html = fs.readFileSync(filePath, 'utf8');
  const $ = load(html, { decodeEntities: false });
  const nodes = $(selectorText);

  if (!nodes.length) {
    const oldValue = String(options.oldValue || '').trim();
    if (!oldValue) {
      console.error('NO_SELECTOR_MATCH', { selectorText, reason: 'no oldValue' });
      return false;
    }

    console.log('SELECTOR_FAILED', { selectorText, trying: 'oldValue fallback', oldValue });

    // Try exact match first
    let replaced = replaceHtmlTextByOldValue($, oldValue, String(value || ''));
    if (replaced) {
      fs.writeFileSync(filePath, $.html(), 'utf8');
      return true;
    }

    // Try fuzzy match for split/wrapped nodes
    console.log('EXACT_MATCH_FAILED', { trying: 'fuzzy match with normalization' });
    replaced = replaceHtmlTextFuzzy($, oldValue, String(value || ''));
    if (replaced) {
      fs.writeFileSync(filePath, $.html(), 'utf8');
      return true;
    }

    console.error('NO_MATCHING_TEXT_NODE', { filePath, selectorText, oldValue });
    return false;
  }

  // Update all matching nodes to keep behavior aligned with the active selector scope.
  nodes.each(function () {
    const preferredTextNode = findPreferredTextNode($(this).get(0));
    if (preferredTextNode) {
      preferredTextNode.data = String(value || '');
      return;
    }

    // Fallback when no text node exists under the matched element.
    $(this).text(String(value || ''));
  });

  fs.writeFileSync(filePath, $.html(), 'utf8');
  return true;
}

function replaceHtmlTextByOldValue($, oldValue, newValue) {
  const expected = String(oldValue || '').trim();
  if (!expected) {
    return false;
  }

  let replaced = false;

  $('*').each(function () {
    if (replaced) {
      return false;
    }

    const parent = this;
    const tag = String(parent && parent.name || '').toLowerCase();
    if (tag === 'script' || tag === 'style') {
      return;
    }

    $(parent).contents().each(function () {
      if (replaced) {
        return false;
      }

      const node = this;
      if (!node || node.type !== 'text') {
        return;
      }

      const raw = String(node.data || '');
      const rawTrimmed = raw.trim();
      if (!rawTrimmed || rawTrimmed !== expected) {
        return;
      }

      const leading = raw.match(/^\s*/);
      const trailing = raw.match(/\s*$/);
      const lead = leading ? leading[0] : '';
      const tail = trailing ? trailing[0] : '';
      node.data = lead + String(newValue || '') + tail;
      replaced = true;
      return false;
    });
  });

  return replaced;
}

function replaceHtmlTextFuzzy($, oldValue, newValue) {
  const expected = String(oldValue || '').trim().replace(/\s+/g, ' ');
  if (!expected) {
    return false;
  }

  let replaced = false;

  // Collect text nodes with normalized spacing
  const textNodes = [];
  $('*').each(function () {
    const tag = String(this && this.name || '').toLowerCase();
    if (tag === 'script' || tag === 'style') {
      return;
    }

    $(this).contents().each(function () {
      const node = this;
      if (node && node.type === 'text') {
        const raw = String(node.data || '');
        const normalized = raw.trim().replace(/\s+/g, ' ');
        if (normalized) {
          textNodes.push({ node, raw, normalized });
        }
      }
    });
  });

  // Try to find and replace: check individual nodes, then check concatenated adjacent nodes
  for (let i = 0; i < textNodes.length && !replaced; i++) {
    // Single node match
    if (textNodes[i].normalized === expected) {
      const raw = textNodes[i].raw;
      const leading = raw.match(/^\s*/);
      const trailing = raw.match(/\s*$/);
      const lead = leading ? leading[0] : '';
      const tail = trailing ? trailing[0] : '';
      textNodes[i].node.data = lead + newValue + tail;
      replaced = true;
      break;
    }

    // Try concatenating adjacent text nodes (for wrapped text)
    let combined = textNodes[i].normalized;
    let endIdx = i;
    while (endIdx + 1 < textNodes.length && combined.length < expected.length * 2) {
      combined += ' ' + textNodes[endIdx + 1].normalized;
      endIdx++;

      if (combined === expected) {
        // Found match across multiple nodes - replace all with empty and put text in first
        const firstNode = textNodes[i].node;
        const firstRaw = textNodes[i].raw;
        const leading = firstRaw.match(/^\s*/);
        const trailing = textNodes[endIdx].raw.match(/\s*$/);
        const lead = leading ? leading[0] : '';
        const tail = trailing ? trailing[0] : '';

        firstNode.data = lead + newValue + tail;
        
        // Clear intermediate nodes
        for (let j = i + 1; j <= endIdx; j++) {
          textNodes[j].node.data = '';
        }

        replaced = true;
        break;
      }
    }
  }

  return replaced;
}


function writeScriptTextChange(filePath, selectorText, value, options) {
  const oldValue = String(options && options.oldValue || '');
  const newValue = String(value || '');

  if (!oldValue) {
    throw new Error('Text save for JS/TS source requires previous text value');
  }

  if (oldValue === newValue) {
    return true;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  let updated = source;
  let totalReplacements = 0;

  const selectorMatcher = buildTextScriptSelectorMatcher(selectorText);
  if (selectorMatcher) {
    const astResult = tryParseScriptAst(source);
    if (astResult && astResult.ast) {
      const replacement = findSingleJsxTextReplacement(astResult.ast, selectorMatcher, oldValue, newValue);
      if (replacement) {
        updated = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
        totalReplacements = 1;
      }
    }
  }

  // Fallback path for sources we couldn't safely parse/match by selector.
  // This remains intentionally conservative: replace only one occurrence.
  if (!totalReplacements) {
    console.log('SCRIPT_TEXT_SEARCH', {
      filePath: filePath.split('/').pop(),
      oldValue,
      foundInSource: source.includes(oldValue)
    });

    const jsxTextPattern = new RegExp('>(\\s*)' + escapeRegExp(oldValue) + '(\\s*)<');
    const jsxMatch = updated.match(jsxTextPattern);
    if (jsxMatch && jsxMatch.index !== undefined) {
      const full = String(jsxMatch[0] || '');
      const lead = String(jsxMatch[1] || '');
      const tail = String(jsxMatch[2] || '');
      const replacement = '>' + lead + newValue + tail + '<';
      updated = updated.slice(0, jsxMatch.index) + replacement + updated.slice(jsxMatch.index + full.length);
      totalReplacements = 1;
      console.log('JSX_TEXT_REPLACEMENT', { oldValue, newValue });
    }
  }

  // Replace exact string literals where the entire literal equals old value.
  if (!totalReplacements) {
    const literalPatterns = [
      {
        regex: new RegExp("'" + escapeRegExp(escapeForSingleQuotedLiteral(oldValue)) + "'"),
        replacement: '\'' + escapeForSingleQuotedLiteral(newValue) + '\''
      },
      {
        regex: new RegExp('"' + escapeRegExp(escapeForDoubleQuotedLiteral(oldValue)) + '"'),
        replacement: '"' + escapeForDoubleQuotedLiteral(newValue) + '"'
      },
      {
        regex: new RegExp('`' + escapeRegExp(escapeForTemplateLiteral(oldValue)) + '`'),
        replacement: '`' + escapeForTemplateLiteral(newValue) + '`'
      }
    ];

    for (const entry of literalPatterns) {
      const literalMatch = updated.match(entry.regex);
      if (literalMatch && literalMatch.index !== undefined) {
        const matched = String(literalMatch[0] || '');
        updated = updated.slice(0, literalMatch.index) + entry.replacement + updated.slice(literalMatch.index + matched.length);
        totalReplacements = 1;
        console.log('LITERAL_REPLACEMENT', { oldValue, newValue });
        break;
      }
    }
  }

  // Fallback: if strict JSX/literal matching failed but source contains old text,
  // replace the first exact occurrence. This covers cases where runtime text comes
  // from patterns not handled by the regexes above.
  if (!totalReplacements && source.includes(oldValue)) {
    const firstIdx = updated.indexOf(oldValue);
    if (firstIdx !== -1) {
      updated = updated.slice(0, firstIdx) + newValue + updated.slice(firstIdx + oldValue.length);
      totalReplacements += 1;
      console.log('FALLBACK_TEXT_REPLACEMENT', {
        filePath: filePath.split('/').pop(),
        oldValue,
        newValue,
        index: firstIdx
      });
    }
  }

  if (!totalReplacements || updated === source) {
    console.log('SCRIPT_NO_MATCH', { 
      filePath: filePath.split('/').pop(), 
      oldValue, 
      newValue, 
      replacements: totalReplacements,
      hint: 'Text was not found in JSX or string literal format. Check if text is split across nodes or formatted differently.'
    });
    return false;
  }

  console.log('SCRIPT_REPLACEMENT_SUCCESS', { filePath: filePath.split('/').pop(), replacements: totalReplacements });
  fs.writeFileSync(filePath, updated, 'utf8');
  return true;
}

function tryParseScriptAst(source) {
  try {
    return {
      ast: babelParser.parse(source, {
        sourceType: 'unambiguous',
        plugins: [
          'jsx',
          'typescript',
          'classProperties',
          'objectRestSpread',
          'optionalChaining',
          'nullishCoalescingOperator'
        ],
        ranges: true,
        errorRecovery: true
      })
    };
  } catch (_err) {
    return null;
  }
}

function buildTextScriptSelectorMatcher(selectorText) {
  const raw = String(selectorText || '').trim();
  if (!raw) {
    return null;
  }

  const parts = raw
    .split(',')
    .map((part) => parseTextScriptSelectorPart(part))
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  return { parts };
}

function parseTextScriptSelectorPart(selectorPart) {
  const part = String(selectorPart || '').trim();
  if (!part) {
    return null;
  }

  const rightMost = part.split(/[>+~\s]+/).filter(Boolean).pop() || '';
  if (!rightMost) {
    return null;
  }

  if (/\[[^\]]+\]/.test(rightMost) || /:/.test(rightMost)) {
    return null;
  }

  const cleaned = rightMost.trim();
  const tagMatch = cleaned.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  const idMatches = cleaned.match(/#[a-zA-Z0-9_-]+/g) || [];
  const classMatches = cleaned.match(/\.[a-zA-Z0-9_-]+/g) || [];

  if (!idMatches.length && !classMatches.length) {
    return null;
  }

  return {
    tag: tagMatch ? tagMatch[0] : '',
    ids: idMatches.map((token) => token.slice(1)),
    classes: classMatches.map((token) => token.slice(1))
  };
}

function findSingleJsxTextReplacement(ast, selectorMatcher, oldValue, newValue) {
  const oldNormalized = normalizeWhitespace(oldValue);
  let replacement = null;

  babelTraverse(ast, {
    JSXElement(pathRef) {
      if (replacement) {
        pathRef.stop();
        return;
      }

      const opening = pathRef.node && pathRef.node.openingElement;
      if (!opening || !jsxOpeningMatchesTextSelector(opening, selectorMatcher)) {
        return;
      }

      const jsxTextChildren = Array.isArray(pathRef.node.children)
        ? pathRef.node.children.filter((child) => child && child.type === 'JSXText')
        : [];

      const preferred = jsxTextChildren.find((child) => {
        const normalized = normalizeWhitespace(child.value);
        if (!normalized) {
          return false;
        }
        if (!oldNormalized) {
          return true;
        }
        return normalized === oldNormalized;
      }) || null;

      if (!preferred || !Number.isInteger(preferred.start) || !Number.isInteger(preferred.end)) {
        return;
      }

      const raw = String(preferred.value || '');
      const leading = raw.match(/^\s*/);
      const trailing = raw.match(/\s*$/);
      replacement = {
        start: preferred.start,
        end: preferred.end,
        text: String((leading ? leading[0] : '') + String(newValue || '') + (trailing ? trailing[0] : ''))
      };
      pathRef.stop();
    }
  });

  return replacement;
}

function jsxOpeningMatchesTextSelector(opening, selectorMatcher) {
  if (!opening || !selectorMatcher || !Array.isArray(selectorMatcher.parts)) {
    return false;
  }

  return selectorMatcher.parts.some((matcher) => jsxOpeningMatchesSingleSelector(opening, matcher));
}

function jsxOpeningMatchesSingleSelector(opening, matcher) {
  if (!opening || !matcher) {
    return false;
  }

  const tagName = getJsxTagName(opening.name);
  if (matcher.tag && String(tagName || '').toLowerCase() !== String(matcher.tag || '').toLowerCase()) {
    return false;
  }

  const idValue = getJsxAttributeStringValue(opening, 'id');
  if (Array.isArray(matcher.ids) && matcher.ids.length && (!idValue || !matcher.ids.includes(idValue))) {
    return false;
  }

  const classValue = getJsxAttributeStringValue(opening, 'className') || getJsxAttributeStringValue(opening, 'class');
  const classTokens = String(classValue || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return (matcher.classes || []).every((cls) => classTokens.includes(cls));
}

function getJsxTagName(nameNode) {
  if (!nameNode) {
    return '';
  }

  if (nameNode.type === 'JSXIdentifier') {
    return String(nameNode.name || '');
  }

  if (nameNode.type === 'JSXMemberExpression') {
    return String(nameNode.property && nameNode.property.name || '');
  }

  return '';
}

function getJsxAttributeStringValue(opening, attrName) {
  const attrs = opening && Array.isArray(opening.attributes) ? opening.attributes : [];
  for (const attr of attrs) {
    if (!attr || attr.type !== 'JSXAttribute' || !attr.name || attr.name.type !== 'JSXIdentifier') {
      continue;
    }

    if (attr.name.name !== attrName) {
      continue;
    }

    if (!attr.value) {
      return '';
    }

    if (attr.value.type === 'StringLiteral') {
      return String(attr.value.value || '');
    }

    if (attr.value.type === 'JSXExpressionContainer' && attr.value.expression && attr.value.expression.type === 'StringLiteral') {
      return String(attr.value.expression.value || '');
    }
  }

  return '';
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function findPreferredTextNode(root) {
  if (!root || !Array.isArray(root.children)) {
    return null;
  }

  // Prefer direct non-empty text node first.
  for (const child of root.children) {
    if (child && child.type === 'text' && String(child.data || '').trim()) {
      return child;
    }
  }

  // Then search depth-first for the first meaningful text node.
  for (const child of root.children) {
    if (!child || child.type === 'text') {
      continue;
    }

    const tag = String(child.name || '').toLowerCase();
    if (tag === 'script' || tag === 'style') {
      continue;
    }

    const nested = findPreferredTextNode(child);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function isHtmlFile(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

function isScriptSourceFile(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return lower.endsWith('.js')
    || lower.endsWith('.jsx')
    || lower.endsWith('.ts')
    || lower.endsWith('.tsx')
    || lower.endsWith('.mjs')
    || lower.endsWith('.cjs')
    || lower.endsWith('.vue')
    || lower.endsWith('.svelte')
    || lower.endsWith('.astro');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeForSingleQuotedLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function escapeForDoubleQuotedLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function escapeForTemplateLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

module.exports = { writeTextChange };
