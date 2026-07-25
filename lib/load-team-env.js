'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Load team-wide defaults shipped in the npm tarball (team.env) or maintainer .env.
 * Never commit real keys to git — `npm run publish:team` bundles team.env at publish time.
 */
function loadTeamEnvFile(packageRoot) {
  const candidates = [
    path.join(packageRoot, 'team.env'),
    path.join(packageRoot, '.env')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const eq = trimmed.indexOf('=');
      if (eq < 1) {
        continue;
      }
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) {
        process.env[key] = value;
      }
    }
  }
}

module.exports = { loadTeamEnvFile };
