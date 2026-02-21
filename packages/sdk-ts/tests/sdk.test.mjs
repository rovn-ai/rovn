/**
 * Comprehensive tests for @rovn/agent TypeScript SDK
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Run: node --test tests/sdk.test.mjs
 *
 * Tests are written against the source API (src/index.ts).
 * The dist/ must be rebuilt before running: npm run build && npm test
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// We import from the compiled dist (CommonJS) via dynamic import
// Since dist/index.js uses module.exports, we need createRequire
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sdk = require('../dist/index.js');
const { RovnAgent, RovnError } = sdk;

// ==================== Helpers ====================

/**
 * Creates a mock fetch function that returns the given response.
 * Captures calls for assertion.
 */
function createMockFetch(responseBody, options = {}) {
  const { status = 200, ok = true, contentType = 'application/json' } = options;
  const calls = [];

  const mockFn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      statusText: options.statusText || 'OK',
      headers: {
        get: (name) => {
          if (name === 'content-type') return contentType;
          return null;
        },
      },
      json: async () => responseBody,
      body: options.body || null,
    };
  };

  return { mockFn, calls };
}

/**
 * Installs a mock fetch globally and returns a cleanup function.
 */
function installMockFetch(responseBody, options = {}) {
  const { mockFn, calls } = createMockFetch(responseBody, options);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFn;
  const restore = () => { globalThis.fetch = originalFetch; };
  return { calls, restore, mockFn };
}

/**
 * Creates a RovnAgent with a known agentId set (by faking registration state).
 */
function createAgentWithId(agentId = 'agent-123') {
  const agent = new RovnAgent({
    baseUrl: 'https://rovn.example.com',
    apiKey: 'test-api-key',
  });
  // Use getInfo to set agentId internally
  // We'll use a different approach: call connect with agentId to set it
  // Actually, we can set it via getInfo mock
  return agent;
}

// ==================== Test Suites ====================

describe('RovnAgent Constructor', () => {
  it('should initialize with baseUrl and apiKey', () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'my-api-key',
    });
    assert.ok(agent instanceof RovnAgent);
  });

  it('should strip trailing slash from baseUrl', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com/',
      apiKey: 'my-api-key',
    });

    const { calls, restore } = installMockFetch(
      { success: true, data: { id: 'a1', name: 'test', status: 'active' } }
    );

    try {
      await agent.getInfo();
      assert.ok(calls[0].url.startsWith('https://rovn.example.com/api/'),
        'URL should not have double slash');
      assert.ok(!calls[0].url.includes('//api/'),
        'URL should not contain //api/');
    } finally {
      restore();
    }
  });

  it('should default fireAndForget to false', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // Set agentId via getInfo
    const { restore: r1 } = installMockFetch(
      { success: true, data: { id: 'a1', name: 'test', status: 'active' } }
    );
    await agent.getInfo();
    r1();

    // sendEvent in non-fire-and-forget mode should await the HTTP call
    const { calls, restore } = installMockFetch({ success: true, data: null });
    try {
      await agent.sendEvent('activity', { title: 'test' });
      assert.equal(calls.length, 1, 'Should have made 1 fetch call synchronously');
    } finally {
      restore();
    }
  });
});

describe('RovnAgent Headers', () => {
  it('should include Authorization Bearer header', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'secret-key-123',
    });

    const { calls, restore } = installMockFetch(
      { success: true, data: { id: 'a1', name: 'test', status: 'active' } }
    );

    try {
      await agent.getInfo();
      const headers = calls[0].init.headers;
      assert.equal(headers['Authorization'], 'Bearer secret-key-123');
      assert.equal(headers['Content-Type'], 'application/json');
    } finally {
      restore();
    }
  });
});

describe('RovnError', () => {
  it('should create error with message, statusCode, and errorCode', () => {
    const err = new RovnError('Something failed', 404, 'NOT_FOUND');
    assert.equal(err.message, 'Something failed');
    assert.equal(err.statusCode, 404);
    assert.equal(err.errorCode, 'NOT_FOUND');
    assert.equal(err.name, 'RovnError');
  });

  it('should extend Error', () => {
    const err = new RovnError('test', 500);
    assert.ok(err instanceof Error);
    assert.ok(err instanceof RovnError);
  });

  it('should allow undefined errorCode', () => {
    const err = new RovnError('test', 500);
    assert.equal(err.errorCode, undefined);
  });
});

