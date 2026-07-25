# For teammates (zero setup)

From **any app repo** — no clone, no GitHub invite, no API key:

```bash
npx @ahmednawaz/crank setup
npx @ahmednawaz/crank
```

Add **`CRANK_TEAM_TOKEN`** in Replit Secrets or local `.env` yourself — never paste it into a command.

Open the app → select copy → **Get options**.

**Replit:** see [REPLIT.md](./REPLIT.md) and **AGENTS.md** (for AI agent policy).  
**Full checklist:** [SETUP.md](./SETUP.md)

---

**Maintainer (you) — one time:**

```bash
npm login
npm run publish:team
```

That publishes to npm with the shared Glean key bundled (not in GitHub).
