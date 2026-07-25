# Crank — setup checklist

Everything below that says **you** must be done on your machine or in Replit. Everything else is already done in the repo.

---

## Already done (in the repo)

- GitHub: https://github.com/ahmednawaz619/crank (public)
- Package name: `@ahmednawaz619/crank@0.1.1`
- Team passphrase lock (`CRANK_TEAM_TOKEN`) on panel + MCP + WebSocket
- Agent asks user for token via `crank_verify_team_token`
- Auto-detect project root (no paths in Replit / Cursor)
- Shared Glean key bundling for npm (`team.env` at publish — **not** the team token)

---

## YOU — Step 0: Pick a team passphrase (once)

Choose a shared phrase only your team knows, e.g. `motive-crank-2026`.

Add it to your Crank `.env` (never commit):

```bash
# /Users/ahmed.nawaz/Downloads/vizcopy/.env
CRANK_TEAM_TOKEN=motive-crank-2026
```

Share this phrase with teammates via Slack / 1Password — **not** in GitHub or npm.

When `CRANK_TEAM_TOKEN` is set, the companion requires it for the panel and MCP. The npm package does **not** include this token.

---

## YOU — Step 1: Publish to npm (once, ~2 min)

```bash
npm login
cd /Users/ahmed.nawaz/Downloads/vizcopy
npm run publish:team
```

Publishes `@ahmednawaz619/crank@0.1.1` with bundled Glean key (not team token).

---

## YOU — Step 2: Test locally (optional)

```bash
cd /path/to/your-app
CRANK_TEAM_TOKEN=motive-crank-2026 npx @ahmednawaz619/crank setup
CRANK_TEAM_TOKEN=motive-crank-2026 npx @ahmednawaz619/crank
```

Panel prompts for token if omitted — paste the shared phrase.

---

## YOU — Step 3: Test in Replit

### 3a. Replit Secrets (once per Repl)

Add:

| Key | Value |
|-----|--------|
| `CRANK_TEAM_TOKEN` | your shared phrase (same as Step 0) |

(Glean key comes from npm — no `GLEAN_API_KEY` needed if you published with `publish:team`.)

### 3b. Shell — once

```bash
npx @ahmednawaz619/crank setup
```

### 3c. Shell or Run — keep running

```bash
npx @ahmednawaz619/crank
```

Banner should say `Team lock: ON`.

### 3d. Replit Agent MCP — once

```bash
npx @ahmednawaz619/crank doctor
```

Add **`runtime.mcp.endpoint`** in Agent → Integrations → MCP Servers.

### 3e. Test panel + agent

1. Webview → select copy → **Get options** (enter team token if prompted)
2. Agent chat: *“What is the Crank team token?”* → you paste the phrase → agent calls `crank_verify_team_token`
3. Then: *Apply the pending Crank change*

---

## What teammates run

Share two things internally:

1. **Commands:**
   ```bash
   npx @ahmednawaz619/crank setup
   npx @ahmednawaz619/crank
   ```
2. **Team token:** the `CRANK_TEAM_TOKEN` phrase (and add it to Replit Secrets if using Replit)

They do **not** need Glean keys or GitHub access.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `404` on npx | Run Step 1 (`npm run publish:team`) |
| `TEAM_TOKEN_REQUIRED` | Set `CRANK_TEAM_TOKEN` in Replit Secrets / shell, or tell agent the phrase |
| Team lock OFF in banner | Start crank with `CRANK_TEAM_TOKEN` in environment |
| Glean stub only | Run `publish:team` with Glean key in your `.env` |
| Agent MCP fails | Register MCP URL from `doctor` |

---

## Summary

```
YOU:  pick CRANK_TEAM_TOKEN → add to .env → npm login → npm run publish:team
YOU:  share token with team (Slack)
TEAM: Replit Secrets CRANK_TEAM_TOKEN + npx @ahmednawaz619/crank setup && npx @ahmednawaz619/crank
AGENT: ask user for team token → crank_verify_team_token → other tools
```
