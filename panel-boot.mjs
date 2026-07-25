/**
 * Retune-style panel boot — UI is embedded and injected as inline scripts
 * (same-origin, no blob: / companion :3344 fetch for the panel itself).
 * Companion is only for Glean / HTTP APIs / WebSocket — optional at boot.
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

/**
 * Boot the Crank panel into the page (idempotent).
 * @param {{ companionUrl?: string }} [options]
 */
export function bootCrankPanel(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { booted: false, reason: 'ssr' };
  }

  if (document.getElementById('vp-shell') || window.__CRANK_BOOTING__) {
    return { booted: false, reason: 'already-open' };
  }

  const companion = resolveCompanionUrl(options.companionUrl);
  window.__CRANK_COMPANION__ = companion;
  window.__CRANK_LOADER__ = true;
  window.__CRANK_BOOTING__ = true;

  // Inline sources — bookmarklet injects these without blob:/network (avoids ERR_FILE_NOT_FOUND).
  window.__CRANK_ASSET_SOURCE__ = {
    css: CRANK_PANEL_CSS,
    helpers: CRANK_HELPERS_JS,
    textSource: CRANK_TEXT_SOURCE_JS
  };
  window.__CRANK_ASSET_BASE__ = 'inline:crank/';

  window.__crankBootEmbedded = function reboot() {
    window.__CRANK_LOADER__ = false;
    window.__CRANK_BOOTING__ = false;
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

  try {
    const script = document.createElement('script');
    script.textContent = CRANK_PANEL_JS;
    script.dataset.crankLoader = '1';
    script.dataset.crankBundled = '1';
    document.documentElement.appendChild(script);
  } catch (err) {
    console.error('[Crank] Failed to boot embedded panel', err);
    window.__CRANK_LOADER__ = false;
    window.__CRANK_BOOTING__ = false;
    return { booted: false, reason: 'inject-failed', error: String(err) };
  } finally {
    // Panel IIFE runs sync via textContent; clear boot lock shortly after.
    setTimeout(() => {
      window.__CRANK_BOOTING__ = false;
    }, 0);
  }

  return { booted: true, companion, mode: 'embedded-inline' };
}

export function crankAssetBaseUrl() {
  return 'inline:crank/';
}

export function crankBookmarkletUrl() {
  return 'embedded:crank-bookmarklet';
}

export default bootCrankPanel;
