# Crank — setup checklist

Everything below that says **you** must be done on your machine or in Replit. Everything else is already done in the repo.

---

## Already done (in the repo)

- GitHub: https://github.com/ahmednawaz619/crank (public)
- Package name: `@ahmednawaz619/crank`
- Auto-detect project root (no paths in Replit / Cursor)
- Replit: HTTP MCP + companion + dev in one command
- Shared Glean key bundling for npm (`team.env` at publish time)
- Agent skill + `crank_get_environment` MCP tool

---

## YOU — Step 1: Publish to npm (once, ~2 min)

On your Mac, in Terminal:

```bash
npm login
```

Use your npmjs.com account (create one free at https://www.npmjs.com/signup if needed).

Then:

```bash
cd /Users/ahmed.nawaz/Downloads/vizcopy
npm run publish:team
```

You should see `@ahmednawaz619/crank@0.1.0` published.

**This is required** before anyone (including Replit) can run `npx @ahmednawaz619/crank`.

---

## YOU — Step 2: Test on your laptop (optional, ~3 min)

In any app repo:

```bash
cd /path/to/your-app
npx @ahmednawaz619/crank setup
npx @ahmednawaz619/crank
```

Open the app in the browser → select copy → **Get options**.

Reload MCP in Cursor after the first `setup`.

---

## YOU — Step 3: Test in Replit (~5 min)

### 3a. Open your app Repl

Use a Repl that already has your GitHub project (the app you want to edit copy in).

### 3b. Shell — run once

```bash
npx @ahmednawaz619/crank setup
```

### 3c. Shell or Run — keep this running

```bash
npx @ahmednawaz619/crank
```

Leave it running. It starts companion + HTTP MCP + your dev server.

### 3d. Register Replit Agent MCP (once per Repl)

In another Shell tab (while crank is running):

```bash
npx @ahmednawaz619/crank doctor
```

Find **`runtime.mcp.endpoint`** — something like:

`https://3345-YOUR-REPL-NAME.YOUR-USER.repl.co/mcp`

Then in Replit:

1. **Agent** (left sidebar) → **Integrations** → **MCP Servers**
2. **Add custom MCP server**
3. URL = that `/mcp` endpoint
4. Save

### 3e. Test the panel

1. Open **Webview** (your app preview).
2. Crank panel should load (Vite apps) or open the companion URL from `doctor` and use the bookmarklet.
3. Select a `div` → **Get options** → pick a variant → **Apply** or **Agent**.

### 3f. Test Replit Agent

In Agent chat, paste:

```text
Apply the pending Crank change
```

(After you clicked **Agent** on a variant in the panel.)

Or ask:

```text
Call crank_get_environment and tell me the project root and MCP URL.
```

---

## What teammates run (after you publish)

Same as Replit — no paths, no keys, no clone:

```bash
npx @ahmednawaz619/crank setup   # once per repo
npx @ahmednawaz619/crank         # when working
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `404` on `npx @ahmednawaz619/crank` | You haven’t run Step 1 (`npm run publish:team`) |
| Glean returns stub / no real options | Publish with `publish:team` (bundles your `.env` key) |
| Replit Agent can’t use tools | Add MCP URL from `doctor` in Integrations |
| Panel doesn’t appear | Keep `npx crank` running; check Webview is on dev server URL |
| Wrong project root | Agent runs `crank_get_environment`; should match Repl cwd |

---

## Order of operations (summary)

```
YOU:  npm login → npm run publish:team
YOU:  Replit → setup → crank → doctor → add MCP URL → test panel → test agent
TEAM: npx @ahmednawaz619/crank setup && npx @ahmednawaz619/crank
```
