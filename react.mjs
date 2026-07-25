/**
 * Browser-safe React entry — Vite-bundlable (no Node/fs).
 *
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   <Crank />
 *
 * Loads companion `/dev-loader.js` (prefers same-origin `/@crank` Vite proxy on Replit).
 * Requires: `npx @ahmednawaz/crank start`
 *
 * peerDependency: react >= 17
 */

import { useEffect } from 'react';

const PROXY_LOADER = '/@crank/dev-loader.js';

/**
 * Replit public companion host from the current preview hostname.
 * e.g. 5000-foo.replit.dev → https://3344-foo.replit.dev
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
    const base = host.replace(/^\d+-/, '');
    const port = 3344;
    return `https://${port}-${base}`;
  } catch {
    return null;
  }
}

/**
 * @param {{ companionUrl?: string, url?: string, src?: string }} [props]
 * @returns {string}
 */
export function resolveCrankCompanionUrl(props = {}) {
  if (typeof window !== 'undefined' && window.__CRANK_URL__) {
    return String(window.__CRANK_URL__).replace(/\/$/, '');
  }
  if (props.companionUrl) {
    return String(props.companionUrl).replace(/\/$/, '');
  }
  if (props.url) {
    return String(props.url).replace(/\/$/, '');
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
  const replit = detectReplitCompanionUrl();
  if (replit) {
    return replit;
  }
  return 'http://localhost:3344';
}

/**
 * @param {{ companionUrl?: string, url?: string, src?: string }} [props]
 * @returns {string}
 */
export function resolveCrankLoaderSrc(props = {}) {
  if (props.src) {
    return String(props.src);
  }
  // Same-origin Vite proxy first (Replit iframe / CSP safe).
  if (typeof window !== 'undefined' && !props.companionUrl && !props.url && !window.__CRANK_URL__) {
    try {
      const envUrl =
        typeof import.meta !== 'undefined' &&
        import.meta.env &&
        (import.meta.env.VITE_CRANK_URL || import.meta.env.VITE_CRANK_COMPANION_URL);
      if (!envUrl) {
        return PROXY_LOADER;
      }
    } catch {
      return PROXY_LOADER;
    }
  }
  return `${resolveCrankCompanionUrl(props)}/dev-loader.js`;
}

function appendLoaderScript(src, onError) {
  const script = document.createElement('script');
  script.src = src.includes('?') ? src : `${src}?t=${Date.now()}`;
  script.async = true;
  script.dataset.crankLoader = '1';
  if (onError) {
    script.onerror = onError;
  }
  document.documentElement.appendChild(script);
  return script;
}

/**
 * Mount near app root. Renders null; injects the companion loader once.
 *
 * @param {{ companionUrl?: string, url?: string, src?: string }} [props]
 */
export function Crank(props = {}) {
  const preferredSrc = resolveCrankLoaderSrc(props);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (document.getElementById('vp-shell') || document.getElementById('vp-crank-reopen')) {
      return undefined;
    }
    if (document.querySelector('script[data-crank-loader="1"]')) {
      return undefined;
    }

    const fallback = `${resolveCrankCompanionUrl(props)}/dev-loader.js`;
    const primary = preferredSrc;

    appendLoaderScript(primary, () => {
      // Proxy missing (no Vite plugin) — fall back to public / localhost companion.
      if (primary !== fallback && !document.getElementById('vp-shell')) {
        document.querySelectorAll('script[data-crank-loader="1"]').forEach((el) => el.remove());
        window.__CRANK_LOADER__ = false;
        appendLoaderScript(fallback);
      }
    });
    return undefined;
  }, [preferredSrc]);

  return null;
}

/** Explicit alias. */
export const CrankLoader = Crank;

export default Crank;
