'use strict';

/**
 * Text save / resolve — reuses Vizpatch text-writer + Vizpatch-like source resolution.
 *
 * Resolution order:
 *   1. Explicit file / pathHints (route-like absolute paths resolved under project root)
 *   2. URL pathname → basename search (e.g. /demo.html → panel/demo.html)
 *   3. Content search for oldValue (exact, whitespace-normalized, tag-stripped)
 */
const fs = require('fs');
const path = require('path');
const { requireVizpatch, resolveVizpatchRoot } = require('./vizpatch-bridge');

let writeTextChange;
try {
  writeTextChange = requireVizpatch('companion/text-writer.js').writeTextChange;
} catch (err) {
  writeTextChange = null;
  console.warn('[Crank] text-writer unavailable:', err.message);
}

const TEXT_EXTS = new Set([
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro'
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache'
]);

function walkFiles(root, out, depth = 0) {
  if (depth > 10 || out.length > 800) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out, depth + 1);
    } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function normalizeWs(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soften DOM vs source differences after tag stripping (e.g. "crank ." vs "crank."). */
function softenText(value) {
  return normalizeWs(value)
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([({\[])\s+/g, '$1')
    .replace(/\s+([)}\]])/g, '$1');
}

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function fileContainsNeedle(content, needle) {
  const expected = String(needle || '').trim();
  if (!expected) {
    return true;
  }
  if (content.includes(expected)) {
    return true;
  }
  const softNeedle = softenText(expected);
  if (softNeedle && softenText(content).includes(softNeedle)) {
    return true;
  }
  // DOM textContent often concatenates across inline tags; source still has markup.
  const stripped = softenText(stripTags(content));
  if (softNeedle && stripped.includes(softNeedle)) {
    return true;
  }
  return false;
}

