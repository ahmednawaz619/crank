'use strict';

/**
 * CJS build of @ahmednawaz/crank/react.
 * Vite apps should use the ESM build (package "import" condition).
 *
 * CJS cannot use import.meta.url asset resolution — falls back to companion
 * loader, then Replit public URL.
 */

const PROXY_LOADER = '/@crank/dev-loader.js';

function getReact() {
  try {
    return require('react');
  } catch {
    throw new Error(
      '@ahmednawaz/crank/react requires react as a peer dependency (npm i react / pnpm add react).'
    );
  }
}

function detectReplitCompanionUrl() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const host = window.location.hostname || '';
    if (!/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(host)) {
      return null;
    }
    return 'https://3344-' + host.replace(/^\d+-/, '');
  } catch {
    return null;
  }
}

function resolveCrankCompanionUrl(props) {
  props = props || {};
  if (typeof window !== 'undefined' && window.__CRANK_URL__) {
    return String(window.__CRANK_URL__).replace(/\/$/, '');
  }
  if (props.companionUrl) {
    return String(props.companionUrl).replace(/\/$/, '');
  }
  if (props.url) {
    return String(props.url).replace(/\/$/, '');
  }
  const replit = detectReplitCompanionUrl();
  if (replit) {
    return replit;
  }
  return 'http://127.0.0.1:3344';
}

function resolveCrankLoaderSrc(props) {
  props = props || {};
  if (props.src) {
    return String(props.src);
  }
  if (typeof window !== 'undefined' && !props.companionUrl && !props.url && !window.__CRANK_URL__) {
    return PROXY_LOADER;
  }
  return resolveCrankCompanionUrl(props) + '/dev-loader.js';
}

function appendLoaderScript(src, onError) {
  const script = document.createElement('script');
  script.src = src.indexOf('?') >= 0 ? src : src + '?t=' + Date.now();
  script.async = true;
  script.dataset.crankLoader = '1';
  if (onError) {
    script.onerror = onError;
  }
  document.documentElement.appendChild(script);
  return script;
}

function Crank(props) {
  const React = getReact();
  props = props || {};
  const preferredSrc = resolveCrankLoaderSrc(props);

  React.useEffect(function () {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (document.getElementById('vp-shell') || document.getElementById('vp-crank-reopen')) {
      return undefined;
    }
    if (document.querySelector('script[data-crank-loader="1"]')) {
      return undefined;
    }

    // Prefer ESM panel-boot when available (dynamic import).
    var companionUrl = resolveCrankCompanionUrl(props);
    try {
      import('./panel-boot.mjs')
        .then(function (mod) {
          if (document.getElementById('vp-shell')) return;
          mod.bootCrankPanel({ companionUrl: companionUrl });
        })
        .catch(function () {
          var fallback = companionUrl + '/dev-loader.js';
          appendLoaderScript(preferredSrc, function () {
            if (preferredSrc !== fallback && !document.getElementById('vp-shell')) {
              document.querySelectorAll('script[data-crank-loader="1"]').forEach(function (el) {
                el.remove();
              });
              window.__CRANK_LOADER__ = false;
              appendLoaderScript(fallback);
            }
          });
        });
    } catch (_) {
      appendLoaderScript(preferredSrc);
    }
    return undefined;
  }, [preferredSrc]);

  return null;
}

module.exports = {
  Crank,
  CrankLoader: Crank,
  detectReplitCompanionUrl,
  resolveCrankCompanionUrl,
  resolveCrankLoaderSrc,
  default: Crank
};
