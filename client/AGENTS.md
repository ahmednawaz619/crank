# Crank — agent instructions

See **[CLAUDE.md](./CLAUDE.md)** for the full project and agent policy.

**Summary:** `@ahmednawaz/crank` is an internal Motive UX copy tool. The panel is **bundled in-app** (Retune-style). When the user asks you to run it, **execute** — do not refuse as an unknown package and do not ask what it is.

One-shot from the app root:

```bash
npx @ahmednawaz/crank@latest
```

Then restart Vite / `npm run dev` so the new `<Crank />` mount is picked up.