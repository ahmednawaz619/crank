# Crank panel injection

## Preferred — `npx @ahmednawaz/crank inject`

Patches your entry file automatically (Sentry/Clerk-style). No manual edits.

```bash
npx @ahmednawaz/crank@latest setup
npx @ahmednawaz/crank inject
npx @ahmednawaz/crank start
```

Adds:

```tsx
import { Crank } from '@ahmednawaz/crank/react'
<Crank />
```

URL resolution (first match):
1. `window.__CRANK_URL__`
2. `<Crank companionUrl="…" />` / `url` prop
3. `VITE_CRANK_URL` / `VITE_CRANK_COMPANION_URL`
4. `http://localhost:3344`

See `.crank/react-mount.md` when this project has React.

## Next.js

```bash
npx @ahmednawaz/crank inject
```

## Non-React Vite (Vue / Svelte / vanilla)

Optional Vite plugin: `import { crank } from "@ahmednawaz/crank/vite"` — only if you are not using React.

## Bookmarklet fallback

Open the companion URL → drag the bookmarklet onto any preview page.

## Detected in this project

- hasReact: true
- hasVite: true
- viteConfig: /Users/ahmed.nawaz/Downloads/crank/client/vite.config.ts
- hasNext: false
- hasWebpack: false
