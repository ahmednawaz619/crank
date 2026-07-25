/**
 * MCP tool handlers — talk to the Crank companion HTTP API.
 * Used by Cursor / Claude Desktop (stdio) and Replit Agent (remote HTTP MCP).
 */

const COMPANION_URL = (process.env.CRANK_COMPANION_URL || 'http://127.0.0.1:3344').replace(
  /\/$/,
  ''
);

const TEAM_TOKEN = process.env.CRANK_TEAM_TOKEN || '';

const teamTokenSchema = {
  teamToken: {
    type: 'string',
    description:
      'Shared Crank team passphrase. Ask the user if tools return TEAM_TOKEN_REQUIRED. Optional when CRANK_TEAM_TOKEN is set in MCP env.'
  }
};

/** Glean Robot Content Designer often takes 90–140s; allow up to 5 min. */
const GLEAN_VARIANTS_TIMEOUT_MS = Number(process.env.CRANK_VARIANTS_TIMEOUT_MS || 300000);

async function companionFetch(pathname, options = {}) {
  const { timeoutMs, teamToken, ...fetchOpts } = options;
  const token = teamToken || TEAM_TOKEN || '';
  const controller =
    timeoutMs > 0 && typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
  }
  let res;
  try {
    res = await fetch(`${COMPANION_URL}${pathname}`, {
      ...fetchOpts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Crank-Team-Token': token } : {}),
        ...(fetchOpts.headers || {})
      },
      signal: controller ? controller.signal : fetchOpts.signal
    });
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new Error(`Companion request timed out after ${timeoutMs}ms on ${pathname}`);
    }
    throw err;
  }
  if (timer) clearTimeout(timer);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    if (res.status === 401 && data.code === 'TEAM_TOKEN_REQUIRED') {
      throw new Error(
        'TEAM_TOKEN_REQUIRED: Ask the user for the Crank team token, then retry with teamToken on this tool (or set CRANK_TEAM_TOKEN in MCP env).'
      );
    }
    throw new Error(data.error || `Companion ${res.status} on ${pathname}`);
  }
  return data;
}

