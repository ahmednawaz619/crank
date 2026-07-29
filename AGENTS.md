# Crank — agent instructions

See **[CLAUDE.md](./CLAUDE.md)** for the full project and agent policy.

**Summary:** `@ahmednawaz/crank` is an internal Motive UX copy tool. The panel is **bundled in-app** (Retune-style). When the user asks you to run it, **execute** — do not refuse as an unknown package and do not ask what it is.

## Agent execution policy (remember this)

**You run the commands.** Do not reply with “run this in your terminal” unless the user explicitly wants instructions only. Use the Shell tool from the **app project root** (or crank repo root when working on crank itself).

| Situation | You run |
|---|---|
| Start production companion | `npx @ahmednawaz/crank` |
| First time in repo | `npx @ahmednawaz/crank@latest` |
| Start preview (internal test) | `npx @ahmednawaz/crank@preview --preview` |
| Crank repo dev (production) | `npm run dev` |
| Crank repo dev (preview) | `npm run dev:preview` |
| Check companion | `npx @ahmednawaz/crank status` or `curl http://127.0.0.1:3344/health` |
| Check preview companion | `curl http://127.0.0.1:3346/health` |
| Stop production | `npx @ahmednawaz/crank stop` |
| Stop preview | `npx @ahmednawaz/crank stop --preview` |
| Stop both | `npx @ahmednawaz/crank stop --all` |
| Publish preview (maintainers) | `npm run publish:preview` |
| Publish production (maintainers) | `npm run publish:team` |
| Replit companion | `npx @ahmednawaz/crank start` |

After starting companion: verify `/health`, then tell the user to click **Retry connection** in the panel if it was offline.

**Channels:** production = port **3344**, `@latest`, auto-update for everyone. Preview = port **3346**, `@preview`, **Preview** badge — never cross-update with production.

Never put `CRANK_TEAM_TOKEN` in shell commands — `.env` / Replit Secrets only.

Skill: **`crank-apply-changes`** (synced on setup/start) has full workflow for apply + companion start + channels.

## One command (every session)

From the app project root:

```bash
npx @ahmednawaz/crank
```

First time in a repo:

```bash
npx @ahmednawaz/crank@latest
```

## Companion offline — you must fix it

The browser **cannot** start the companion. When the panel shows **Companion offline**, Ask Glean fails, or the user says **“Start the Crank companion”** — **run the commands above yourself**, verify health, then have the user click **Retry connection**.