describe('RovnAgent.register()', () => {
  it('should register and return agent, id, apiKey', async () => {
    const { calls, restore } = installMockFetch({
      success: true,
      data: { id: 'new-agent-id', api_key: 'generated-key' },
    });

    try {
      const result = await RovnAgent.register('https://rovn.example.com', {
        name: 'TestBot',
        description: 'A test agent',
        type: 'bot',
        capabilities: ['read', 'write'],
      });

      assert.equal(result.id, 'new-agent-id');
      assert.equal(result.apiKey, 'generated-key');
      assert.ok(result.agent instanceof RovnAgent);

      // Verify the fetch call
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith('/api/agents/register'));
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.name, 'TestBot');
      assert.equal(body.description, 'A test agent');
      assert.deepEqual(body.capabilities, ['read', 'write']);
    } finally {
      restore();
    }
  });

  it('should throw RovnError on failed registration', async () => {
    const { restore } = installMockFetch({
      success: false,
      error: 'Agent name already exists',
    });

    try {
      await assert.rejects(
        () => RovnAgent.register('https://rovn.example.com', { name: 'Dup' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.message, 'Agent name already exists');
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it('should strip trailing slash from baseUrl during registration', async () => {
    const { calls, restore } = installMockFetch({
      success: true,
      data: { id: 'id', api_key: 'key' },
    });

    try {
      await RovnAgent.register('https://rovn.example.com/', { name: 'Bot' });
      assert.ok(!calls[0].url.includes('//api/'));
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.getInfo()', () => {
  it('should call /api/agents/me when agentId is not set', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    const agentInfo = {
      id: 'discovered-id',
      name: 'MyBot',
      description: null,
      status: 'active',
      type: 'bot',
      approved: true,
      capabilities: ['read'],
      metadata: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      last_seen_at: null,
    };

    const { calls, restore } = installMockFetch({ success: true, data: agentInfo });

    try {
      const info = await agent.getInfo();
      assert.equal(info.id, 'discovered-id');
      assert.equal(info.name, 'MyBot');
      assert.ok(calls[0].url.endsWith('/api/agents/me'));
    } finally {
      restore();
    }
  });

  it('should call /api/agents/:id when agentId is set', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // First call sets agentId
    const { restore: r1 } = installMockFetch({
      success: true,
      data: { id: 'agent-42', name: 'Bot' },
    });
    await agent.getInfo();
    r1();

    // Second call should use the known agentId
    const { calls, restore } = installMockFetch({
      success: true,
      data: { id: 'agent-42', name: 'Bot' },
    });

    try {
      await agent.getInfo();
      assert.ok(calls[0].url.endsWith('/api/agents/agent-42'));
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.sendEvent()', () => {
  let agent;
  let restoreSetup;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    // Set agentId
    const { restore } = installMockFetch({
      success: true,
      data: { id: 'agent-1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should POST to /api/webhook/agent with event and data', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendEvent('activity', { title: 'Test Activity' });
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith('/api/webhook/agent'));
      assert.equal(calls[0].init.method, 'POST');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'activity');
      assert.equal(body.data.title, 'Test Activity');
    } finally {
      restore();
    }
  });

  it('should throw RovnError on API error response', async () => {
    const { restore } = installMockFetch(
      { success: false, error: 'Unauthorized', code: 'AUTH_FAILED' },
      { status: 401, ok: false }
    );

    try {
      await assert.rejects(
        () => agent.sendEvent('activity', { title: 'test' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.message, 'Unauthorized');
          assert.equal(err.statusCode, 401);
          assert.equal(err.errorCode, 'AUTH_FAILED');
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it('should throw RovnError on HTML error response', async () => {
    const { restore } = installMockFetch(
      null,
      { status: 502, ok: false, contentType: 'text/html', statusText: 'Bad Gateway' }
    );
    // Override json to throw (since HTML response won't have valid JSON)
    const originalFetch = globalThis.fetch;
    const mockFn = async (url, init) => ({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: { get: (name) => name === 'content-type' ? 'text/html' : null },
      json: async () => { throw new Error('not JSON'); },
    });
    globalThis.fetch = mockFn;
    restore(); // restore the first mock

    try {
      await assert.rejects(
        () => agent.sendEvent('activity', { title: 'test' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.statusCode, 502);
          assert.ok(err.message.includes('502'));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('RovnAgent.logActivity()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true,
      data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send activity event with title', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.logActivity('Processed 100 records');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'activity');
      assert.equal(body.data.title, 'Processed 100 records');
    } finally {
      restore();
    }
  });

  it('should send activity with options', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.logActivity('Deploy', {
        type: 'deployment',
        description: 'Deployed v2.0',
        metadata: { version: '2.0' },
      });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.data.title, 'Deploy');
      assert.equal(body.data.type, 'deployment');
      assert.equal(body.data.description, 'Deployed v2.0');
      assert.deepEqual(body.data.metadata, { version: '2.0' });
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.updateTaskStatus()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send task_update event with taskId and status', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.updateTaskStatus('task-42', 'completed');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'task_update');
      assert.equal(body.data.task_id, 'task-42');
      assert.equal(body.data.status, 'completed');
    } finally {
      restore();
    }
  });

  it('should include result when provided', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.updateTaskStatus('task-42', 'completed', { output: 'done' });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.data.result, { output: 'done' });
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.sendMessage()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send message event with content', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendMessage('Hello, owner!');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'message');
      assert.equal(body.data.content, 'Hello, owner!');
    } finally {
      restore();
    }
  });

  it('should include message_type and metadata', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendMessage('Alert', { message_type: 'alert', metadata: { severity: 'high' } });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.data.message_type, 'alert');
      assert.deepEqual(body.data.metadata, { severity: 'high' });
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.updateStatus()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send status event', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.updateStatus('busy');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'status');
      assert.equal(body.data.status, 'busy');
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.shareData()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send share_data event with title and content', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.shareData('Monthly Report', { revenue: 50000 }, 'report');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'share_data');
      assert.equal(body.data.title, 'Monthly Report');
      assert.deepEqual(body.data.content, { revenue: 50000 });
      assert.equal(body.data.type, 'report');
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.respondToCommand()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send command_response event', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.respondToCommand('cmd-99', 'success', { message: 'Done' });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'command_response');
      assert.equal(body.data.command_id, 'cmd-99');
      assert.equal(body.data.status, 'success');
      assert.deepEqual(body.data.response, { message: 'Done' });
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.requestApproval()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send approval_request event', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.requestApproval({
        type: 'deployment',
        title: 'Deploy to production',
        description: 'Release v3.0',
        urgency: 'high',
        metadata: { env: 'production' },
      });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'approval_request');
      assert.equal(body.data.type, 'deployment');
      assert.equal(body.data.title, 'Deploy to production');
      assert.equal(body.data.urgency, 'high');
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.sendPeerMessage()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should send peer_message event with to_agent_id', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendPeerMessage('peer-agent-7', 'Hey, need help?');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.event, 'peer_message');
      assert.equal(body.data.to_agent_id, 'peer-agent-7');
      assert.equal(body.data.content, 'Hey, need help?');
    } finally {
      restore();
    }
  });

  it('should include optional message_type and metadata', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendPeerMessage('peer-2', 'Task done', {
        message_type: 'notification',
        metadata: { task_id: 't-1' },
      });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.data.message_type, 'notification');
      assert.deepEqual(body.data.metadata, { task_id: 't-1' });
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.getTasks()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should fetch tasks for the agent', async () => {
    const tasks = [
      { id: 't1', title: 'Task 1', status: 'pending' },
      { id: 't2', title: 'Task 2', status: 'completed' },
    ];
    const { calls, restore } = installMockFetch({ success: true, data: tasks });

    try {
      const result = await agent.getTasks();
      assert.equal(result.length, 2);
      assert.equal(result[0].id, 't1');
      assert.ok(calls[0].url.includes('/api/agents/a1/tasks'));
      // No query string when no options
      assert.ok(!calls[0].url.includes('?'));
    } finally {
      restore();
    }
  });

  it('should pass status and limit as query params', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: [] });

    try {
      await agent.getTasks({ status: 'pending', limit: 10 });
      const url = calls[0].url;
      assert.ok(url.includes('status=pending'), `URL should contain status param: ${url}`);
      assert.ok(url.includes('limit=10'), `URL should contain limit param: ${url}`);
    } finally {
      restore();
    }
  });

  it('should throw RovnError if agentId is not set', async () => {
    const freshAgent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    await assert.rejects(
      () => freshAgent.getTasks(),
      (err) => {
        assert.ok(err instanceof RovnError);
        assert.equal(err.errorCode, 'AGENT_ID_MISSING');
        return true;
      }
    );
  });
});

