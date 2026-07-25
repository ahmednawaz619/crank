'use strict';

/**
 * Injected by Vite plugin (or bookmarklet fallback).
 * Loads the Crank panel from the local companion.
 */
(function () {
  if (window.__CRANK_LOADER__) {
    return;
  }
  window.__CRANK_LOADER__ = true;

  var params = new URLSearchParams(window.location.search);
  var autoload =
    params.get('crank') === '1' ||
    params.get('crank_autoload') === '1' ||
    localStorage.getItem('crank:autoload') === '1' ||
    true; // always on in dev when this script is injected

  if (!autoload) {
    return;
  }

  var script = document.createElement('script');
  var base = script.src || '';
  // Prefer same companion host this loader was served from.
  var companion =
    (document.currentScript && document.currentScript.src) ||
    'http://127.0.0.1:3344/dev-loader.js';
  var origin;
  try {
    origin = new URL(companion).origin;
  } catch (e) {
    origin = 'http://127.0.0.1:3344';
  }
  script.src = origin + '/bookmarklet.js?t=' + Date.now();
  script.async = true;
  document.documentElement.appendChild(script);
})();
