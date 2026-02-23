import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getArg, createConfig, requireAgent, handleRequest, handleToolCall, toolResult, TOOLS, config, resetConfig } from './server.js';
import type { ServerConfig } from './server.js';

// ─── Fetch Mock Helper ──────────────────────────────────────

let fetchMock: ReturnType<typeof mock.fn> | null = null;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  fetchMock = mock.fn(handler);
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
}

function restoreFetch() {
  if (fetchMock) {
    fetchMock.mock.restore();
    fetchMock = null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: 'key', agentId: 'id', sessionId: '' };
    assert.equal(requireAgent(cfg), null);
  });

  it('returns error when apiKey is missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: '', agentId: 'id', sessionId: '' };
    assert.ok(requireAgent(cfg)?.includes('Not registered'));
  });

  it('returns error when agentId is missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: 'key', agentId: '', sessionId: '' };
    assert.ok(requireAgent(cfg)?.includes('Not registered'));
  });

  it('returns error when both are missing', () => {
    const cfg: ServerConfig = { rovnUrl: '', ownerEmail: '', apiKey: '', agentId: '', sessionId: '' };
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
  it('defines exactly 10 tools', () => {
    assert.equal(TOOLS.length, 10);
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
    assert.equal(result.tools.length, 10);
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
    resetConfig(); // Clear all credentials
    const tools = ['rovn_log_activity', 'rovn_check_action', 'rovn_request_approval',
                   'rovn_get_tasks', 'rovn_update_task', 'rovn_get_report_card', 'rovn_get_trust_score',
                   'rovn_start_session', 'rovn_end_session'];

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
    assert.equal(list.tools.length, 10);
  });

  it('tools/call with unregistered agent', async () => {
    resetConfig();
    const result = await handleRequest({
      id: 3,
      method: 'tools/call',
      params: { name: 'rovn_get_trust_score', arguments: {} },
    }) as { content: Array<{ text: string }>; isError: boolean };

    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('Not registered'));
  });
});

// ═══════════════════════════════════════════════════════════════
// Multi-Agent Registration & Activity Routing Tests
// ═══════════════════════════════════════════════════════════════

