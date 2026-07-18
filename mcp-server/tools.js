/**
 * MCP tool handlers — talk to the Vizcopy companion HTTP API.
 * Used by Cursor / Claude Desktop (stdio) and Replit Agent (remote HTTP MCP).
 */

const COMPANION_URL = (
  process.env.VIZCOPY_COMPANION_URL || 'http://127.0.0.1:3344'
).replace(/\/$/, '');

async function companionFetch(pathname, options = {}) {
  const res = await fetch(`${COMPANION_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Companion ${res.status} on ${pathname}`);
  }
  return data;
}

export const toolDefinitions = [
  {
    name: 'get_selected_copy',
    description:
      'Return the currently selected page region and its text nodes from the Vizcopy companion (set by the browser bookmarklet/panel).',
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
      'Apply a chosen Glean copy variant back into the product panel. Updates companion state and pushes live DOM text updates to connected browsers.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        variantId: {
          type: 'string',
          description: 'Variant id from propose_copy_variants'
        }
      },
      required: ['variantId']
    }
  },
  {
    name: 'apply_custom_copy',
    description:
      'Apply agent-edited text nodes (not necessarily a raw Glean variant) to the selected region.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              text: { type: 'string' }
            },
            required: ['path', 'text']
          }
        },
        variantId: {
          type: 'string',
          description: 'Optional label for this custom apply'
        }
      },
      required: ['nodes']
    }
  }
];

export async function callTool(name, args = {}) {
  switch (name) {
    case 'get_selected_copy': {
      const qs = args.sessionId
        ? `?sessionId=${encodeURIComponent(args.sessionId)}`
        : '';
      const data = await companionFetch(`/api/selection${qs}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data.session, null, 2)
          }
        ]
      };
    }
    case 'propose_copy_variants': {
      const data = await companionFetch('/api/variants', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          options: { variantCount: args.variantCount || 4 }
        })
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                sessionId: data.session.id,
                variants: data.variants
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'apply_copy_variant': {
      const data = await companionFetch('/api/apply', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          variantId: args.variantId
        })
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                applied: true,
                sessionId: data.session.id,
                variantId: data.variant.id,
                label: data.variant.label,
                nodes: data.variant.nodes
              },
              null,
              2
            )
          }
        ]
      };
    }
    case 'apply_custom_copy': {
      const data = await companionFetch('/api/apply-nodes', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: args.sessionId,
          nodes: args.nodes,
          variantId: args.variantId || 'custom'
        })
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { applied: true, session: data.session },
              null,
              2
            )
          }
        ]
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
