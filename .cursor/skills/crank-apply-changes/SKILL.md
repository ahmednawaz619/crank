---
name: crank-apply-changes
description: Apply copy changes from Crank MCP tools (crank_get_formatted_changes, crank_get_pending_changes, get_pending_agent_prompt) OR when the user pastes structured "# Copy Changes" output / old→new Heading/Body/CTA tables. Triggers on: crank, "Apply the pending Crank change", "Copy Changes", pending Crank, apply copy variant, Agent button handoff.
---

# Applying Crank Copy Changes

Crank queues structured copy updates from the browser panel **Agent** button. Your job is to translate each old→new mapping into precise source edits (hardcoded JSX/HTML string literals).

**Same-chat workflow:** The panel does not inject into Composer (Cursor has no public API for that). It queues pending changes and the user pastes `Apply the pending Crank change` into the **current** chat — or you are already active with this skill. You must **pull** with MCP tools.

## Workflow

1. Call **`crank_get_formatted_changes`** (preferred) or **`crank_get_pending_changes`** / **`get_pending_agent_prompt`**.
   - If nothing is pending, tell the user to click **Agent** on a Crank variant first — or use **`crank_watch_changes`** once if they are about to queue.
2. For each change row, locate the source file and edit the hardcoded string literal (JSX/HTML/template).
3. Preserve structure — only change copy text, not layout or component hierarchy.
4. Always call **`crank_clear_changes`** (or **`ack_pending_agent_prompt`**) after applying (or deciding it cannot be applied).

## Rules

- Match selectors/paths when provided; fall back to grep for the old string.
- Do not invent copy — use the queued new values exactly.
- If `crank_status` reports no pending changes, stop — do not invent copy.

## MCP tools

| Tool | Purpose |
|------|---------|
| `crank_get_formatted_changes` | Agent-ready markdown (may clear after read; pass `clear: false` to keep) |
| `crank_get_pending_changes` | Structured JSON diffs |
| `crank_watch_changes` | Long-poll until a pending queue appears |
| `crank_clear_changes` | Clear after apply |
| `crank_status` | Whether anything is queued |

Legacy `vizcopy_*` tool names are aliases for the same handlers (one release).
