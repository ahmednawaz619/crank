# Mount Crank (Retune-style)

Run (preferred — no manual edits):

```bash
npx @ahmednawaz/crank inject
```

That installs `@ahmednawaz/crank` and patches your entry file with:

```tsx
import { Crank } from '@ahmednawaz/crank/react'

<Crank />
```

Then start the companion:

```bash
npx @ahmednawaz/crank start
```

On Replit, set the public companion URL if the preview is not on localhost:

```ts
window.__CRANK_URL__ = 'https://3344-<your-repl>.replit.dev'
// or: <Crank companionUrl="https://3344-….replit.dev" />
// or: VITE_CRANK_URL=https://3344-….replit.dev
```

No Vite plugin required.
