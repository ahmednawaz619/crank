/**
 * Crank React entry — Retune-style: panel UI is **bundled with the app**, not
 * fetched from companion :3344 (that broke Replit iframe previews).
 *
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   <Crank />
 *
 * peerDependency: react >= 17
 */

import { useEffect } from 'react';
import { bootCrankPanel } from './panel-boot.mjs';
/** Bumped each release — invalidates Vite optimizeDeps cache for this entry. */
export const CRANK_REACT_LOADER_VERSION = "0.3.11";


/**
 * Replit: same-origin Vite proxy path (not external :3344 hostname).
 * @returns {string | null}
 */
export function detectReplitCompanionUrl() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const host = window.location.hostname || '';
    if (!/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(host)) {
      return null;
    }
    return `${window.location.origin.replace(/\/$/, '')}/@crank`;
  } catch {
    return null;
  }
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

/**
 * @param {{ companionUrl?: string, url?: string, src?: string, force?: boolean }} [props]
 * @returns {string}
 */
export function resolveCrankCompanionUrl(props = {}) {
  if (typeof window !== 'undefined' && window.__CRANK_URL__) {
    return normalizeCompanionUrl(window.__CRANK_URL__);
  }
  if (props.companionUrl) {
    return normalizeCompanionUrl(props.companionUrl);
  }
  if (props.url) {
    return normalizeCompanionUrl(props.url);
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
  const replit = detectReplitCompanionUrl();
  if (replit) {
    return replit;
  }
  try {
    const envCh =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.VITE_CRANK_CHANNEL;
    if (String(envCh || '').toLowerCase() === 'preview') {
      return 'http://127.0.0.1:3346';
    }
  } catch {
    // ignore
  }
  return 'http://127.0.0.1:3344';
}

/**
 * @deprecated Panel loads from the package bundle. Prefer omitting src.
 * @param {{ companionUrl?: string, url?: string, src?: string }} [props]
 * @returns {string}
 */
export function resolveCrankLoaderSrc(props = {}) {
  if (props.src) {
    return String(props.src);
  }
  return `${resolveCrankCompanionUrl(props)}/dev-loader.js`;
}

function isDevMode(force) {
  if (force) {
    return true;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      return true;
    }
  } catch {
    // ignore
  }
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
      return true;
    }
  } catch {
    // ignore
  }
  // Default on — Crank is a dev tool; force=false only hides when clearly production.
  try {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

/**
 * Mount near app root (Retune pattern). Boots the bundled panel once.
 *
 * @param {{ companionUrl?: string, url?: string, src?: string, force?: boolean }} [props]
 */
export function Crank(props = {}) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (!isDevMode(props.force)) {
      return undefined;
    }
    if (
      document.getElementById('vp-shell') ||
      document.getElementById('vp-crank-fab') ||
      document.getElementById('vp-crank-reopen')
    ) {
      return undefined;
    }

    // Legacy: explicit src still supported (companion-hosted loader)
    if (props.src) {
      if (document.querySelector('script[data-crank-loader="1"]')) {
        return undefined;
      }
      const script = document.createElement('script');
      script.src = props.src.includes('?') ? props.src : `${props.src}?t=${Date.now()}`;
      script.async = true;
      script.dataset.crankLoader = '1';
      document.documentElement.appendChild(script);
      return undefined;
    }

    bootCrankPanel({
      companionUrl: resolveCrankCompanionUrl(props)
    });
    return undefined;
  }, [props.companionUrl, props.url, props.src, props.force]);

  return null;
}

/** Dev: re-boot FAB/panel when panel-source.mjs is re-embedded (watch-panel.js). */
if (typeof import.meta !== 'undefined' && import.meta.hot) {
  import.meta.hot.accept('./panel-boot.mjs', (mod) => {
    const shell = document.getElementById('vp-shell');
    if (shell && shell.querySelector('#vc-glean')) {
      return;
    }
    if (typeof window.__crankTeardown === 'function') {
      try {
        window.__crankTeardown();
      } catch {
        /* ignore */
      }
    }
    window.__CRANK_BOOTING__ = false;
    window.__CRANK_LOADER__ = false;
    const boot = mod.bootCrankPanel || mod.default;
    boot({
      companionUrl:
        (typeof window !== 'undefined' && window.__CRANK_COMPANION__) ||
        resolveCrankCompanionUrl({})
    });
  });
}

/** Explicit alias. */
export const CrankLoader = Crank;

export default Crank;