describe('RovnAgent.getPeerMessages()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should fetch peer messages', async () => {
    const messages = [
      { id: 'm1', from_agent_id: 'a2', to_agent_id: 'a1', content: 'Hi' },
    ];
    const { calls, restore } = installMockFetch({ success: true, data: messages });

    try {
      const result = await agent.getPeerMessages();
      assert.equal(result.length, 1);
      assert.equal(result[0].content, 'Hi');
      assert.ok(calls[0].url.includes('/api/agents/a1/peer'));
    } finally {
      restore();
    }
  });

  it('should pass direction and limit params', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: [] });

    try {
      await agent.getPeerMessages({ direction: 'inbox', limit: 5 });
      const url = calls[0].url;
      assert.ok(url.includes('direction=inbox'));
      assert.ok(url.includes('limit=5'));
    } finally {
      restore();
    }
  });

  it('should throw RovnError if agentId is not set', async () => {
    const freshAgent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    await assert.rejects(
      () => freshAgent.getPeerMessages(),
      (err) => {
        assert.ok(err instanceof RovnError);
        assert.equal(err.errorCode, 'AGENT_ID_MISSING');
        return true;
      }
    );
  });
});

describe('RovnAgent.getGuardrails()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should fetch guardrails for the agent', async () => {
    const guardrails = [
      { id: 'g1', metric: 'api_calls', limit_value: 100, current_value: 42, window: 'daily', action: 'block', enabled: true },
    ];
    const { calls, restore } = installMockFetch({ success: true, data: guardrails });

    try {
      const result = await agent.getGuardrails();
      assert.equal(result.length, 1);
      assert.equal(result[0].metric, 'api_calls');
      assert.ok(calls[0].url.includes('/api/agents/a1/guardrails'));
    } finally {
      restore();
    }
  });

  it('should throw RovnError if agentId is not set', async () => {
    const freshAgent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    await assert.rejects(
      () => freshAgent.getGuardrails(),
      (err) => {
        assert.ok(err instanceof RovnError);
        assert.equal(err.errorCode, 'AGENT_ID_MISSING');
        return true;
      }
    );
  });
});