function pathHintsFromUrl(sourceUrl) {
  const value = String(sourceUrl || '').trim();
  if (!value) {
    return [];
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return [];
  }
  const hints = [];
  const push = (hint) => {
    const h = String(hint || '').trim();
    if (h && !hints.includes(h)) {
      hints.push(h);
    }
  };

  let pathname = decodeURIComponent(parsed.pathname || '/').trim() || '/';
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  if (pathname === '/') {
    push('/index.html');
    push('index.html');
    return hints;
  }

  push(pathname);
  push(pathname.replace(/^\//, ''));
  const base = path.posix.basename(pathname);
  if (base) {
    push(base);
  }

  if (!/\.[a-z0-9]+$/i.test(pathname)) {
    push(pathname + '.html');
    push(pathname.replace(/\/+$/, '') + '/index.html');
  }
  if (pathname.endsWith('/')) {
    push(pathname + 'index.html');
  }
  return hints;
}

/**
 * Resolve a hint that may look absolute (e.g. "/demo.html") but is a URL route.
 */
function resolveHintCandidates(hint, root) {
  const raw = String(hint || '').trim();
  if (!raw) {
    return [];
  }
  const out = [];
  if (path.isAbsolute(raw)) {
    out.push(path.normalize(raw));
    // Route-like: /demo.html → <root>/demo.html
    const rel = raw.replace(/^\/+/, '');
    if (rel) {
      out.push(path.normalize(path.join(root, rel)));
    }
  } else {
    out.push(path.normalize(path.resolve(root, raw)));
  }
  return out;
}

function findByBasename(root, basename, needle) {
  if (!basename) {
    return null;
  }
  const files = [];
  walkFiles(root, files);
  const matches = files.filter(
    (f) => path.basename(f).toLowerCase() === String(basename).toLowerCase()
  );
  if (!matches.length) {
    return null;
  }
  if (!needle) {
    return matches[0];
  }
  for (const candidate of matches) {
    try {
      if (fileContainsNeedle(fs.readFileSync(candidate, 'utf8'), needle)) {
        return candidate;
      }
    } catch {
      // skip
    }
  }
  // Basename matched the page URL — prefer it even if oldValue is nested-markup mismatched.
  return matches[0];
}

function buildFailureReason(root, needle, attempted) {
  const snippet = normalizeWs(needle).slice(0, 80);
  if (!needle) {
    return (
      'No file hint and no oldValue to search. ' +
      `Project root: ${root}. Set CRANK_PROJECT_ROOT to your app repo if this is wrong.`
    );
  }
  const tried = (attempted || []).slice(0, 8).join(', ') || '(none)';
  return (
    `Text source file could not be resolved for "${snippet}". ` +
    `Project root: ${root}. ` +
    `No searchable file contained that string (nested tags / i18n / wrong root are common causes). ` +
    `Tried: ${tried}. ` +
    `Fix: start companion from the app being edited or set CRANK_PROJECT_ROOT.`
  );
}

function resolveTextSourceFile({
  file,
  oldValue,
  projectRoot,
  pathHints,
  sourceUrl
}) {
  const attempted = [];
  const seen = new Set();
  const root = projectRoot || process.cwd();
  const needle = String(oldValue || '').trim();

  const note = (candidate) => {
    const normalized = path.normalize(String(candidate || ''));
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    attempted.push(normalized);
    return true;
  };

  const acceptIfExists = (candidate, requireNeedle) => {
    const abs = path.normalize(candidate);
    note(abs);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return null;
    }
    if (!TEXT_EXTS.has(path.extname(abs).toLowerCase())) {
      return null;
    }
    if (requireNeedle && needle) {
      try {
        if (!fileContainsNeedle(fs.readFileSync(abs, 'utf8'), needle)) {
          return null;
        }
      } catch {
        return null;
      }
    }
    return abs;
  };

  // 1) Explicit file
  if (file) {
    for (const candidate of resolveHintCandidates(file, root)) {
      const hit = acceptIfExists(candidate, Boolean(needle));
      if (hit) {
        return { filePath: hit, attemptedFiles: attempted.slice(0, 40) };
      }
      // If explicit file exists but needle missing, still prefer it (writer may fuzzy-match).
      const exists = acceptIfExists(candidate, false);
      if (exists) {
        return { filePath: exists, attemptedFiles: attempted.slice(0, 40) };
      }
    }
  }

  // 2) Merged path hints (caller + URL-derived)
  const urlHints = pathHintsFromUrl(sourceUrl);
  const hints = []
    .concat(Array.isArray(pathHints) ? pathHints : [])
    .concat(urlHints);
  const uniqueHints = [];
  for (const hint of hints) {
    const h = String(hint || '').trim();
    if (h && !uniqueHints.includes(h)) {
      uniqueHints.push(h);
    }
  }

  for (const hint of uniqueHints) {
    for (const candidate of resolveHintCandidates(hint, root)) {
      const hit = acceptIfExists(candidate, Boolean(needle));
      if (hit) {
        return { filePath: hit, attemptedFiles: attempted.slice(0, 40) };
      }
    }
  }

  // 3) Basename search from URL / hints (demo.html served from panel/)
  for (const hint of uniqueHints) {
    const base = path.posix.basename(String(hint).replace(/\\/g, '/'));
    if (!base || base === '/' || !base.includes('.')) {
      continue;
    }
    const found = findByBasename(root, base, needle);
    if (found) {
      note(found);
      return { filePath: found, attemptedFiles: attempted.slice(0, 40) };
    }
  }

  // 4) Global content search
  if (!needle) {
    return {
      filePath: null,
      reason: buildFailureReason(root, needle, attempted),
      attemptedFiles: attempted
    };
  }

  const files = [];
  walkFiles(root, files);
  for (const candidate of files) {
    note(candidate);
    try {
      const text = fs.readFileSync(candidate, 'utf8');
      if (fileContainsNeedle(text, needle)) {
        return { filePath: candidate, attemptedFiles: attempted.slice(0, 40) };
      }
    } catch {
      // skip
    }
  }

  return {
    filePath: null,
    reason: buildFailureReason(root, needle, attempted),
    attemptedFiles: attempted.slice(0, 40)
  };
}

function saveTextChange(payload, projectRoot) {
  if (!writeTextChange) {
    return {
      success: false,
      error:
        'Vizpatch text-writer not available. Set VIZPATCH_ROOT to ' +
        (resolveVizpatchRoot() || '(missing)')
    };
  }

  const selectorText = payload.selectorText;
  if (!selectorText) {
    return { success: false, error: 'selectorText is required for text save' };
  }

  const sourceUrl = payload.sourceUrl || payload.pageUrl || '';
  const resolution = resolveTextSourceFile({
    file: payload.file,
    oldValue: payload.oldValue,
    projectRoot,
    pathHints: payload.pathHints,
    sourceUrl
  });

  if (!resolution.filePath) {
    return {
      success: false,
      error: resolution.reason || 'Text source file could not be resolved',
      attemptedFiles: resolution.attemptedFiles || [],
      projectRoot
    };
  }

  try {
    const changed = writeTextChange(
      resolution.filePath,
      selectorText,
      payload.value,
      {
        oldValue: payload.oldValue,
        componentName: payload.componentName,
        sourceUrl
      }
    );
    if (!changed) {
      return {
        success: false,
        error:
          `No matching text node found for ${selectorText} in ${resolution.filePath}. ` +
          `oldValue may not appear as a hardcoded literal (dynamic/i18n/nested markup).`,
        file: resolution.filePath,
        attemptedFiles: resolution.attemptedFiles || []
      };
    }
    return { success: true, verified: true, file: resolution.filePath };
  } catch (err) {
    return { success: false, error: err.message, file: resolution.filePath };
  }
}

module.exports = {
  saveTextChange,
  resolveTextSourceFile,
  pathHintsFromUrl,
  writeTextChangeAvailable: () => Boolean(writeTextChange)
};
