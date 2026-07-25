# For teammates (zero setup)

From **any app repo** — no clone, no GitHub invite, no API key:

```bash
npx @ahmednawaz619/crank setup
npx @ahmednawaz619/crank
```

Open the app → select copy → **Get options**.

**Replit:** same commands in the Repl Shell — project path is auto-detected. See [SETUP.md](./SETUP.md) for MCP Integrations step.

**Full checklist:** [SETUP.md](./SETUP.md)

---

**Maintainer (you) — one time:**

```bash
npm login
npm run publish:team
```

That publishes to npm with the shared Glean key bundled (not in GitHub).

---

**Note:** Public npm means anyone *could* install the package. The shared Glean key is inside the published tarball for now — add guardrails (private npm / hosted companion) later.