export const toolDefinitions = [
  {
    name: 'get_selected_copy',
    description:
      'Return the currently selected page region and its text nodes from the Crank companion (set by the browser bookmarklet/panel).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional session id; defaults to the active selection'
        }
      }
    }
  },
  {
    name: 'propose_copy_variants',
    description:
      'Send the selected copy payload to the Glean agent (skills/rules aware) and return 3–4 copy iteration options for all text nodes in the selection.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional session id; defaults to active selection'
        },
        variantCount: {
          type: 'number',
          description: 'Preferred number of variants (default 4)'
        }
      }
    }
  },
  {
    name: 'apply_copy_variant',
    description:
      'Apply a chosen Glean copy variant: update live DOM in connected browsers AND persist editable hardcoded strings to source via Vizpatch text-writer. Set persist=false for DOM-only preview.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        variantId: {
          type: 'string',
          description: 'Variant id from propose_copy_variants'
        },
        persist: {
          type: 'boolean',
          description:
            'When true (default), also write hardcoded literals to source. false = DOM preview only.'
        }
      },
      required: ['variantId']
    }
  },
  {
    name: 'apply_custom_copy',
    description:
      'Apply agent-edited node text updates to the live DOM (and optionally label them). Prefer apply_copy_variant for full variant apply + persist.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        nodes: {
          type: 'array',
          description: 'Array of { path, text, ... } node updates'
        },
        variantId: {
          type: 'string',
          description: 'Optional label for this custom apply'
        }
      },
      required: ['nodes']
    }
  },
  {
    name: 'crank_get_pending_changes',
    description:
      'Retune-parity: return structured pending copy changes queued by the panel Agent button (per-field old→new, selectors, paths). Use when applying Crank source edits.',
    inputSchema: {
      type: 'object',
      properties: {
        enriched: {
          type: 'boolean',
          description: 'Include full prompt + session/variant payloads'
        }
      }
    }
  },
  {
    name: 'crank_get_formatted_changes',
    description:
      'Retune-parity: return agent-ready markdown for pending Crank copy changes. By default clears pending after read (pass clear:false to keep). Prefer this in the crank-apply-changes skill workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        fidelity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description: 'Amount of detail in the markdown (default standard)'
        },
        clear: {
          type: 'boolean',
          description:
            'Clear pending after returning markdown (default true, like Retune)'
        }
      }
    }
  },
  {
    name: 'crank_watch_changes',
    description:
      'Long-poll the companion until pending Crank copy changes appear or update (up to ~30s). Useful when waiting for the user to click Agent.',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: {
          type: 'number',
          description: 'Max wait in ms (default 30000, max 120000)'
        },
        sinceId: {
          type: 'string',
          description: 'Return when pending id differs from this value'
        }
      }
    }
  },
  {
    name: 'crank_clear_changes',
    description:
      'Clear pending Crank copy changes after they have been applied to source (Retune-parity). Always call this when done.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional pending task id to clear'
        }
      }
    }
  },
  {
    name: 'crank_verify_team_token',
    description:
      'Verify the shared Crank team passphrase after the user provides it. Call when crank_get_environment reports teamAuthRequired or other tools return TEAM_TOKEN_REQUIRED.',
    inputSchema: {
      type: 'object',
      properties: {
        teamToken: {
          type: 'string',
          description: 'Team passphrase from the user'
        }
      },
      required: ['teamToken']
    }
  },
  {
    name: 'crank_get_environment',
    description:
      'Retune-style: return which repo/app directory Crank is bound to, virtual vs local environment (Replit, Codespaces), companion URLs, MCP endpoint, auth requirements, and suggested commands. Call first when unsure where code lives or how to start Crank.',
    inputSchema: {
      type: 'object',
      properties: {
        ...teamTokenSchema
      }
    }
  },
  {
    name: 'crank_status',
    description:
      'Return whether Crank has pending copy changes queued, watcher count, and whether CURSOR_API_KEY is configured for optional headless auto-run.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_pending_agent_prompt',
    description:
      'Legacy alias: read the pending Crank agent task (full executable prompt + structured changes). Prefer crank_get_formatted_changes for skill workflows.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'ack_pending_agent_prompt',
    description:
      'Legacy alias for crank_clear_changes — acknowledge and clear the pending task after applying.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Optional pending task id from get_pending_agent_prompt'
        }
      }
    }
  },
  {
    name: 'queue_agent_prompt',
    description:
      'Queue a Crank variant as pending copy changes (same as the panel Agent button). Does not save files.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        variantId: {
          type: 'string',
          description: 'Variant id to hand off to the Cursor agent'
        }
      },
      required: ['variantId']
    }
  }
];

function formatJson(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  };
}

