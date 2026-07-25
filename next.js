'use strict';

/**
 * CJS Next adapter — prefer ESM `next.mjs` via package exports.
 */

const {
  Crank: CrankEffect,
  resolveCrankLoaderSrc,
  resolveCrankCompanionUrl
} = require('./react.js');

function getReact() {
  try {
    return require('react');
  } catch {
    throw new Error('@ahmednawaz/crank/next requires react');
  }
}

function Crank(props) {
  const React = getReact();
  props = props || {};
  const src = resolveCrankLoaderSrc(props);
  const strategy = props.strategy || 'afterInteractive';

  let Script = null;
  try {
    const mod = require('next/script');
    Script = mod.default || mod;
  } catch {
    Script = null;
  }

  if (Script) {
    return React.createElement(Script, {
      src: src.indexOf('?') >= 0 ? src : src + '?t=' + Date.now(),
      strategy,
      'data-crank-loader': '1'
    });
  }

  return React.createElement(CrankEffect, props);
}

module.exports = {
  Crank,
  CrankScript: Crank,
  CrankLoader: Crank,
  resolveCrankLoaderSrc,
  resolveCrankCompanionUrl,
  default: Crank
};
