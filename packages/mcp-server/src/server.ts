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

const args = process.argv.slice(2);
const config = {
  rovnUrl: getArg(args, '--url') ?? process.env.ROVN_URL ?? 'https://rovn.io',
  ownerEmail: getArg(args, '--email') ?? process.env.ROVN_OWNER_EMAIL ?? '',
  apiKey: getArg(args, '--api-key') ?? process.env.ROVN_API_KEY ?? '',
  agentId: getArg(args, '--agent-id') ?? process.env.ROVN_AGENT_ID ?? '',
};

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function requireAgent(): string | null {
  if (!config.agentId || !config.apiKey) {
    return 'Not registered. Call rovn_register first.';
  }
  return null;
}

// ─── MCP Tools Definition ───────────────────────────────────

const TOOLS = [
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

async function handleRequest(request: { id: number; method: string; params?: Record<string, unknown> }) {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'rovn-governance', version: '1.0.0' },
      };

    case 'tools/list':
      return { tools: TOOLS };

    case 'tools/call':
      return handleToolCall(request.params as { name: string; arguments: Record<string, unknown> });

    case 'notifications/initialized':
      return {};

    default:
      return { error: { code: -32601, message: `Unknown method: ${request.method}` } };
  }
}

async function handleToolCall(params: { name: string; arguments: Record<string, unknown> }) {
  const { name, arguments: toolArgs } = params;

  try {
    switch (name) {
      case 'rovn_register': {
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
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnPost(`/api/agents/${config.agentId}/activities`, {
          type: toolArgs.type ?? 'action',
          title: toolArgs.title,
          description: toolArgs.description,
          metadata: toolArgs.metadata,
        }));
      }

      case 'rovn_check_action': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnPost(`/api/agents/${config.agentId}/check`, {
          action: toolArgs.action,
          context: toolArgs.context,
          urgency: toolArgs.urgency,
          cost: toolArgs.cost,
        }));
      }

      case 'rovn_request_approval': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnPost(`/api/agents/${config.agentId}/approvals`, {
          type: toolArgs.type ?? 'action',
          title: toolArgs.title,
          description: toolArgs.description,
          urgency: toolArgs.urgency ?? 'medium',
        }));
      }

      case 'rovn_get_tasks': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        const query = toolArgs.status ? `?status=${toolArgs.status}` : '';
        return toolResult(await rovnGet(`/api/agents/${config.agentId}/tasks${query}`));
      }

      case 'rovn_update_task': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnPatch(`/api/tasks/${toolArgs.task_id}`, {
          status: toolArgs.status,
        }));
      }

      case 'rovn_get_report_card': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        const days = toolArgs.days ? `?days=${toolArgs.days}` : '';
        return toolResult(await rovnGet(`/api/agents/${config.agentId}/report-card${days}`));
      }

      case 'rovn_get_trust_score': {
        const err = requireAgent();
        if (err) return toolResult({ success: false, error: err });

        return toolResult(await rovnGet(`/api/agents/${config.agentId}/trust-score`));
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
  }
}

function toolResult(res: Record<string, unknown>) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(res, null, 2),
    }],
    isError: !res.success,
  };
}

// ─── HTTP Client ────────────────────────────────────────────

async function rovnPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.rovnUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function rovnGet(path: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.rovnUrl}${path}`, { headers });
  return res.json() as Promise<Record<string, unknown>>;
}

async function rovnPatch(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  const res = await fetch(`${config.rovnUrl}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// ─── STDIO Transport ────────────────────────────────────────

const rl = createInterface({ input: process.stdin });
let buffer = '';

rl.on('line', async (line: string) => {
  buffer += line;
  try {
    const request = JSON.parse(buffer);
    buffer = '';

    const result = await handleRequest(request);

    const response = {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };

    process.stdout.write(JSON.stringify(response) + '\n');
  } catch {
    // Incomplete JSON, keep buffering
  }
});

process.stderr.write('Rovn MCP Server started\n');