describe('rovn_register — reuse with pre-configured credentials', () => {
  afterEach(() => restoreFetch());

  it('reuses existing agent when trust-score validation succeeds', async () => {
    resetConfig({ apiKey: 'rovn_existing_key', agentId: 'existing-agent-001', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async (url: string) => {
      if (url.includes('/trust-score')) {
        return jsonResponse({ success: true, data: { score: 87, grade: 'B+', agent_name: 'My Agent' } });
      }
      return jsonResponse({ success: false }, 404);
    });

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'My Agent' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    assert.equal(parsed.data.id, 'existing-agent-001');
    assert.ok(parsed.data.message.includes('Already registered'));
    // Config should remain unchanged
    assert.equal(config.agentId, 'existing-agent-001');
    assert.equal(config.apiKey, 'rovn_existing_key');
  });

  it('preserves pre-configured credentials when validation fails (server down)', async () => {
    resetConfig({ apiKey: 'rovn_preconfigured', agentId: 'preconfigured-agent', rovnUrl: 'https://test.rovn.io' });
    // Simulate process.argv having --api-key (pre-configured)
    const origArgv = process.argv;
    process.argv = ['node', 'server.js', '--api-key', 'rovn_preconfigured', '--agent-id', 'preconfigured-agent'];

    mockFetch(async () => {
      // Server is down — timeout or error
      return jsonResponse({ success: false, error: 'Server error' }, 500);
    });

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Agent X' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    assert.equal(parsed.data.id, 'preconfigured-agent');
    assert.ok(parsed.data.message.includes('pre-configured'));
    // CRITICAL: credentials must NOT be cleared
    assert.equal(config.agentId, 'preconfigured-agent');
    assert.equal(config.apiKey, 'rovn_preconfigured');

    process.argv = origArgv;
  });

  it('preserves pre-configured credentials when validation returns 401', async () => {
    resetConfig({ apiKey: 'rovn_key_401', agentId: 'agent-401', rovnUrl: 'https://test.rovn.io' });
    const origArgv = process.argv;
    process.argv = ['node', 'server.js', '--api-key', 'rovn_key_401'];

    mockFetch(async () => {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    });

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Agent Y' } });
    const parsed = JSON.parse(result.content[0].text);

    // Should still keep pre-configured credentials
    assert.equal(result.isError, false);
    assert.equal(config.agentId, 'agent-401');
    assert.equal(config.apiKey, 'rovn_key_401');

    process.argv = origArgv;
  });

  it('preserves credentials from env var when validation fails', async () => {
    const origEnv = process.env.ROVN_API_KEY;
    process.env.ROVN_API_KEY = 'rovn_env_key';
    resetConfig({ apiKey: 'rovn_env_key', agentId: 'env-agent', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async () => jsonResponse({ success: false }, 503));

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Env Agent' } });

    assert.equal(result.isError, false);
    assert.equal(config.agentId, 'env-agent');
    assert.equal(config.apiKey, 'rovn_env_key');

    if (origEnv === undefined) {
      delete process.env.ROVN_API_KEY;
    } else {
      process.env.ROVN_API_KEY = origEnv;
    }
  });
});

describe('rovn_register — dynamic registration (no pre-configured credentials)', () => {
  afterEach(() => restoreFetch());

  it('registers new agent when no credentials exist', async () => {
    resetConfig({ rovnUrl: 'https://test.rovn.io', ownerEmail: 'owner@test.com' });

    mockFetch(async (url: string, init?: RequestInit) => {
      if (url.includes('/register')) {
        const body = JSON.parse(init?.body as string);
        return jsonResponse({
          success: true,
          data: {
            id: 'new-agent-123',
            name: body.name,
            api_key: 'rovn_new_key_123',
          },
        }, 201);
      }
      // Auto-log call — ignore
      return jsonResponse({ success: true });
    });

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Fresh Agent' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    assert.equal(parsed.data.id, 'new-agent-123');
    assert.equal(parsed.data.name, 'Fresh Agent');
    // Config should be updated with new credentials
    assert.equal(config.agentId, 'new-agent-123');
    assert.equal(config.apiKey, 'rovn_new_key_123');
  });

  it('re-registers when dynamic credentials fail validation', async () => {
    // Simulate previously registered credentials (not from CLI args)
    resetConfig({ apiKey: 'rovn_old_dynamic_key', agentId: 'old-dynamic-agent', rovnUrl: 'https://test.rovn.io' });
    const origArgv = process.argv;
    process.argv = ['node', 'server.js']; // No --api-key flag!

    let callCount = 0;
    mockFetch(async (url: string, init?: RequestInit) => {
      callCount++;
      if (url.includes('/trust-score')) {
        // Validation fails — old credentials are invalid
        return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
      }
      if (url.includes('/register')) {
        return jsonResponse({
          success: true,
          data: { id: 'fresh-agent-456', name: 'Re-registered', api_key: 'rovn_fresh_456' },
        }, 201);
      }
      return jsonResponse({ success: true });
    });

    const result = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Re-registered' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    // Should have re-registered with new ID
    assert.equal(config.agentId, 'fresh-agent-456');
    assert.equal(config.apiKey, 'rovn_fresh_456');

    process.argv = origArgv;
  });
});

describe('Activity routing — correct agent_id in API paths', () => {
  afterEach(() => restoreFetch());

  it('log_activity uses config.agentId in the path', async () => {
    resetConfig({ apiKey: 'rovn_agent_a', agentId: 'agent-AAA', rovnUrl: 'https://test.rovn.io' });

    let capturedUrl = '';
    mockFetch(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ success: true, data: { id: 'act-1', agent_id: 'agent-AAA', title: 'Test' } }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Test activity', type: 'testing' } });

    assert.ok(capturedUrl.includes('/api/agents/agent-AAA/activities'), `Expected agent-AAA in URL but got: ${capturedUrl}`);
  });

  it('check_action uses config.agentId in the path', async () => {
    resetConfig({ apiKey: 'rovn_agent_b', agentId: 'agent-BBB', rovnUrl: 'https://test.rovn.io' });

    const capturedUrls: string[] = [];
    mockFetch(async (url: string) => {
      capturedUrls.push(url);
      return jsonResponse({ success: true, data: { decision: 'approved' } });
    });

    await handleToolCall({ name: 'rovn_check_action', arguments: { action: 'deploy' } });

    // First URL is the check call; autoLog may fire after
    assert.ok(capturedUrls[0].includes('/api/agents/agent-BBB/check'), `Expected agent-BBB/check in URL but got: ${capturedUrls[0]}`);
  });

  it('get_tasks uses config.agentId in the path', async () => {
    resetConfig({ apiKey: 'rovn_agent_c', agentId: 'agent-CCC', rovnUrl: 'https://test.rovn.io' });

    let capturedUrl = '';
    mockFetch(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ success: true, data: [] });
    });

    await handleToolCall({ name: 'rovn_get_tasks', arguments: {} });

    assert.ok(capturedUrl.includes('/api/agents/agent-CCC/tasks'), `Expected agent-CCC in URL but got: ${capturedUrl}`);
  });

  it('request_approval uses config.agentId in the path', async () => {
    resetConfig({ apiKey: 'rovn_agent_d', agentId: 'agent-DDD', rovnUrl: 'https://test.rovn.io' });

    const capturedUrls: string[] = [];
    mockFetch(async (url: string) => {
      capturedUrls.push(url);
      return jsonResponse({ success: true, data: { id: 'apr-1' } }, 201);
    });

    await handleToolCall({ name: 'rovn_request_approval', arguments: { title: 'Deploy to prod' } });

    // First URL is the approval call; autoLog may fire after
    assert.ok(capturedUrls[0].includes('/api/agents/agent-DDD/approvals'), `Expected agent-DDD/approvals in URL but got: ${capturedUrls[0]}`);
  });

  it('get_trust_score uses config.agentId in the path', async () => {
    resetConfig({ apiKey: 'rovn_agent_e', agentId: 'agent-EEE', rovnUrl: 'https://test.rovn.io' });

    let capturedUrl = '';
    mockFetch(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ success: true, data: { score: 75 } });
    });

    await handleToolCall({ name: 'rovn_get_trust_score', arguments: {} });

    assert.ok(capturedUrl.includes('/api/agents/agent-EEE/trust-score'), `Expected agent-EEE in URL but got: ${capturedUrl}`);
  });

  it('update_task uses task_id not agent_id', async () => {
    resetConfig({ apiKey: 'rovn_agent_f', agentId: 'agent-FFF', rovnUrl: 'https://test.rovn.io' });

    const capturedUrls: string[] = [];
    mockFetch(async (url: string) => {
      capturedUrls.push(url);
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_update_task', arguments: { task_id: 'task-999', status: 'completed' } });

    // PATCH goes to /api/tasks/{task_id}
    assert.ok(capturedUrls.some(u => u.includes('/api/tasks/task-999')), 'Should use task_id in path');
  });
});

