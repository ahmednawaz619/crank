'use strict';

/**
 * Preview vs production release channels.
 * - production: default npm @latest, port 3344, auto-update for all users
 * - preview: npm @preview, port 3346, internal testing only
 */

const PRODUCTION = 'production';
const PREVIEW = 'preview';

function normalizeChannel(raw) {
  const s = String(raw || PRODUCTION)
    .trim()
    .toLowerCase();
  if (s === PREVIEW || s === 'beta' || s === 'staging') {
    return PREVIEW;
  }
  return PRODUCTION;
}

function isPreviewChannel(channel) {
  return normalizeChannel(channel) === PREVIEW;
}

function defaultCompanionPort(channel) {
  return isPreviewChannel(channel) ? 3346 : 3344;
}

function defaultMcpHttpPort(channel) {
  return isPreviewChannel(channel) ? 3347 : 3345;
}

function pidFileForChannel(channel) {
  return isPreviewChannel(channel)
    ? '/tmp/crank-companion-preview.pid'
    : '/tmp/crank-companion.pid';
}

function logFileForChannel(channel) {
  return isPreviewChannel(channel)
    ? '/tmp/crank-companion-preview.log'
    : '/tmp/crank-companion.log';
}

/**
 * Apply channel defaults to process.env (ports, pid/log paths).
 * @param {{ preview?: boolean, production?: boolean, explicit?: object }} [flags]
 */
function applyChannelEnv(flags = {}) {
  const channel = normalizeChannel(
    flags.preview
      ? PREVIEW
      : flags.production
        ? PRODUCTION
        : process.env.CRANK_CHANNEL
  );
  process.env.CRANK_CHANNEL = channel;
  const preview = isPreviewChannel(channel);

  if (flags.preview) {
    process.env.CRANK_PORT = String(defaultCompanionPort(PREVIEW));
    process.env.CRANK_MCP_HTTP_PORT = String(defaultMcpHttpPort(PREVIEW));
  } else if (flags.production) {
    process.env.CRANK_PORT = String(defaultCompanionPort(PRODUCTION));
    if (!process.env.CRANK_MCP_HTTP_PORT) {
      process.env.CRANK_MCP_HTTP_PORT = String(defaultMcpHttpPort(PRODUCTION));
    }
  } else {
    if (!process.env.CRANK_PORT || String(process.env.CRANK_PORT).trim() === '') {
      process.env.CRANK_PORT = String(defaultCompanionPort(channel));
    }
    if (preview && !process.env.CRANK_MCP_HTTP_PORT) {
      process.env.CRANK_MCP_HTTP_PORT = String(defaultMcpHttpPort(PREVIEW));
    }
  }
  process.env.PORT = process.env.CRANK_PORT;

  return {
    channel,
    preview,
    companionPort: Number(process.env.CRANK_PORT || defaultCompanionPort(channel)),
    mcpHttpPort: Number(
      process.env.CRANK_MCP_HTTP_PORT || defaultMcpHttpPort(channel)
    ),
    pidFile: pidFileForChannel(channel),
    logFile: logFileForChannel(channel)
  };
}

module.exports = {
  PRODUCTION,
  PREVIEW,
  normalizeChannel,
  isPreviewChannel,
  defaultCompanionPort,
  defaultMcpHttpPort,
  pidFileForChannel,
  logFileForChannel,
  applyChannelEnv
};