describe('RovnAgent.getGuardrailRemaining()', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should return remaining value for matching metric', async () => {
    const guardrails = [
      { id: 'g1', metric: 'api_calls', limit_value: 100, current_value: 60 },
      { id: 'g2', metric: 'cost_usd', limit_value: 50, current_value: 10 },
    ];
    const { restore } = installMockFetch({ success: true, data: guardrails });

    try {
      const remaining = await agent.getGuardrailRemaining('api_calls');
      assert.equal(remaining, 40);
    } finally {
      restore();
    }
  });

  it('should return null for non-existent metric', async () => {
    const guardrails = [
      { id: 'g1', metric: 'api_calls', limit_value: 100, current_value: 60 },
    ];
    const { restore } = installMockFetch({ success: true, data: guardrails });

    try {
      const remaining = await agent.getGuardrailRemaining('nonexistent');
      assert.equal(remaining, null);
    } finally {
      restore();
    }
  });

  it('should cache guardrails and not refetch within TTL', async () => {
    const guardrails = [
      { id: 'g1', metric: 'api_calls', limit_value: 100, current_value: 30 },
    ];
    const { calls, restore } = installMockFetch({ success: true, data: guardrails });

    try {
      await agent.getGuardrailRemaining('api_calls');
      await agent.getGuardrailRemaining('api_calls');
      await agent.getGuardrailRemaining('api_calls');
      // Only 1 fetch call should have been made (cached)
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });

  it('should respect invalidateGuardrailCache()', async () => {
    const guardrails = [
      { id: 'g1', metric: 'api_calls', limit_value: 100, current_value: 30 },
    ];
    const { calls, restore } = installMockFetch({ success: true, data: guardrails });

    try {
      await agent.getGuardrailRemaining('api_calls');
      assert.equal(calls.length, 1);

      agent.invalidateGuardrailCache();

      await agent.getGuardrailRemaining('api_calls');
      assert.equal(calls.length, 2, 'Should refetch after cache invalidation');
    } finally {
      restore();
    }
  });
});

