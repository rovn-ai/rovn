#!/usr/bin/env node
/**
 * Rovn MCP Server
 *
 * Exposes Rovn governance tools via the Model Context Protocol (MCP).
 * Any MCP-compatible agent (Claude, Cursor, GPT, etc.) can use these tools
 * to register, report activities, check policies, and request approvals.
 *
 * Usage:
 *   npx @rovn/mcp-server --url https://rovn.io --email owner@example.com
 *
 * Or with an existing API key:
 *   npx @rovn/mcp-server --url https://rovn.io --api-key rovn_...
 *
 * Claude Desktop / Claude Code config:
 *   {
 *     "mcpServers": {
 *       "rovn": {
 *         "command": "npx",
 *         "args": ["@rovn/mcp-server", "--url", "https://rovn.io", "--email", "me@example.com"]
 *       }
 *     }
 *   }
 */

import { createInterface } from 'readline';

// ─── Config ─────────────────────────────────────────────────

export interface ServerConfig {
  rovnUrl: string;
  ownerEmail: string;
  apiKey: string;
  agentId: string;
}

export function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function createConfig(args: string[]): ServerConfig {
  return {
    rovnUrl: getArg(args, '--url') ?? process.env.ROVN_URL ?? 'https://rovn.io',
    ownerEmail: getArg(args, '--email') ?? process.env.ROVN_OWNER_EMAIL ?? '',
    apiKey: getArg(args, '--api-key') ?? process.env.ROVN_API_KEY ?? '',
    agentId: getArg(args, '--agent-id') ?? process.env.ROVN_AGENT_ID ?? '',
  };
}

export const config = createConfig(process.argv.slice(2));

/** Reset config for testing. */
export function resetConfig(overrides: Partial<ServerConfig> = {}): void {
  config.rovnUrl = overrides.rovnUrl ?? 'https://rovn.io';
  config.ownerEmail = overrides.ownerEmail ?? '';
  config.apiKey = overrides.apiKey ?? '';
  config.agentId = overrides.agentId ?? '';
}

export function requireAgent(cfg: ServerConfig): string | null {
  if (!cfg.agentId || !cfg.apiKey) {
    return 'Not registered. Call rovn_register first.';
  }
  return null;
}

// ─── HTTP Client (hardened) ─────────────────────────────────

const HTTP_TIMEOUT = 15000;

function httpStatusMessage(status: number): string {
  if (status === 401 || status === 403) return 'Authentication failed — check your API key or call rovn_register';
  if (status === 404) return 'Resource not found';
  if (status >= 500) return `Server error (${status}) — try again later`;
  return `Request failed (${status})`;
}

async function safeFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { success: false, error: 'Request timed out — check your network connection' };
    }
    return { success: false, error: 'Could not connect to server — verify the URL and network' };
  }

  if (!res.ok) {
    let serverMsg = '';
    try {
      const body = await res.json() as Record<string, unknown>;
      serverMsg = (body.error as string) ?? '';
    } catch { /* ignore */ }
    return { success: false, error: serverMsg || httpStatusMessage(res.status) };
  }

  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { success: false, error: 'Invalid response from server (non-JSON)' };
  }
}

