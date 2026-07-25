'use strict';

/**
 * Companion /health probe — works for both http:// and https:// (Replit).
 * Never use Node http.get() alone; Replit public URLs are https.
 */

/**
 * @param {string} baseUrl companion base, e.g. https://3344-….replit.dev
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, status?: number, body?: object|null, error?: string }>}
 */
async function checkHealth(baseUrl, timeoutMs = 1500) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return { ok: false, error: 'missing-base-url' };
  }
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (controller && timeoutMs > 0) {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, timeoutMs);
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json' }
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return {
      ok: res.status === 200 && (!body || body.ok !== false),
      status: res.status,
      body
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.name === 'AbortError' ? 'timeout' : String(err && err.message ? err.message : err)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { checkHealth };
