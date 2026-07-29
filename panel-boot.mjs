/**
 * Retune-style panel boot — UI is embedded and injected as inline scripts
 * (same-origin, no blob: / companion :3344 fetch for the panel itself).
 * Companion is only for Glean / HTTP APIs / WebSocket — optional at boot.
 */

import {
  CRANK_PANEL_JS,
  CRANK_PANEL_CSS,
  CRANK_HELPERS_JS,
  CRANK_TEXT_SOURCE_JS,
  CRANK_GLEAN_LOGO_DATA_URI,
  CRANK_PANEL_VERSION,
  CRANK_PANEL_BUILD,
  CRANK_PANEL_CHANNEL
} from './panel-source.mjs';

function normalizePanelChannel(raw) {
  const s = String(raw || 'production')
    .trim()
    .toLowerCase();
  if (s === 'preview' || s === 'beta' || s === 'staging') {
    return 'preview';
  }
  return 'production';
}

function resolvePanelChannel() {
  if (typeof window !== 'undefined' && window.__CRANK_CHANNEL__) {
    return normalizePanelChannel(window.__CRANK_CHANNEL__);
  }
  try {
    const envCh =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_CRANK_CHANNEL;
    if (envCh) {
      return normalizePanelChannel(envCh);
    }
  } catch {
    // ignore
  }
  return normalizePanelChannel(CRANK_PANEL_CHANNEL);
}

function normalizeCompanionUrl(raw) {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) {
    return '';
  }
  if (s.startsWith('/') && typeof window !== 'undefined') {
    return window.location.origin.replace(/\/$/, '') + s;
  }
  return s;
}

function detectReplitCompanionUrl() {
  try {
    const host = window.location.hostname || '';
    if (!/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(host)) {
      return null;
    }
    return window.location.origin.replace(/\/$/, '') + '/@crank';
  } catch {
    return null;
  }
}

function resolveCompanionUrl(explicit) {
  if (explicit) {
    return normalizeCompanionUrl(explicit);
  }
  if (typeof window !== 'undefined' && window.__CRANK_URL__) {
    return normalizeCompanionUrl(window.__CRANK_URL__);
  }
  try {
    const envUrl =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      (import.meta.env.VITE_CRANK_URL || import.meta.env.VITE_CRANK_COMPANION_URL);
    if (envUrl) {
      return normalizeCompanionUrl(envUrl);
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

  if (document.getElementById('vp-shell') || document.getElementById('vp-crank-fab') || window.__CRANK_BOOTING__) {
    return { booted: false, reason: 'already-open' };
  }

  const companion = resolveCompanionUrl(options.companionUrl);
  window.__CRANK_COMPANION__ = companion;
  window.__CRANK_LOADER__ = true;
  window.__CRANK_BOOTING__ = true;
  window.__CRANK_PANEL_VERSION__ = CRANK_PANEL_VERSION;
  window.__CRANK_PANEL_BUILD__ = CRANK_PANEL_BUILD;
  window.__CRANK_PANEL_CHANNEL__ = resolvePanelChannel();
  window.__CRANK_CHANNEL__ = window.__CRANK_PANEL_CHANNEL__;

  // Inline sources — bookmarklet injects these without blob:/network (avoids ERR_FILE_NOT_FOUND).
  window.__CRANK_ASSET_SOURCE__ = {
    css: CRANK_PANEL_CSS,
    helpers: CRANK_HELPERS_JS,
    textSource: CRANK_TEXT_SOURCE_JS
  };
  window.__CRANK_GLEAN_LOGO__ = CRANK_GLEAN_LOGO_DATA_URI;
  window.__CRANK_ASSET_BASE__ = 'inline:crank/';
  try {
    if (import.meta.env?.DEV && import.meta.env?.VITE_CRANK_TEAM_TOKEN) {
      window.__CRANK_DEV_TEAM_TOKEN__ = String(import.meta.env.VITE_CRANK_TEAM_TOKEN).trim();
    }
    if (import.meta.env?.DEV) {
      window.__CRANK_PANEL_AUTO_UPDATE__ = false;
    }
  } catch {
    // ignore
  }

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
    if (reopen) reopen.remove();
    const existingFab = document.getElementById('vp-crank-fab');
    if (existingFab) existingFab.remove();
    const existingHint = document.getElementById('vp-crank-select-hint');
    if (existingHint) existingHint.remove();
    const existingShell = document.getElementById('vp-shell');
    if (existingShell) existingShell.remove();
    window.__CRANK_ASSET_SOURCE__ = {
      css: CRANK_PANEL_CSS,
      helpers: CRANK_HELPERS_JS,
      textSource: CRANK_TEXT_SOURCE_JS
    };
    window.__CRANK_GLEAN_LOGO__ = CRANK_GLEAN_LOGO_DATA_URI;
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
    script.dataset.crankPanelVersion = CRANK_PANEL_VERSION;
    script.dataset.crankPanelChannel = resolvePanelChannel();
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