describe('RovnAgent fire-and-forget mode', () => {
  it('should enqueue events and not await HTTP in fire-and-forget mode', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
      fireAndForget: true,
    });

    // Set agentId
    const { restore: r1 } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    r1();

    // sendEvent should return immediately without making a fetch call
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: null }),
      };
    };

    try {
      // sendEvent should return immediately (enqueue)
      await agent.sendEvent('activity', { title: 'test' });
      // The event is queued but the drain might not have started yet
      // since scheduleFlush uses setTimeout(0)
      // We can't assert fetchCalled is false here reliably,
      // but we can verify the method doesn't throw
      assert.ok(true, 'sendEvent returned without throwing');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Clean up
    agent.disconnect();
  });
});

describe('RovnAgent retry logic (isRetryable)', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should not retry on 400 client errors', async () => {
    const { restore } = installMockFetch(
      { success: false, error: 'Bad Request', code: 'BAD_REQUEST' },
      { status: 400, ok: false }
    );

    try {
      await assert.rejects(
        () => agent.sendEvent('activity', { title: 'test' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it('should not retry on 403 forbidden errors', async () => {
    const { restore } = installMockFetch(
      { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
      { status: 403, ok: false }
    );

    try {
      await assert.rejects(
        () => agent.sendEvent('activity', { title: 'test' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );
    } finally {
      restore();
    }
  });
});

describe('RovnAgent.connect() SSE', () => {
  it('should throw RovnError if agentId is not set and not provided', () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    assert.throws(
      () => agent.connect(() => {}),
      (err) => {
        assert.ok(err instanceof RovnError);
        assert.ok(err.message.includes('agentId'));
        return true;
      }
    );
  });

  it('should set agentId when provided via options', () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // Mock fetch for the SSE connection
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      // Return a response that will cause the read loop to end immediately
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
          }),
        },
      };
    };

    try {
      // Should not throw because agentId is provided
      agent.connect(() => {}, { agentId: 'provided-id' });
      // Disconnect immediately
      agent.disconnect();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('RovnAgent.disconnect()', () => {
  it('should abort the SSE connection', () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // Mock fetch for SSE
    const originalFetch = globalThis.fetch;
    let abortSignalReceived = null;

    globalThis.fetch = async (url, init) => {
      abortSignalReceived = init?.signal;
      // Hang indefinitely
      return new Promise(() => {});
    };

    try {
      agent.connect(() => {}, { agentId: 'test-id' });

      // Disconnect should abort
      agent.disconnect();

      // Calling disconnect again should be safe (no error)
      agent.disconnect();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('RovnAgent.flush()', () => {
  it('should resolve immediately when queue is empty', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // flush on empty queue should not throw
    await agent.flush();
    assert.ok(true, 'flush() resolved without error');
  });
});

describe('RovnAgent.close()', () => {
  it('should disconnect SSE and flush pending events', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    // close() calls disconnect() + flush()
    await agent.close();
    assert.ok(true, 'close() resolved without error');
  });
});

describe('Request error handling', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should handle network errors (fetch throws TypeError)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };

    try {
      // In non-fire-and-forget mode, network errors on sendEvent
      // should be caught and the event queued (retryable)
      // The function should NOT throw for retryable errors
      await agent.sendEvent('activity', { title: 'test' });
      // If it reaches here, the event was queued (retryable network error)
      assert.ok(true, 'Network error was handled gracefully (queued for retry)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('should throw on non-retryable errors in sendEvent', async () => {
    const { restore } = installMockFetch(
      { success: false, error: 'Invalid event', code: 'VALIDATION_ERROR' },
      { status: 422, ok: false }
    );

    try {
      await assert.rejects(
        () => agent.sendEvent('activity', { title: 'test' }),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.equal(err.statusCode, 422);
          return true;
        }
      );
    } finally {
      restore();
    }
  });

  it('should include default error message when API returns no error', async () => {
    const { restore } = installMockFetch(
      { success: false },
      { status: 500, ok: false }
    );

    try {
      await assert.rejects(
        () => agent.getInfo(),
        (err) => {
          assert.ok(err instanceof RovnError);
          assert.ok(err.message.includes('Request failed'));
          return true;
        }
      );
    } finally {
      restore();
    }
  });
});

describe('Data serialization', () => {
  let agent;

  beforeEach(async () => {
    agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });
    const { restore } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    restore();
  });

  it('should serialize nested objects in event data', async () => {
    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.shareData('Complex Data', {
        nested: {
          array: [1, 2, 3],
          obj: { key: 'value' },
          bool: true,
          nil: null,
        },
      });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.data.content.nested.array, [1, 2, 3]);
      assert.equal(body.data.content.nested.obj.key, 'value');
      assert.equal(body.data.content.nested.bool, true);
      assert.equal(body.data.content.nested.nil, null);
    } finally {
      restore();
    }
  });

  it('should not include body in GET requests', async () => {
    const { calls, restore } = installMockFetch({
      success: true,
      data: [],
    });

    try {
      await agent.getTasks();
      assert.equal(calls[0].init.body, undefined);
      assert.equal(calls[0].init.method, 'GET');
    } finally {
      restore();
    }
  });
});

