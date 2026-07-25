'use strict';

/**
 * CJS build of @ahmednawaz/crank/react (browser-safe, no Node/fs).
 * Vite / modern apps should import the ESM build via package exports "import" condition.
 */

function getReact() {
  try {
    return require('react');
  } catch {
    throw new Error(
      '@ahmednawaz/crank/react requires react as a peer dependency (npm i react / pnpm add react).'
    );
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
  return 'http://localhost:3344';
}

function resolveCrankLoaderSrc(props) {
  props = props || {};
  if (props.src) {
    return String(props.src);
  }
  return `${resolveCrankCompanionUrl(props)}/dev-loader.js`;
}

function Crank(props) {
  const React = getReact();
  props = props || {};
  const src = resolveCrankLoaderSrc(props);

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (document.querySelector('script[data-crank-loader="1"]')) {
      return undefined;
    }
    if (window.__CRANK_LOADER__ && document.getElementById('vp-shell')) {
      return undefined;
    }

    const script = document.createElement('script');
    script.src = src.indexOf('?') >= 0 ? src : src + '?t=' + Date.now();
    script.async = true;
    script.dataset.crankLoader = '1';
    document.documentElement.appendChild(script);
    return undefined;
  }, [src]);

  return null;
}

module.exports = {
  Crank,
  CrankLoader: Crank,
  resolveCrankCompanionUrl,
  resolveCrankLoaderSrc,
  default: Crank
};
