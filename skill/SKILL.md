---
name: crank-apply-changes
description: Apply copy changes from Crank MCP tools (crank_get_formatted_changes, crank_get_pending_changes, get_pending_agent_prompt) OR when the user pastes structured "# Copy Changes" output / old→new Heading/Body/CTA tables. Triggers on: crank, "Apply the pending Crank change", "Start Crank", "npx crank", team token, Copy Changes, pending Crank, apply copy variant, Agent button handoff.
---

# Applying Crank Copy Changes

Crank queues structured copy updates from the browser panel **Agent** button. Your job is to translate each old→new mapping into precise source edits (hardcoded JSX/HTML string literals).

**Same-chat workflow:** The panel does not inject into Composer (Cursor has no public API for that). It queues pending changes and the user pastes `Apply the pending Crank change` into the **current** chat — or you are already active with this skill. You must **pull** with MCP tools.

## Team token (when enabled)

If `crank_get_environment` or any tool returns **`TEAM_TOKEN_REQUIRED`**:

1. Ask the user: *“What is the Crank team token?”* (shared internal passphrase — not their Glean or npm login).
2. Call **`crank_verify_team_token`** with `{ "teamToken": "…" }`.
3. Pass the same **`teamToken`** on subsequent Crank MCP tool calls in this session.

Alternatively the user can set `CRANK_TEAM_TOKEN` in Replit Secrets or shell before starting Crank.

## When the user says "start Crank" or pastes `npx crank`

1. Call **`crank_get_environment`** first — repo path, Replit vs local, companion URL, auth requirements.
2. If team auth is required and tools fail, ask for the team token (see above).
3. Run in the terminal from project root:
   ```bash
   npx @ahmednawaz/crank setup   # once
   npx @ahmednawaz/crank
   ```

## Apply workflow

1. Call **`crank_get_formatted_changes`** (preferred) or **`crank_get_pending_changes`** / **`get_pending_agent_prompt`**.
   - Pass **`teamToken`** if required.
   - If nothing is pending, tell the user to click **Agent** on a Crank variant first — or use **`crank_watch_changes`** once if they are about to queue.
2. For each change row, locate the source file under the **project root** from `crank_get_environment` and edit the hardcoded string literal (JSX/HTML/template).
3. Preserve structure — only change copy text, not layout or component hierarchy.
4. Always call **`crank_clear_changes`** (or **`ack_pending_agent_prompt`**) after applying (or deciding it cannot be applied).

## Rules

- Match selectors/paths when provided; fall back to grep for the old string under the detected project root.
- Do not invent copy — use the queued new values exactly.
- If `crank_status` reports no pending changes, stop — do not invent copy.
- Never ask for Glean API keys — those are bundled server-side. Only ask for the **Crank team token** when auth is enabled.

## MCP tools

| Tool | Purpose |
|------|---------|
| `crank_verify_team_token` | Validate passphrase after user provides it |
| `crank_get_environment` | Repo path, auth, Replit vs local, URLs |
| `crank_get_formatted_changes` | Agent-ready markdown |
| `crank_get_pending_changes` | Structured JSON diffs |
| `crank_watch_changes` | Long-poll until pending appears |
| `crank_clear_changes` | Clear after apply |
| `crank_status` | Pending queue status |

Pass optional **`teamToken`** on any tool when `teamAuthRequired` is true.