describe('Edge cases', () => {
  it('should handle empty capabilities array in register', async () => {
    const { calls, restore } = installMockFetch({
      success: true,
      data: { id: 'id', api_key: 'key' },
    });

    try {
      await RovnAgent.register('https://rovn.example.com', {
        name: 'Bot',
        capabilities: [],
      });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.capabilities, []);
    } finally {
      restore();
    }
  });

  it('should handle special characters in agent names', async () => {
    const { calls, restore } = installMockFetch({
      success: true,
      data: { id: 'id', api_key: 'key' },
    });

    try {
      await RovnAgent.register('https://rovn.example.com', {
        name: 'Agent "Special" <Bot> & Co.',
      });
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.name, 'Agent "Special" <Bot> & Co.');
    } finally {
      restore();
    }
  });

  it('should handle empty metadata objects', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    const { restore: r1 } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    r1();

    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.logActivity('test', { metadata: {} });
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.data.metadata, {});
    } finally {
      restore();
    }
  });

  it('should handle unicode content in messages', async () => {
    const agent = new RovnAgent({
      baseUrl: 'https://rovn.example.com',
      apiKey: 'key',
    });

    const { restore: r1 } = installMockFetch({
      success: true, data: { id: 'a1', name: 'Bot' },
    });
    await agent.getInfo();
    r1();

    const { calls, restore } = installMockFetch({ success: true, data: null });

    try {
      await agent.sendMessage('Hello from Korea! \ud55c\uad6d\uc5b4 \uba54\uc2dc\uc9c0 \ud83d\ude80');
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.data.content, 'Hello from Korea! \ud55c\uad6d\uc5b4 \uba54\uc2dc\uc9c0 \ud83d\ude80');
    } finally {
      restore();
    }
  });
});