export async function rovnPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  return safeFetch(`${config.rovnUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function rovnGet(path: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  return safeFetch(`${config.rovnUrl}${path}`, { headers });
}

export async function rovnPatch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  return safeFetch(`${config.rovnUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

// ─── Auto-Logging (fire-and-forget) ─────────────────────────

function autoLog(title: string, type: string = 'governance'): void {
  if (!config.agentId || !config.apiKey) return;
  // Fire-and-forget — don't await, don't block the tool response
  rovnPost(`/api/agents/${config.agentId}/activities`, {
    type,
    title,
    metadata: { source: 'mcp-auto' },
  }).catch(() => { /* ignore auto-log failures */ });
}

// ─── MCP Tools Definition ───────────────────────────────────

export const TOOLS = [
  {
    name: 'rovn_register',
    description: 'Register this agent with Rovn governance platform. Returns an API key and agent ID. Call this once at the start.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Agent name (e.g., "Claude Code Assistant")' },
        description: { type: 'string', description: 'What this agent does' },
        type: { type: 'string', description: 'Agent type (e.g., assistant, coder, researcher)' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of capabilities (e.g., ["code_generation", "file_editing"])',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'rovn_log_activity',
    description: 'Log an activity to Rovn. Use this to report what the agent has done.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Activity title (e.g., "Refactored auth module")' },
        type: { type: 'string', description: 'Activity type (e.g., code_generation, testing, deployment, review)' },
        description: { type: 'string', description: 'Detailed description of what was done' },
        metadata: { type: 'object', description: 'Additional structured data (e.g., { files_changed: 3 })' },
      },
      required: ['title'],
    },
  },
  {
    name: 'rovn_check_action',
    description: 'Pre-flight check: ask Rovn if an action is allowed before executing it. Returns allowed/denied/needs_approval.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', description: 'The action to check (e.g., send_email, delete_file, deploy)' },
        context: { type: 'string', description: 'Context about the action' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'How urgent is this action' },
        cost: { type: 'number', description: 'Estimated cost in USD (if applicable)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'rovn_request_approval',
    description: 'Request approval from the owner before performing a risky or important action. Owner will see this in their dashboard.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'What needs approval (e.g., "Deploy to production")' },
        type: { type: 'string', description: 'Category (e.g., deployment, payment, data_access, action)' },
        description: { type: 'string', description: 'Detailed description of what will happen' },
        urgency: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'How urgent' },
      },
      required: ['title'],
    },
  },
  {
    name: 'rovn_get_tasks',
    description: 'Get tasks assigned to this agent by the owner.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'Filter by status' },
      },
    },
  },
  {
    name: 'rovn_update_task',
    description: 'Update a task status (e.g., mark as in_progress or completed).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task ID to update' },
        status: { type: 'string', enum: ['in_progress', 'completed', 'cancelled', 'failed'], description: 'New status' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'rovn_get_report_card',
    description: 'Get this agent\'s performance report card — trust score, grades, and recommendations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Report period in days (default: 7)' },
      },
    },
  },
  {
    name: 'rovn_get_trust_score',
    description: 'Get this agent\'s Trust Score (0-100). Higher trust unlocks more autonomy.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ─── MCP Protocol Handler ───────────────────────────────────

export async function handleRequest(request: { id: number; method: string; params?: Record<string, unknown> }) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'rovn-governance', version: '0.1.0' },
      };

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return handleToolCall(request.params as { name: string; arguments: Record<string, unknown> });

    case 'notifications/initialized':
      return null; // Notifications don't need a response

    default:
      return { error: { code: -32601, message: `Unknown method: ${request.method}` } };
  }
}