describe('Multi-agent isolation — switching agents preserves state', () => {
  afterEach(() => restoreFetch());

  it('activities go to correct agent after register reuse', async () => {
    // Agent A is pre-configured
    resetConfig({ apiKey: 'rovn_key_A', agentId: 'agent-A', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async (url: string) => {
      if (url.includes('/trust-score')) {
        return jsonResponse({ success: true, data: { score: 90, agent_name: 'Agent A' } });
      }
      return jsonResponse({ success: true, data: { id: 'act-a1', agent_id: 'agent-A' } }, 201);
    });

    // Register (reuses)
    const regResult = await handleToolCall({ name: 'rovn_register', arguments: { name: 'Agent A' } });
    const regParsed = JSON.parse(regResult.content[0].text);
    assert.equal(regParsed.data.id, 'agent-A');

    // Log activity — should go to agent-A
    let activityUrl = '';
    mockFetch(async (url: string) => {
      activityUrl = url;
      return jsonResponse({ success: true, data: { id: 'act-1', agent_id: 'agent-A' } }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Work by Agent A' } });
    assert.ok(activityUrl.includes('/agent-A/'), `Expected agent-A but got: ${activityUrl}`);
    assert.equal(config.agentId, 'agent-A');
  });

  it('registration does not leak credentials between sequential agents', async () => {
    // First agent registers dynamically
    resetConfig({ rovnUrl: 'https://test.rovn.io' });
    const origArgv = process.argv;
    process.argv = ['node', 'server.js'];

    mockFetch(async (url: string) => {
      if (url.includes('/register')) {
        return jsonResponse({
          success: true,
          data: { id: 'dynamic-1', name: 'Dynamic 1', api_key: 'rovn_dyn_1' },
        }, 201);
      }
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_register', arguments: { name: 'Dynamic 1' } });
    assert.equal(config.agentId, 'dynamic-1');
    assert.equal(config.apiKey, 'rovn_dyn_1');

    // Now reset for a different agent
    resetConfig({ apiKey: 'rovn_static_2', agentId: 'static-2', rovnUrl: 'https://test.rovn.io' });
    process.argv = ['node', 'server.js', '--api-key', 'rovn_static_2'];

    mockFetch(async (url: string) => {
      if (url.includes('/trust-score')) {
        return jsonResponse({ success: true, data: { score: 50 } });
      }
      return jsonResponse({ success: true, data: { agent_id: 'static-2' } }, 201);
    });

    await handleToolCall({ name: 'rovn_register', arguments: { name: 'Static 2' } });
    assert.equal(config.agentId, 'static-2');

    // Log activity — must go to static-2
    let actUrl = '';
    mockFetch(async (url: string) => {
      actUrl = url;
      return jsonResponse({ success: true }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Work by Static 2' } });
    assert.ok(actUrl.includes('/static-2/'), `Activity should route to static-2 but got: ${actUrl}`);
    assert.ok(!actUrl.includes('/dynamic-1/'), 'Activity must NOT route to previous agent');

    process.argv = origArgv;
  });
});

describe('Authorization header — correct API key per agent', () => {
  afterEach(() => restoreFetch());

  it('sends Bearer token matching config.apiKey', async () => {
    resetConfig({ apiKey: 'rovn_secret_key_XYZ', agentId: 'agent-xyz', rovnUrl: 'https://test.rovn.io' });

    let capturedAuth = '';
    mockFetch(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuth = headers?.Authorization ?? '';
      return jsonResponse({ success: true, data: [] });
    });

    await handleToolCall({ name: 'rovn_get_tasks', arguments: {} });

    assert.equal(capturedAuth, 'Bearer rovn_secret_key_XYZ');
  });

  it('updates auth header after re-registration', async () => {
    resetConfig({ rovnUrl: 'https://test.rovn.io' });
    const origArgv = process.argv;
    process.argv = ['node', 'server.js'];

    // Registration gives new credentials
    mockFetch(async (url: string) => {
      if (url.includes('/register')) {
        return jsonResponse({
          success: true,
          data: { id: 'new-id', name: 'New', api_key: 'rovn_brand_new_key' },
        }, 201);
      }
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_register', arguments: { name: 'New' } });
    assert.equal(config.apiKey, 'rovn_brand_new_key');

    // Subsequent calls should use the new key
    let capturedAuth = '';
    mockFetch(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      capturedAuth = headers?.Authorization ?? '';
      return jsonResponse({ success: true, data: { score: 80 } });
    });

    await handleToolCall({ name: 'rovn_get_trust_score', arguments: {} });
    assert.equal(capturedAuth, 'Bearer rovn_brand_new_key');

    process.argv = origArgv;
  });
});

describe('Network failure resilience', () => {
  afterEach(() => restoreFetch());

  it('handles network timeout gracefully in log_activity', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-timeout', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async () => {
      throw new DOMException('The operation was aborted', 'TimeoutError');
    });

    const result = await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Test' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.success, false);
    assert.ok(parsed.error.includes('timed out'));
  });

  it('handles connection refused gracefully', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-refused', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Test' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.success, false);
    assert.ok(parsed.error.includes('connect'));
  });
});

// ═══════════════════════════════════════════════════════════════
// Session Management Tests
// ═══════════════════════════════════════════════════════════════

describe('rovn_start_session — manual session start', () => {
  afterEach(() => restoreFetch());

  it('starts a session and stores sessionId in config', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-sess', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async (url: string) => {
      if (url.includes('/sessions')) {
        return jsonResponse({
          success: true,
          data: { id: 'session-123', agent_id: 'agent-sess', status: 'active' },
        }, 201);
      }
      return jsonResponse({ success: true });
    });

    const result = await handleToolCall({ name: 'rovn_start_session', arguments: { name: 'Test Session' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    assert.equal(parsed.data.id, 'session-123');
    assert.equal(config.sessionId, 'session-123');
  });

  it('ends existing session before starting a new one', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-sess', rovnUrl: 'https://test.rovn.io', sessionId: 'old-session' });

    const capturedUrls: string[] = [];
    mockFetch(async (url: string, init?: RequestInit) => {
      capturedUrls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/sessions/old-session') && init?.method === 'PATCH') {
        return jsonResponse({ success: true, data: { id: 'old-session', status: 'ended' } });
      }
      if (url.includes('/sessions') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'new-session', status: 'active' } }, 201);
      }
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_start_session', arguments: { name: 'New Session' } });

    assert.ok(capturedUrls.some(u => u.includes('PATCH') && u.includes('old-session')), 'Should end old session');
    assert.equal(config.sessionId, 'new-session');
  });
});

describe('rovn_end_session — manual session end', () => {
  afterEach(() => restoreFetch());

  it('ends the current session and clears sessionId', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-sess', rovnUrl: 'https://test.rovn.io', sessionId: 'session-abc' });

    mockFetch(async (url: string) => {
      if (url.includes('/sessions/session-abc')) {
        return jsonResponse({ success: true, data: { id: 'session-abc', status: 'ended' } });
      }
      return jsonResponse({ success: true });
    });

    const result = await handleToolCall({ name: 'rovn_end_session', arguments: { summary: 'Done with work' } });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, false);
    assert.equal(parsed.data.status, 'ended');
    assert.equal(config.sessionId, '');
  });

  it('returns error when no active session', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-sess', rovnUrl: 'https://test.rovn.io' });

    const result = await handleToolCall({ name: 'rovn_end_session', arguments: {} });
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(result.isError, true);
    assert.ok(parsed.error.includes('No active session'));
  });
});

