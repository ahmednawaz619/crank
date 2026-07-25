'use strict';

const TEAM_TOKEN = String(
  process.env.CRANK_TEAM_TOKEN || process.env.VIZCOPY_TEAM_TOKEN || ''
).trim();

function teamAuthRequired() {
  return TEAM_TOKEN.length > 0;
}

function extractTeamToken(req) {
  if (!req) return '';
  const header =
    req.get?.('x-crank-team-token') ||
    req.headers?.['x-crank-team-token'] ||
    req.headers?.['X-Crank-Team-Token'];
  if (header) return String(header).trim();

  const auth = req.get?.('authorization') || req.headers?.authorization || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;

  if (req.body && typeof req.body.teamToken === 'string') {
    return req.body.teamToken.trim();
  }
  if (req.query && req.query.teamToken) {
    return String(req.query.teamToken).trim();
  }

  try {
    const raw = req.url || '';
    const q = raw.indexOf('?');
    if (q >= 0) {
      const params = new URLSearchParams(raw.slice(q + 1));
      return (
        params.get('teamToken') ||
        params.get('token') ||
        ''
      ).trim();
    }
  } catch {
    // ignore
  }
  return '';
}

function isTeamTokenValid(token) {
  if (!teamAuthRequired()) return true;
  return String(token || '').trim() === TEAM_TOKEN;
}

function teamAuthMiddleware(req, res, next) {
  if (!teamAuthRequired()) {
    next();
    return;
  }
  if (isTeamTokenValid(extractTeamToken(req))) {
    next();
    return;
  }
  res.status(401).json({
    ok: false,
    code: 'TEAM_TOKEN_REQUIRED',
    error:
      'Crank team token required. Ask your team for the passphrase, then pass header X-Crank-Team-Token or set CRANK_TEAM_TOKEN for the agent.'
  });
}

function getAuthStatus() {
  return {
    teamAuthRequired: teamAuthRequired(),
    hint: teamAuthRequired()
      ? 'Ask your team lead for the Crank team token. Agents: pass teamToken on MCP tools or set CRANK_TEAM_TOKEN in the environment.'
      : null
  };
}

module.exports = {
  teamAuthRequired,
  extractTeamToken,
  isTeamTokenValid,
  teamAuthMiddleware,
  getAuthStatus
};
