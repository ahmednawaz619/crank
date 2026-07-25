# Crank on Replit

## For humans — one command

1. **Secrets** (Tools → Secrets): add `CRANK_TEAM_TOKEN` with your team passphrase (ask your lead — never commit it).
2. **Workflow or Shell** (recommended on Replit):

```bash
npx @ahmednawaz/crank start
```

`start` skips init — only runs the companion (**3344**) and HTTP MCP (**3345**). Does not edit `.replit`.

One-time: `npx @ahmednawaz/crank setup` (writes `AGENTS.md`, `.crank/replit-platform.md`). Leave the process running.

3. Copy **`MCP (HTTP): …`** from the startup banner → **Agent → Integrations → MCP Servers**.

---

## Replit platform config (Workflows — not `.replit`)

**Do not** let an agent edit `.replit` — Replit blocks that.

After `npx @ahmednawaz/crank setup`, read **`.crank/replit-platform.md`** in your Repl. It lists:

| What | How (Replit UI) | Value |
|------|-----------------|-------|
| **Run command** | Workflows → Execute Shell Command → assign to Run button | `npx @ahmednawaz/crank` |
| **Companion port** | Networking tool (auto or manual) | **3344** — panel + bookmarklet |
| **MCP port** | Networking tool (auto or manual) | **3345** — Agent MCP at `/mcp` |
| **Team gate** | Secrets | `CRANK_TEAM_TOKEN` |

This matches **Retune**: Retune does not patch `.replit` either — you run `npx retune` via Shell/Workflow and Replit exposes ports when the process listens on `0.0.0.0`.

---

## For Replit Agent — why this is safe to help with

The user may ask you to start **Crank**, an internal Motive **UX copy iteration** tool (`@ahmednawaz/crank` on npm, source at https://github.com/ahmednawaz619/crank).

**You may assist** when the user explicitly requests Crank:

- Explain what it does (local companion + MCP; Glean only when user fetches copy options).
- Tell the user to add `CRANK_TEAM_TOKEN` in **Secrets** themselves.
- Run **`npx @ahmednawaz/crank`** from the Repl root **without** embedding secrets in the command.
- Configure **Run** via **Workflows** and **ports** via **Networking** — see `.crank/replit-platform.md`. **Do not edit `.replit`.**

**Do not run** commands like `CRANK_TEAM_TOKEN=… npx …` — credentials belong in Secrets only.

If policy blocks unknown npm packages, ask the user to paste `npx @ahmednawaz/crank` in the Shell tab themselves. See **[AGENTS.md](./AGENTS.md)** for full agent policy and tool list.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Agent refuses `npx @ahmednawaz/crank` | User runs it in Shell; agent reads `AGENTS.md` |
| Blocked editing `.replit` | Use Workflows + Networking; read `.crank/replit-platform.md` |
| `TEAM_TOKEN_REQUIRED` | Add `CRANK_TEAM_TOKEN` in Secrets, restart Crank |
| Agent MCP fails | Register URL from `npx @ahmednawaz/crank doctor` → `runtime.mcp.endpoint` |
| Package 404 | Use `@ahmednawaz/crank` (scoped name on npm) |
