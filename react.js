'use strict';

/**
 * Optional React adapter for non-Vite React apps (CRA, custom webpack, etc.).
 *
 * This is NOT a Retune-style UI component. It only injects the same /dev-loader.js
 * script the Vite plugin uses. Prefer `@ahmednawaz/crank/vite` when the app uses Vite.
 *
 *   import { CrankLoader } from '@ahmednawaz/crank/react'
 *   // in App / root layout (client-only):
 *   <CrankLoader />
 *
 * peerDependency: react >= 17
 */

const { resolveCompanionLoaderUrl } = require('./lib/loader-url');

function getReact() {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    return require('react');
  } catch {
    throw new Error(
      '@ahmednawaz/crank/react requires react as a peer dependency. Prefer the Vite plugin when possible: import { crank } from "@ahmednawaz/crank/vite".'
    );
  }
}

/**
 * Injects Crank's companion loader once on the client. Renders null.
 * @param {{ src?: string, companionUrl?: string, port?: string|number, host?: string }} props
 */
function CrankLoader(props) {
  const React = getReact();
  const src = resolveCompanionLoaderUrl(props || {});

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    if (window.__CRANK_LOADER__) {
      return undefined;
    }
    window.__CRANK_LOADER__ = true;

    const existing = document.querySelector('script[data-crank-loader="1"]');
    if (existing) {
      return undefined;
    }

    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.dataset.crankLoader = '1';
    document.documentElement.appendChild(script);
    return undefined;
  }, [src]);

  return null;
}

/** Alias — still only a script injector, not an in-tree panel UI. */
const Crank = CrankLoader;

module.exports = {
  CrankLoader,
  Crank,
  resolveCompanionLoaderUrl
};
