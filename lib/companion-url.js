'use strict';

const PROXY_PREFIX = '/@crank';

/**
 * Value written to VITE_CRANK_URL — relative on Replit (Vite proxy), absolute locally.
 * @param {{ isReplit?: boolean, useProxyPath?: boolean, companionPublicUrl?: string }} [options]
 */
function viteCrankEnvValue(options = {}) {
  if (options.isReplit || options.useProxyPath) {
    return PROXY_PREFIX;
  }
  const raw = options.companionPublicUrl || 'http://127.0.0.1:3344';
  return String(raw).replace(/\/$/, '');
}

/**
 * Expand `/@crank` to `https://app-host/@crank` in the browser.
 * @param {string} raw
 * @param {string} [origin]
 */
function normalizeCompanionUrl(raw, origin) {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) {
    return '';
  }
  if (s.startsWith('/')) {
    const base = String(origin || '').replace(/\/$/, '');
    return base ? `${base}${s}` : s;
  }
  return s;
}

/** Same-origin Vite proxy path on Replit (no hardcoded 3344 hostname). */
function defaultReplitCompanionUrl(origin) {
  return normalizeCompanionUrl(PROXY_PREFIX, origin);
}

module.exports = {
  PROXY_PREFIX,
  viteCrankEnvValue,
  normalizeCompanionUrl,
  defaultReplitCompanionUrl
};
