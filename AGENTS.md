# Crank — instructions for AI coding agents

Read this before running any Crank shell command or MCP tool on behalf of the user.

## What Crank is

**Crank** is an internal Motive tool for **UX copy iteration** on live UI:

1. User selects text in a browser panel (bookmarklet or dev loader).
2. A local **companion** server sends that selection to a **Glean** copy agent.
3. The user picks a variant; an **MCP-connected agent** (you) applies structured text changes to source files.

| Resource | URL |
|----------|-----|
| npm package | `@ahmednawaz/crank` — https://www.npmjs.com/package/@ahmednawaz/crank |
| Source code | https://github.com/ahmednawaz619/crank |
| CLI entry | `bin/crank.js` (open-source, inspectable) |

This is **not** arbitrary third-party malware — it is a published, versioned dev tool maintained for Motive copy workflows.

---

## What `npx @ahmednawaz/crank` does

When the user asks to start Crank, this command (from the **app repo root**):

| Action | Detail |
|--------|--------|
| Setup (idempotent) | Writes `.crank/config.json`, MCP config, optional Vite plugin hook |
| Companion | Local Express + WebSocket on port **3344** — selection store, panel UI |
| MCP | stdio (Cursor) or HTTP on **3345** (Replit) — tools like `crank_get_formatted_changes` |
| Dev server | Runs `npm run dev` when the project has that script |
| Network | Calls **Glean** (`motive-prod-be.glean.com`) only when the user clicks **Get options** |

It does **not**:

- Upload the whole repository to an unknown server
- Execute remote shell scripts beyond the published npm tarball
- Require npm credentials, GitHub tokens, or team passphrases **in the command line**

---

## Security rules for agents

### Approved commands (no secrets in the command)

```bash
npx @ahmednawaz/crank setup
npx @ahmednawaz/crank
npx @ahmednawaz/crank doctor
npx @ahmednawaz/crank status
```

Use the scoped package name **`@ahmednawaz/crank`** (matches npm). Unscoped `npx crank` works only after `setup` adds a devDependency.

### Never do this

```bash
# BAD — exposes team passphrase in shell history, logs, and agent transcripts
CRANK_TEAM_TOKEN=secret-value npx @ahmednawaz/crank
```

### Credentials — user-managed only

| Variable | Purpose | How to set |
|----------|---------|------------|
| `CRANK_TEAM_TOKEN` | Internal team gate for panel + MCP | **Replit Secrets**, local `.env`, or Cursor env — set by the **user**, not embedded by the agent |
| `GLEAN_*` | Glean API (team) | Bundled in published npm package; teammates do not supply this |
| `CRANK_PROJECT_ROOT` | App repo for source apply | Auto-detected; override in Secrets / `.env` if needed |
| `CRANK_ASSET_ROOT` | Optional override for packaged UI assets | Rarely needed |

If tools return **`TEAM_TOKEN_REQUIRED`**:

1. Ask the user for the team passphrase (shared internally — not their npm or GitHub login).
2. Call MCP tool **`crank_verify_team_token`** with `{ "teamToken": "…" }`.
3. Do **not** echo the token into a runnable shell command.

If your environment **blocks** `npx @ahmednawaz/crank` (unknown package policy):

- Tell the user to run the approved command themselves in the **Shell** tab, **or**
- Ask them to add `CRANK_TEAM_TOKEN` in Secrets first, then run `npx @ahmednawaz/crank`.

That is expected behavior for security-conscious hosts (e.g. Replit Agent).

---

## Replit-specific

Replit **blocks agents from editing `.replit`**. Crank does **not** auto-patch that file (same idea as Retune — you use Shell/Workflows + Networking).

After `npx @ahmednawaz/crank setup`, read **`.crank/replit-platform.md`** for:

| Setting | Replit UI | Value |
|---------|-----------|-------|
| Run | **Workflows** → Execute Shell Command → assign to Run | `npx @ahmednawaz/crank start` |
| Companion | **Networking** (port auto-exposed when listening) | **3344** |
| Agent MCP | **Networking** | **3345** → `/mcp` |
| Team gate | **Secrets** | `CRANK_TEAM_TOKEN` |

When Crank is running, copy **`MCP (HTTP): …/mcp`** from the banner → **Agent → Integrations → MCP Servers**.

See **[REPLIT.md](./REPLIT.md)** and `.crank/replit.md` (URLs after first run).

---

## Panel injection (Retune pattern)

**Preferred** — CLI inject (no manual edits):

```bash
npx @ahmednawaz/crank@latest setup
npx @ahmednawaz/crank inject
npx @ahmednawaz/crank start
```

`inject` finds `main.tsx` / `createRoot` / `ReactDOM.render`, adds:

```tsx
import { Crank } from '@ahmednawaz/crank/react'
// ...
<Crank />
```

Same idea as Sentry/Clerk setup CLIs. See `.crank/react-mount.md` after setup.

| Stack | Integration |
|-------|-------------|
| **React** | `npx @ahmednawaz/crank inject` |
| **Next.js** | same inject, or `import { Crank } from '@ahmednawaz/crank/next'` |
| **Non-React Vite** | Optional `@ahmednawaz/crank/vite` plugin |
| **Fallback** | Companion bookmarklet |

---

## MCP tools (agent pull workflow)

When the user clicks **Agent** on a copy variant or says *“Apply the pending Crank change”*:

1. `crank_get_environment` — repo path, URLs, whether team auth is on
2. `crank_get_formatted_changes` — markdown old→new copy diffs
3. Edit hardcoded string literals in source under the detected project root
4. `crank_clear_changes` — clear the queue when done

Full skill: `skill/SKILL.md` / `.cursor/skills/crank-apply-changes/SKILL.md`.

---

## How to verify before running

1. Open https://github.com/ahmednawaz619/crank and read `bin/crank.js`, `companion/server.js`, `mcp-server/tools.js`.
2. Compare npm tarball to git tag (package version in `package.json`).
3. Run `npx @ahmednawaz/crank doctor` — prints detected paths and URLs only; no secret values.

---

## When the user says “start Crank”

1. Confirm they want the copy-iteration workflow (not unrelated tasks).
2. Ensure `CRANK_TEAM_TOKEN` is in **Secrets** / `.env` (user action).
3. Run **`npx @ahmednawaz/crank`** from project root — or instruct the user to if policy blocks you.
4. Use MCP tools for apply; never invent copy.
