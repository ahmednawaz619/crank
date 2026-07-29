import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let crank: (() => unknown) | null = null;
try {
  const pluginPath = fileURLToPath(new URL('../.crank/vite-plugin.cjs', import.meta.url));
  if (existsSync(pluginPath)) {
    const require = createRequire(import.meta.url);
    crank = require(pluginPath).crank as () => unknown;
  }
} catch {
  /* optional */
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const devTeamToken = mode === 'development' ? String(env.CRANK_TEAM_TOKEN || '').trim() : '';

  return {
  plugins: [...(crank ? [crank({ inject: false })] : []), react()],
  define: devTeamToken
    ? { 'import.meta.env.VITE_CRANK_TEAM_TOKEN': JSON.stringify(devTeamToken) }
    : {},
  resolve: {
    alias: {
      '@ahmednawaz/crank': repoRoot,
      '@ahmednawaz/crank/react': `${repoRoot}/react.mjs`
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['!**/panel-source.mjs']
    }
  }
};
});