export async function handleToolCall(params: { name: string; arguments: Record<string, unknown> }) {
  const { name, arguments: toolArgs } = params;

  try {
    switch (name) {
      case 'rovn_register': {
        // Reuse existing agent if already registered (api-key + agent-id set)
        if (config.apiKey && config.agentId) {
          // Validate existing credentials by fetching trust score
          const check = await rovnGet(`/api/agents/${config.agentId}/trust-score`);
          if (check.success) {
            const data = (check.data ?? check) as Record<string, unknown>;
            return toolResult({
              success: true,
              data: {
                id: config.agentId,
                name: data.agent_name ?? toolArgs.name,
                message: 'Already registered. Using existing agent credentials.',
              },
            });
          }
          // Pre-configured credentials (from CLI args) — keep using them even if validation fails
          // This prevents creating duplicate agents when the server is temporarily unavailable
          if (getArg(process.argv.slice(2), '--api-key') || process.env.ROVN_API_KEY) {
            return toolResult({
              success: true,
              data: {
                id: config.agentId,
                message: 'Using pre-configured credentials (server validation skipped).',
              },
            });
          }
          // Only clear credentials if they were from a previous dynamic registration
          config.apiKey = '';
          config.agentId = '';
        }

        const body: Record<string, unknown> = {
          name: toolArgs.name,
          description: toolArgs.description,
          type: toolArgs.type ?? 'mcp-agent',
          capabilities: toolArgs.capabilities,
          owner_email: config.ownerEmail || undefined,
          metadata: { platform: 'mcp', registered_at: new Date().toISOString() },
        };
        const res = await rovnPost('/api/agents/register', body);
        const data = res.data as Record<string, unknown> | undefined;
        if (res.success && data) {
          config.apiKey = data.api_key as string;
          config.agentId = data.id as string;
          autoLog(`Registered as ${data.name}`, 'registration');
          return toolResult({
            success: true,
            data: {
              id: data.id,
              name: data.name,
              claim_url: data.claim_url,
              message: 'Agent registered! Share the claim_url with the owner. API key saved for this session.',
            },
          });
        }
        return toolResult(res);
      }

      case 'rovn_log_activity': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnPost(`/api/agents/${config.agentId}/activities`, {
          type: toolArgs.type ?? 'action',
          title: toolArgs.title,
          description: toolArgs.description,
          metadata: toolArgs.metadata,
        }));
      }

      case 'rovn_check_action': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        // Use GET with query params (matches the API endpoint)
        const params = new URLSearchParams();
        params.set('action', toolArgs.action as string);
        if (toolArgs.urgency) params.set('urgency', toolArgs.urgency as string);
        if (toolArgs.cost !== undefined) params.set('cost', String(toolArgs.cost));
        if (toolArgs.context) params.set('context', toolArgs.context as string);

        const checkRes = await rovnGet(`/api/agents/${config.agentId}/check?${params}`);
        const decision = ((checkRes.data as Record<string, unknown>)?.decision ?? '') as string;
        autoLog(`Checked: ${toolArgs.action} → ${decision}`, 'governance');
        return toolResult(checkRes);
      }

      case 'rovn_request_approval': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        const approvalRes = await rovnPost(`/api/agents/${config.agentId}/approvals`, {
          type: toolArgs.type ?? 'action',
          title: toolArgs.title,
          description: toolArgs.description,
          urgency: toolArgs.urgency ?? 'medium',
        });
        if (approvalRes.success) autoLog(`Requested approval: ${toolArgs.title}`, 'governance');
        return toolResult(approvalRes);
      }

      case 'rovn_get_tasks': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        const query = toolArgs.status ? `?status=${toolArgs.status}` : '';
        return toolResult(await rovnGet(`/api/agents/${config.agentId}/tasks${query}`));
      }

      case 'rovn_update_task': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        const taskRes = await rovnPatch(`/api/tasks/${toolArgs.task_id}`, {
          status: toolArgs.status,
        });
        if (taskRes.success) autoLog(`Task ${toolArgs.task_id}: → ${toolArgs.status}`, 'task_management');
        return toolResult(taskRes);
      }

      case 'rovn_get_report_card': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        const days = toolArgs.days ? `?days=${toolArgs.days}` : '';
        return toolResult(await rovnGet(`/api/agents/${config.agentId}/report-card${days}`));
      }

      case 'rovn_get_trust_score': {
        const err = requireAgent(config);
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnGet(`/api/agents/${config.agentId}/trust-score`));
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

export function toolResult(res: Record<string, unknown>) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(res, null, 2),
    }],
    isError: !res.success,
  };
}

// ─── STDIO Transport ────────────────────────────────────────

// Only start STDIO transport when run directly (not imported for testing)
const isDirectRun = require.main === module;

if (isDirectRun) {
  const rl = createInterface({ input: process.stdin });
  let buffer = '';

  rl.on('line', async (line: string) => {
    buffer += line;
    let request: { id: number; method: string; params?: Record<string, unknown> };
    try {
      request = JSON.parse(buffer);
      buffer = '';
    } catch {
      // Incomplete JSON — keep buffering
      return;
    }

    try {
      const result = await handleRequest(request);

      // Notifications (null result) don't get a response
      if (result === null) return;

      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result,
      }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: `Internal error: ${error instanceof Error ? error.message : String(error)}` },
      }) + '\n');
    }
  });

  process.stderr.write('Rovn MCP Server started\n');
}
