'use strict';

/**
 * Optional webpack adapter — injects /dev-loader.js via html-webpack-plugin.
 *
 *   // webpack.config.js
 *   const { crankWebpackPlugin } = require('@ahmednawaz/crank/webpack')
 *   plugins: [new HtmlWebpackPlugin(...), crankWebpackPlugin()]
 *
 * Prefer @ahmednawaz/crank/vite when the project uses Vite.
 */

const { resolveCompanionLoaderUrl } = require('./lib/loader-url');

function crankWebpackPlugin(options = {}) {
  const src = resolveCompanionLoaderUrl(options);

  return {
    apply(compiler) {
      compiler.hooks.compilation.tap('CrankWebpackPlugin', (compilation) => {
        let hooks;
        try {
          // eslint-disable-next-line import/no-extraneous-dependencies
          const HtmlWebpackPlugin = require('html-webpack-plugin');
          hooks = HtmlWebpackPlugin.getHooks(compilation);
        } catch {
          compilation.errors.push(
            new Error(
              '@ahmednawaz/crank/webpack requires html-webpack-plugin. Prefer the Vite plugin when possible.'
            )
          );
          return;
        }

        hooks.alterAssetTagGroups.tap('CrankWebpackPlugin', (data) => {
          const already = (data.headTags || []).some(
            (t) =>
              t.tagName === 'script' &&
              String(t.attributes?.src || '').includes('dev-loader.js')
          );
          if (!already) {
            data.headTags.push({
              tagName: 'script',
              voidTag: false,
              attributes: { src, defer: true, 'data-crank-loader': '1' }
            });
          }
          return data;
        });
      });
    }
  };
}

module.exports = {
  crankWebpackPlugin,
  resolveCompanionLoaderUrl
};