export async function callTool(name, args = {}) {
  const teamToken = args.teamToken || TEAM_TOKEN || '';
  const withToken = (opts = {}) => ({ ...opts, teamToken: opts.teamToken || teamToken });
  switch (name) {
    case 'crank_verify_team_token': {
      const data = await companionFetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token: args.teamToken }),
        teamToken: args.teamToken
      });
      return formatJson({
        ...data,
        note: 'Token accepted — pass the same teamToken on other Crank MCP tools in this session.'
      });
    }
    case 'crank_get_environment': {
      const data = await companionFetch('/api/environment', withToken());
      return formatJson(data);
    }
    case 'get_selected_copy': {
      const qs = args.sessionId
        ? `?sessionId=${encodeURIComponent(args.sessionId)}`
        : '';
      const data = await companionFetch(`/api/selection${qs}`, withToken());
      return formatJson(data.session);
    }
    case 'propose_copy_variants': {
      const data = await companionFetch('/api/variants', withToken({
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          options: { variantCount: args.variantCount || 4 }
        }),
        timeoutMs: GLEAN_VARIANTS_TIMEOUT_MS
      }));
      return formatJson({
        sessionId: data.session.id,
        variants: data.variants
      });
    }
    case 'apply_copy_variant': {
      const persist = args.persist !== false;
      const data = await companionFetch('/api/apply', withToken({
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          variantId: args.variantId,
          persist
        })
      }));
      return formatJson({
        applied: true,
        persisted: !!(data.persistResult && data.persistResult.persisted),
        sessionId: data.session.id,
        variantId: data.variant.id,
        label: data.variant.label,
        nodes: data.variant.nodes,
        persistResult: data.persistResult || null,
        note: persist
          ? 'DOM updated; source save attempted for editable hardcoded literals (see persistResult).'
          : 'DOM preview only — source not written.'
      });
    }
    case 'apply_custom_copy': {
      const data = await companionFetch('/api/apply-nodes', withToken({
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          nodes: args.nodes,
          variantId: args.variantId || 'custom'
        })
      }));
      return formatJson({
        applied: true,
        session: data.session,
        note: 'DOM updated only. Edit source files or use apply_copy_variant with persist for hardcoded saves.'
      });
    }
    case 'crank_get_pending_changes': {
      const qs =
        args.enriched === true || args.enriched === 'true'
          ? '?enriched=true'
          : '';
      const data = await companionFetch(`/api/pending-changes${qs}`, withToken());
      return formatJson(data.pending);
    }
    case 'crank_get_formatted_changes': {
      const params = new URLSearchParams();
      if (args.fidelity) params.set('fidelity', String(args.fidelity));
      if (args.clear === false || args.clear === 'false') {
        params.set('clear', 'false');
      }
      const qs = params.toString() ? `?${params}` : '';
      const data = await companionFetch(`/api/pending-changes/formatted${qs}`, withToken());
      return {
        content: [
          {
            type: 'text',
            text: [
              data.markdown,
              '',
              data.cleared
                ? '(Pending cleared after read — call tools again only if the user re-queues.)'
                : '(Pending kept — call crank_clear_changes after applying.)'
            ].join('\n')
          }
        ]
      };
    }
    case 'crank_watch_changes': {
      const params = new URLSearchParams();
      if (args.timeoutMs) params.set('timeoutMs', String(args.timeoutMs));
      if (args.sinceId) params.set('sinceId', String(args.sinceId));
      const qs = params.toString() ? `?${params}` : '';
      const watchTimeout = Math.min(
        Math.max(Number(args.timeoutMs) || 30000, 1000) + 5000,
        130000
      );
      const data = await companionFetch(`/api/pending-changes/watch${qs}`, withToken({
        timeoutMs: watchTimeout
      }));
      return formatJson(data);
    }
    case 'crank_clear_changes':
    case 'ack_pending_agent_prompt': {
      if (args.id) {
        const data = await companionFetch('/api/agent-prompt/ack', withToken({
          method: 'POST',
          body: JSON.stringify({ id: args.id })
        }));
        return formatJson({ cleared: true, task: data.task });
      }
      const data = await companionFetch('/api/pending-changes', withToken({
        method: 'DELETE'
      }));
      return formatJson({ cleared: true, task: data.task });
    }
    case 'crank_status': {
      const data = await companionFetch('/api/agent-status', withToken());
      return formatJson(data);
    }
    case 'get_pending_agent_prompt': {
      const data = await companionFetch('/api/agent-prompt', withToken());
      const task = data.task;
      return {
        content: [
          {
            type: 'text',
            text: [
              'Pending Crank agent task — execute the prompt below, then call crank_clear_changes / ack_pending_agent_prompt.',
              '',
              `Task id: ${task.id}`,
              `Variant: ${task.variantLabel || task.variantId}`,
              `Page: ${task.pageUrl || '(unknown)'}`,
              '',
              '--- PROMPT ---',
              task.prompt,
              '--- END PROMPT ---',
              '',
              'Structured changes:',
              JSON.stringify(task.changes || [], null, 2)
            ].join('\n')
          }
        ]
      };
    }
    case 'queue_agent_prompt': {
      const data = await companionFetch('/api/agent-prompt', withToken({
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          variantId: args.variantId,
          source: 'mcp'
        })
      }));
      return formatJson({
        queued: true,
        taskId: data.task?.id,
        howto: data.howto,
        changeCount: data.task?.changeCount,
        promptPreview: String(data.task?.prompt || '').slice(0, 500)
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