describe('Auto-session on registration', () => {
  afterEach(() => restoreFetch());

  it('auto-starts session after successful registration reuse', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-auto', rovnUrl: 'https://test.rovn.io' });

    mockFetch(async (url: string) => {
      if (url.includes('/trust-score')) {
        return jsonResponse({ success: true, data: { score: 90, agent_name: 'Auto Agent' } });
      }
      if (url.includes('/sessions') && !url.includes('/activities')) {
        return jsonResponse({ success: true, data: { id: 'auto-session-1', status: 'active' } }, 201);
      }
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_register', arguments: { name: 'Auto Agent' } });

    assert.equal(config.sessionId, 'auto-session-1');
  });

  it('auto-starts session after fresh registration', async () => {
    resetConfig({ rovnUrl: 'https://test.rovn.io' });
    const origArgv = process.argv;
    process.argv = ['node', 'server.js'];

    mockFetch(async (url: string) => {
      if (url.includes('/register')) {
        return jsonResponse({
          success: true,
          data: { id: 'new-agent', name: 'New', api_key: 'rovn_new_key' },
        }, 201);
      }
      if (url.includes('/sessions') && !url.includes('/activities')) {
        return jsonResponse({ success: true, data: { id: 'auto-session-new', status: 'active' } }, 201);
      }
      return jsonResponse({ success: true });
    });

    await handleToolCall({ name: 'rovn_register', arguments: { name: 'New Agent' } });

    assert.equal(config.sessionId, 'auto-session-new');

    process.argv = origArgv;
  });
});

describe('Activity session_id auto-attachment', () => {
  afterEach(() => restoreFetch());

  it('attaches session_id to log_activity when session is active', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-att', rovnUrl: 'https://test.rovn.io', sessionId: 'sess-xyz' });

    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url: string, init?: RequestInit) => {
      if (init?.body) capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ success: true, data: { id: 'act-1' } }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Test' } });

    assert.equal(capturedBody.session_id, 'sess-xyz');
  });

  it('does not attach session_id when no session is active', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-att', rovnUrl: 'https://test.rovn.io' });

    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url: string, init?: RequestInit) => {
      if (init?.body) capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ success: true, data: { id: 'act-2' } }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Test' } });

    assert.equal(capturedBody.session_id, undefined);
  });

  it('passes task_id when explicitly provided', async () => {
    resetConfig({ apiKey: 'rovn_key', agentId: 'agent-att', rovnUrl: 'https://test.rovn.io', sessionId: 'sess-abc' });

    let capturedBody: Record<string, unknown> = {};
    mockFetch(async (_url: string, init?: RequestInit) => {
      if (init?.body) capturedBody = JSON.parse(init.body as string);
      return jsonResponse({ success: true, data: { id: 'act-3' } }, 201);
    });

    await handleToolCall({ name: 'rovn_log_activity', arguments: { title: 'Task work', task_id: 'task-42' } });

    assert.equal(capturedBody.session_id, 'sess-abc');
    assert.equal(capturedBody.task_id, 'task-42');
  });
});
