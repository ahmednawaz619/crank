/**
 * Retune-style panel boot — UI is **embedded in the npm package** and injected
 * via blob: URLs (same-origin). Companion :3344 is only for Glean / APIs / WS.
 */

import {
  CRANK_PANEL_JS,
  CRANK_PANEL_CSS,
  CRANK_HELPERS_JS,
  CRANK_TEXT_SOURCE_JS
} from './panel-source.mjs';

function detectReplitCompanionUrl() {
  try {
    const host = window.location.hostname || '';
    if (!/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(host)) {
      return null;
    }
    return `https://3344-${host.replace(/^\d+-/, '')}`;
  } catch {
    return null;
  }
}

function resolveCompanionUrl(explicit) {
  if (explicit) {
    return String(explicit).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.__CRANK_URL__) {
    return String(window.__CRANK_URL__).replace(/\/$/, '');
  }
  try {
    const envUrl =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env.VITE_CRANK_URL || import.meta.env.VITE_CRANK_COMPANION_URL);
    if (envUrl) {
      return String(envUrl).replace(/\/$/, '');
    }
  } catch {
    // ignore
  }
  return detectReplitCompanionUrl() || 'http://127.0.0.1:3344';
}

function blobUrl(source, type) {
  return URL.createObjectURL(new Blob([source], { type }));
}

function installAssetMap() {
  window.__CRANK_ASSET_MAP__ = {
    'crank-ui.css': blobUrl(CRANK_PANEL_CSS, 'text/css'),
    'crank-ui-helpers.js': blobUrl(CRANK_HELPERS_JS, 'text/javascript'),
    'text-source.js': blobUrl(CRANK_TEXT_SOURCE_JS, 'text/javascript'),
    'crank-bookmarklet.js': blobUrl(CRANK_PANEL_JS, 'text/javascript')
  };
  window.__CRANK_ASSET_BASE__ = 'blob:crank/';
}

/**
 * Boot the Crank panel into the page (idempotent).
 * @param {{ companionUrl?: string }} [options]
 */
export function bootCrankPanel(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { booted: false, reason: 'ssr' };
  }

  if (document.getElementById('vp-shell')) {
    return { booted: false, reason: 'already-open' };
  }

  const companion = resolveCompanionUrl(options.companionUrl);
  window.__CRANK_COMPANION__ = companion;
  window.__CRANK_LOADER__ = true;
  installAssetMap();

  window.__crankBootEmbedded = function reboot() {
    window.__CRANK_LOADER__ = false;
    window.__crankActive = false;
    if (typeof window.__crankTeardown === 'function') {
      try {
        window.__crankTeardown();
      } catch {
        // ignore
      }
    }
    const reopen = document.getElementById('vp-crank-reopen');
    if (reopen) {
      reopen.remove();
    }
    return bootCrankPanel({ companionUrl: companion });
  };

  document.querySelectorAll('script[data-crank-loader="1"]').forEach((el) => {
    try {
      el.remove();
    } catch {
      // ignore
    }
  });

  const script = document.createElement('script');
  script.src = window.__CRANK_ASSET_MAP__['crank-bookmarklet.js'];
  script.async = true;
  script.dataset.crankLoader = '1';
  script.dataset.crankBundled = '1';
  script.onerror = () => {
    console.error('[Crank] Failed to boot embedded panel');
    window.__CRANK_LOADER__ = false;
  };
  document.documentElement.appendChild(script);

  return { booted: true, companion, mode: 'embedded' };
}

export function crankAssetBaseUrl() {
  return 'blob:crank/';
}

export function crankBookmarkletUrl() {
  return 'embedded:crank-bookmarklet';
}

export default bootCrankPanel;
