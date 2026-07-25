/**
 * Retune-style React entry — browser-only, Vite-bundlable (no Node/fs).
 *
 *   // main.tsx
 *   import { Crank } from '@ahmednawaz/crank/react'
 *   // or: import { Crank } from '@ahmednawaz/crank'
 *
 *   <Crank />
 *
 * Mount near your app root. Injects companion `/dev-loader.js` once (same panel as the
 * optional Vite plugin). Requires the companion process: `npx @ahmednawaz/crank start`
 *
 * peerDependency: react >= 17
 */

import { useEffect } from 'react';

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
  return `${resolveCrankCompanionUrl(props)}/dev-loader.js`;
}

/**
 * Retune-style one-liner. Renders null; injects the companion loader script on the client.
 *
 * Do not set window.__CRANK_LOADER__ here — `/dev-loader.js` owns that flag and loads the panel.
 *
 * @param {{ companionUrl?: string, url?: string, src?: string }} [props]
 */
export function Crank(props = {}) {
  const src = resolveCrankLoaderSrc(props);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (document.querySelector('script[data-crank-loader="1"]')) {
      return undefined;
    }
    // Panel already live (bookmarklet / prior mount)
    if (window.__CRANK_LOADER__ && document.getElementById('vp-shell')) {
      return undefined;
    }

    const script = document.createElement('script');
    script.src = src.includes('?') ? src : `${src}?t=${Date.now()}`;
    script.async = true;
    script.dataset.crankLoader = '1';
    document.documentElement.appendChild(script);
    return undefined;
  }, [src]);

  return null;
}

/** Explicit alias. */
export const CrankLoader = Crank;

export default Crank;
