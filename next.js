'use strict';

/**
 * Optional Next.js adapter — injects Crank via next/script (App Router or Pages).
 *
 * Prefer Vite plugin for Vite apps. Use this for Next.js when there is no vite.config.
 *
 *   // app/layout.tsx (or a client layout section)
 *   import { CrankScript } from '@ahmednawaz/crank/next'
 *   <CrankScript />
 *
 * peerDependencies: react, next
 */

const { resolveCompanionLoaderUrl } = require('./lib/loader-url');
const { CrankLoader } = require('./react');

function getReact() {
  try {
    return require('react');
  } catch {
    throw new Error(
      '@ahmednawaz/crank/next requires react. Prefer @ahmednawaz/crank/vite for Vite apps.'
    );
  }
}

function getNextScript() {
  try {
    return require('next/script');
  } catch {
    return null;
  }
}

/**
 * @param {{ src?: string, companionUrl?: string, strategy?: string }} props
 */
function CrankScript(props) {
  const React = getReact();
  const NextScript = getNextScript();
  const src = resolveCompanionLoaderUrl(props || {});
  const strategy = (props && props.strategy) || 'afterInteractive';

  if (NextScript) {
    const Script = NextScript.default || NextScript;
    return React.createElement(Script, {
      src,
      strategy,
      'data-crank-loader': '1'
    });
  }

  // Fallback when next/script is unavailable (tests / non-Next bundlers).
  return React.createElement(CrankLoader, props || {});
}

module.exports = {
  CrankScript,
  CrankLoader,
  Crank: CrankScript,
  resolveCompanionLoaderUrl
};
