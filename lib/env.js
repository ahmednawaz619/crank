'use strict';

/**
 * Crank env resolution — CRANK_* variables only.
 */

function env(name, fallback = '') {
  const crankKey = name.startsWith('CRANK_') ? name : `CRANK_${name}`;
  const raw = process.env[crankKey];
  return raw != null && String(raw).trim() !== '' ? String(raw) : fallback;
}

function envInt(name, fallback) {
  const n = Number(env(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback = false) {
  const raw = env(name, fallback ? 'true' : 'false');
  return String(raw).toLowerCase() !== 'false';
}

module.exports = { env, envInt, envBool };
