import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getArg, createConfig, requireAgent, handleRequest, handleToolCall, toolResult, TOOLS } from './server.js';
import type { ServerConfig } from './server.js';

// ─── getArg() ────────────────────────────────────────────────

describe('getArg', () => {
  it('returns value for existing flag', () => {
    assert.equal(getArg(['--url', 'https://rovn.io'], '--url'), 'https://rovn.io');
  });

  it('returns undefined for missing flag', () => {
    assert.equal(getArg(['--url', 'https://rovn.io'], '--email'), undefined);
  });

  it('returns undefined for empty args', () => {
    assert.equal(getArg([], '--url'), undefined);
  });

  it('returns value when flag is not first', () => {
    assert.equal(getArg(['--email', 'a@b.com', '--url', 'https://x.io'], '--url'), 'https://x.io');
  });

  it('returns undefined when flag is last (no value)', () => {
    assert.equal(getArg(['--url'], '--url'), undefined);
  });
});

// ─── createConfig() ──────────────────────────────────────────

describe('createConfig', () => {
  it('parses all CLI args', () => {
    const cfg = createConfig(['--url', 'https://test.io', '--email', 'a@b.com', '--api-key', 'key123', '--agent-id', 'agent1']);
    assert.equal(cfg.rovnUrl, 'https://test.io');
    assert.equal(cfg.ownerEmail, 'a@b.com');
    assert.equal(cfg.apiKey, 'key123');
    assert.equal(cfg.agentId, 'agent1');
  });

  it('uses defaults for missing args', () => {
    const cfg = createConfig([]);
    assert.equal(cfg.rovnUrl, 'https://rovn.io');
    assert.equal(cfg.ownerEmail, '');
    assert.equal(cfg.apiKey, '');
    assert.equal(cfg.agentId, '');
  });
});

// ─── requireAgent() ──────────────────────────────────────────

describe('requireAgent', () => {
  it('returns null when agent is configured', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: 'key', agentId: 'id' };
    assert.equal(requireAgent(cfg), null);
  });

  it('returns error when apiKey is missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: '', agentId: 'id' };
    assert.ok(requireAgent(cfg)?.includes('Not registered'));
  });

  it('returns error when agentId is missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: 'key', agentId: '' };
    assert.ok(requireAgent(cfg)?.includes('Not registered'));
  });

  it('returns error when both are missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: '', agentId: '' };
    assert.ok(requireAgent(cfg) !== null);
  });
});

// ─── toolResult() ────────────────────────────────────────────

describe('toolResult', () => {
  it('marks successful responses', () => {
    const result = toolResult({ success: true, data: { id: '123' } });
    assert.equal(result.isError, false);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.id, '123');
  });

  it('marks failed responses', () => {
    const result = toolResult({ success: false, error: 'Something went wrong' });
    assert.equal(result.isError, true);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.success, false);
    assert.equal(parsed.error, 'Something went wrong');
  });

  it('formats JSON with indentation', () => {
    const result = toolResult({ success: true });
    assert.ok(result.content[0].text.includes('\n'));
  });
});

// ─── TOOLS definition ────────────────────────────────────────

describe('TOOLS', () => {
  it('defines exactly 8 tools', () => {
    assert.equal(TOOLS.length, 8);
  });

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name, `Tool missing name`);
      assert.ok(tool.description, `${tool.name} missing description`);
      assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  it('tool names follow rovn_ prefix convention', () => {
    for (const tool of TOOLS) {
      assert.ok(tool.name.startsWith('rovn_'), `${tool.name} doesn't start with rovn_`);
    }
  });

  it('rovn_register requires name', () => {
    const reg = TOOLS.find(t => t.name === 'rovn_register')!;
    assert.deepEqual(reg.inputSchema.required, ['name']);
  });

  it('rovn_check_action requires action', () => {
    const check = TOOLS.find(t => t.name === 'rovn_check_action')!;
    assert.deepEqual(check.inputSchema.required, ['action']);
  });

  it('rovn_update_task requires task_id and status', () => {
    const update = TOOLS.find(t => t.name === 'rovn_update_task')!;
    assert.deepEqual(update.inputSchema.required, ['task_id', 'status']);
  });

  it('rovn_request_approval requires title', () => {
    const approve = TOOLS.find(t => t.name === 'rovn_request_approval')!;
    assert.deepEqual(approve.inputSchema.required, ['title']);
  });
});

// ─── handleRequest() — MCP Protocol ─────────────────────────

describe('handleRequest', () => {
  it('responds to initialize', async () => {
    const result = await handleRequest({ id: 1, method: 'initialize' }) as Record<string, unknown>;
    assert.equal(result.protocolVersion, '2024-11-05');
    assert.ok(result.capabilities);
    assert.ok(result.serverInfo);
    assert.equal((result.serverInfo as { name: string }).name, 'rovn-governance');
  });

  it('responds to tools/list', async () => {
    const result = await handleRequest({ id: 2, method: 'tools/list' }) as { tools: unknown[] };
    assert.ok(Array.isArray(result.tools));
    assert.equal(result.tools.length, 8);
  });

  it('returns null for notifications/initialized', async () => {
    const result = await handleRequest({ id: 3, method: 'notifications/initialized' });
    assert.equal(result, null);
  });

  it('returns error for unknown method', async () => {
    const result = await handleRequest({ id: 4, method: 'unknown/method' }) as { error: { code: number; message: string } };
    assert.equal(result.error.code, -32601);
    assert.ok(result.error.message.includes('Unknown method'));
  });
});

// ─── handleToolCall() — Tool Dispatch ────────────────────────

describe('handleToolCall', () => {
  it('returns error for unregistered agent tools', async () => {
    // Tools that require agent should fail without credentials
    const tools = ['rovn_log_activity', 'rovn_check_action', 'rovn_request_approval',
                   'rovn_get_tasks', 'rovn_update_task', 'rovn_get_report_card', 'rovn_get_trust_score'];

    for (const toolName of tools) {
      const result = await handleToolCall({
        name: toolName,
        arguments: { title: 'test', action: 'test', task_id: 'test', status: 'completed' },
      });
      assert.equal(result.isError, true, `${toolName} should fail without agent`);
      const text = result.content[0].text;
      assert.ok(text.includes('Not registered'), `${toolName} should mention registration`);
    }
  });

  it('returns error for unknown tool', async () => {
    const result = await handleToolCall({ name: 'rovn_nonexistent', arguments: {} });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Unknown tool'));
  });
});

// ─── Integration: JSON-RPC round-trip ────────────────────────

describe('JSON-RPC round-trip', () => {
  it('initialize → tools/list flow', async () => {
    const init = await handleRequest({ id: 1, method: 'initialize' });
    assert.ok(init);

    const list = await handleRequest({ id: 2, method: 'tools/list' }) as { tools: unknown[] };
    assert.equal(list.tools.length, 8);
  });

  it('tools/call with unregistered agent', async () => {
    const result = await handleRequest({
      id: 3,
      method: 'tools/call',
      params: { name: 'rovn_get_trust_score', arguments: {} },
    }) as { content: Array<{ text: string }>; isError: boolean };

    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Not registered'));
  });
});
