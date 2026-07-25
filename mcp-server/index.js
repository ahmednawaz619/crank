#!/usr/bin/env node
/**
 * Crank MCP server
 *
 * Modes:
 *   CRANK_MCP_MODE=stdio (default) — Cursor / Claude Desktop local MCP
 *   CRANK_MCP_MODE=http  — remote MCP for Replit Agent (HTTPS endpoint required in prod)
 *
 * Sources:
 *   Replit custom MCP: https://docs.replit.com/build/connect-via-mcp
 *   Replit MCP list / auth headers: https://docs.replit.com/references/mcp/overview
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { toolDefinitions, callTool } from './tools.js';

const MODE = (
  process.env.CRANK_MCP_MODE ||
  process.env.VIZCOPY_MCP_MODE ||
  'stdio'
).toLowerCase();
const HTTP_PORT = Number(
  process.env.CRANK_MCP_HTTP_PORT || process.env.VIZCOPY_MCP_HTTP_PORT || 3345
);
const API_KEY =
  process.env.CRANK_MCP_API_KEY || process.env.VIZCOPY_MCP_API_KEY || '';

function createMcpServer() {
  const server = new Server(
    { name: 'crank', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    try {
      return await callTool(name, args);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: String(err.message || err) }]
      };
    }
  });

  return server;
}

async function startStdio() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Crank MCP] stdio transport ready');
}

/**
 * Minimal Streamable HTTP / JSON-RPC style endpoint for remote agents.
 * Replit expects an HTTPS MCP endpoint — tunnel or deploy this service.
 * Auth: optional X-API-Key / Authorization bearer via CRANK_MCP_API_KEY.
 */
async function startHttp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  function authorize(req, res, next) {
    if (!API_KEY) {
      next();
      return;
    }
    const headerKey =
      req.get('x-api-key') ||
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (headerKey !== API_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'crank-mcp', mode: 'http' });
  });

  // Simple JSON tool surface (also useful for demos / curl).
  // Full MCP streamable HTTP can replace this once the Motives hosting shape is fixed.
  app.get('/mcp/tools', authorize, (_req, res) => {
    res.json({ tools: toolDefinitions });
  });

  app.post('/mcp/call', authorize, async (req, res) => {
    try {
      const name = req.body?.name;
      const args = req.body?.arguments || {};
      const result = await callTool(name, args);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // MCP-ish initialize / tools/list / tools/call over JSON-RPC for remote agents
  app.post('/mcp', authorize, async (req, res) => {
    const body = req.body || {};
    const method = body.method;
    const id = body.id ?? null;

    try {
      if (method === 'initialize') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'crank', version: '0.1.0' }
          }
        });
        return;
      }
      if (method === 'tools/list') {
        res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: toolDefinitions }
        });
        return;
      }
      if (method === 'tools/call') {
        const name = body.params?.name;
        const args = body.params?.arguments || {};
        const result = await callTool(name, args);
        res.json({ jsonrpc: '2.0', id, result });
        return;
      }
      if (method === 'notifications/initialized' || method === 'ping') {
        res.json({ jsonrpc: '2.0', id, result: {} });
        return;
      }
      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` }
      });
    } catch (err) {
      res.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: String(err.message || err) }
      });
    }
  });

  // Also wire stdio SDK server for local debugging in parallel? No — HTTP only here.
  const listenHost =
    process.env.CRANK_HOST === '0.0.0.0' || process.env.REPL_ID ? '0.0.0.0' : '127.0.0.1';
  app.listen(HTTP_PORT, listenHost, () => {
    console.error(
      `[Crank MCP] HTTP listening on http://${listenHost}:${HTTP_PORT}/mcp`
    );
    console.error(
      '[Crank MCP] For Replit: expose this URL over HTTPS and add as custom MCP server'
    );
  });
}

if (MODE === 'http') {
  await startHttp();
} else {
  await startStdio();
}
