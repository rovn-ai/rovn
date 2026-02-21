// ==================== Types ====================

export type RovnConfig = {
  baseUrl: string;
  apiKey: string;
  /** When true, sendEvent queues events and returns immediately without awaiting the HTTP call. */
  fireAndForget?: boolean;
};

export type WebhookEvent =
  | 'activity'
  | 'task_update'
  | 'message'
  | 'status'
  | 'share_data'
  | 'command_response'
  | 'approval_request'
  | 'peer_message';

export type SSEEventType =
  | 'connected'
  | 'command'
  | 'approval_response'
  | 'interrupt'
  | 'agent_updated'
  | 'peer_message';

export type SSEHandler = (event: SSEEventType, data: Record<string, unknown>) => void;

export type AgentStatus = 'active' | 'idle' | 'busy' | 'offline' | 'error';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type GuardrailWindow = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type GuardrailAction = 'warn' | 'block' | 'approval_required';

export interface AgentInfo {
  id: string;
  name: string;
  description: string | null;
  status: AgentStatus;
  type: string;
  approved: boolean;
  capabilities: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface Task {
  id: string;
  agent_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  result: Record<string, unknown> | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeerMessage {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
  from_agent_name?: string;
  to_agent_name?: string;
}

export interface Guardrail {
  id: string;
  agent_id: string;
  owner_id: string;
  metric: string;
  limit_value: number;
  current_value: number;
  window: GuardrailWindow;
  action: GuardrailAction;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Constraint {
  id: string;
  agent_id: string;
  task: string;
  constraints: Record<string, unknown>;
  actual_usage: Record<string, unknown> | null;
  compliance: string;
  started_at: string;
  completed_at: string | null;
}

export interface ApprovalRequest {
  id: string;
  agent_id: string;
  type: string;
  title: string;
  status: string;
  urgency: string;
  description: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface TrustScoreResult {
  agent_id: string;
  score: number;
  grade: string;
  breakdown: Record<string, unknown>;
  computed_at: string;
}

export interface CheckResult {
  action: string;
  allowed: boolean;
  needs_approval: boolean;
  would_auto_approve: boolean;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
  summary: string;
}

export interface ReportCard {
  agent: { id: string; name: string };
  period: string;
  productivity: Record<string, unknown>;
  reliability: Record<string, unknown>;
  compliance: Record<string, unknown>;
  trust: Record<string, unknown>;
  recommendations: string[];
}

// ==================== Error ====================

export class RovnError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | undefined;

  constructor(message: string, statusCode: number, errorCode?: string) {
    super(message);
    this.name = 'RovnError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

// ==================== Internal: Event Queue Item ====================

interface QueuedEvent {
  event: WebhookEvent;
  data: Record<string, unknown>;
  retries: number;
}

// ==================== Client ====================

const MAX_QUEUE_SIZE = 10_000;
const MAX_BACKOFF_MS = 30_000;
const GUARDRAIL_CACHE_TTL_MS = 60_000;

export class RovnAgent {
  private baseUrl: string;
  private apiKey: string;
  private agentId: string | null = null;
  private sseController: AbortController | null = null;
  private fireAndForget: boolean;

  // Event queue for fire-and-forget and offline resilience
  private eventQueue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  // Guardrail cache
  private guardrailCache: { data: Guardrail[]; cachedAt: number } | null = null;

  constructor(config: RovnConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.fireAndForget = config.fireAndForget ?? false;
  }

  // ==================== Private Helpers ====================

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /**
   * Throws RovnError if agentId has not been set yet.
   * Call register(), getInfo(), or connect({ agentId }) first.
   */
  private ensureAgentId(): void {
    if (!this.agentId) {
      throw new RovnError(
        'agentId is required. Call register(), getInfo(), or connect({ agentId }) first.',
        0,
        'AGENT_ID_MISSING'
      );
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok && res.headers.get('content-type')?.includes('text/html')) {
      throw new RovnError(`Server error: ${res.status} ${res.statusText}`, res.status);
    }

    const data = await res.json();
    if (!data.success) {
      throw new RovnError(
        data.error || `Request failed: ${method} ${path}`,
        res.status,
        data.code
      );
    }
    return data.data as T;
  }

  /**
   * Returns true if the error looks like a network / transient failure
   * (as opposed to a 4xx client error that retrying won't fix).
   */
  private isRetryable(err: unknown): boolean {
    if (err instanceof RovnError) {
      // Retry on 5xx and 429; don't retry on 4xx client errors
      return err.statusCode >= 500 || err.statusCode === 429;
    }
    // Network errors (TypeError from fetch), AbortError, etc. are retryable
    return true;
  }

  // ==================== Event Queue Internals ====================

  private enqueue(event: WebhookEvent, data: Record<string, unknown>): void {
    if (this.eventQueue.length >= MAX_QUEUE_SIZE) {
      // Drop the oldest event to make room
      this.eventQueue.shift();
    }
    this.eventQueue.push({ event, data, retries: 0 });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.flushing) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.drainQueue();
    }, 0);
  }

  /**
   * Internal drain loop — sends queued events one by one.
   * On failure, re-queues the event at the front with incremented retry count
   * and waits with exponential backoff before trying again.
   */
  private async drainQueue(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      while (this.eventQueue.length > 0) {
        const item = this.eventQueue[0];
        try {
          await this.request('POST', '/api/webhook/agent', { event: item.event, data: item.data });
          // Success — remove from queue
          this.eventQueue.shift();
        } catch (err) {
          if (this.isRetryable(err)) {
            // Exponential backoff: 1s, 2s, 4s, 8s, …, max 30s
            const delayMs = Math.min(1000 * Math.pow(2, item.retries), MAX_BACKOFF_MS);
            item.retries++;
            await new Promise<void>(resolve => setTimeout(resolve, delayMs));
            // The item is still at the front of the queue; loop will retry it
          } else {
            // Non-retryable error — drop the event and move on
            this.eventQueue.shift();
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  // ==================== Registration ====================

  static async register(
    baseUrl: string,
    options: {
      name: string;
      description?: string;
      type?: string;
      capabilities?: string[];
      owner_email?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ agent: RovnAgent; id: string; apiKey: string }> {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!data.success) throw new RovnError(data.error || 'Registration failed', res.status);

    const agent = new RovnAgent({ baseUrl, apiKey: data.data.api_key });
    agent.agentId = data.data.id;
    return { agent, id: data.data.id, apiKey: data.data.api_key };
  }

  // ==================== Agent Info ====================

  async getInfo(): Promise<AgentInfo> {
    if (!this.agentId) {
      const info = await this.request<AgentInfo>('GET', '/api/agents/me');
      this.agentId = info.id;
      return info;
    }
    return this.request<AgentInfo>('GET', `/api/agents/${this.agentId}`);
  }

  // ==================== Webhook (unified event endpoint) ====================

  async sendEvent(event: WebhookEvent, data: Record<string, unknown>): Promise<Record<string, unknown> | void> {
    if (this.fireAndForget) {
      this.enqueue(event, data);
      return;
    }

    try {
      return await this.request<Record<string, unknown>>('POST', '/api/webhook/agent', { event, data });
    } catch (err) {
      if (this.isRetryable(err)) {
        // Queue for retry with backoff
        this.enqueue(event, data);
        return;
      }
      throw err;
    }
  }

  async logActivity(title: string, options?: { type?: string; description?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.sendEvent('activity', { title, ...options });
  }

  async updateTaskStatus(taskId: string, status: string, result?: Record<string, unknown>): Promise<void> {
    await this.sendEvent('task_update', { task_id: taskId, status, result });
  }

  async sendMessage(content: string, options?: { message_type?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.sendEvent('message', { content, ...options });
  }

  async updateStatus(status: AgentStatus): Promise<void> {
    await this.sendEvent('status', { status });
  }

  async shareData(title: string, content: Record<string, unknown>, type?: string): Promise<void> {
    await this.sendEvent('share_data', { title, content, type });
  }

  async respondToCommand(commandId: string, status: string, response?: Record<string, unknown>): Promise<void> {
    await this.sendEvent('command_response', { command_id: commandId, status, response });
  }

  async requestApproval(options: {
    type: string;
    title: string;
    description?: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    metadata?: Record<string, unknown>;
  }): Promise<string | undefined> {
    // Always send synchronously to guarantee approval_id, even in fire-and-forget mode
    const result = await this.request<Record<string, unknown>>(
      'POST', '/api/webhook/agent', { event: 'approval_request', data: options }
    );
    return result?.approval_id as string | undefined;
  }

  async sendPeerMessage(toAgentId: string, content: string, options?: { message_type?: string; metadata?: Record<string, unknown> }): Promise<void> {
    await this.sendEvent('peer_message', { to_agent_id: toAgentId, content, ...options });
  }

  // ==================== Flush ====================

  /**
   * Sends all queued events. Resolves when the queue is drained.
   * Useful before shutdown or when you need to guarantee delivery.
   */
  async flush(): Promise<void> {
    // Cancel any pending scheduled flush
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // If already flushing, wait for it to finish
    if (this.flushing) {
      // Spin-wait until the current drain completes
      while (this.flushing) {
        await new Promise<void>(resolve => setTimeout(resolve, 50));
      }
      // If items were added during the wait, drain again
      if (this.eventQueue.length > 0) {
        await this.drainQueue();
      }
      return;
    }

    if (this.eventQueue.length > 0) {
      await this.drainQueue();
    }
  }

  // ==================== Close ====================

  /**
   * Graceful shutdown: disconnects SSE, flushes pending events.
   */
  async close(): Promise<void> {
    this.disconnect();
    await this.flush();
  }

  // ==================== SSE Stream ====================

  connect(
    handler: SSEHandler,
    options?: { agentId?: string; onConnect?: () => void; onDisconnect?: () => void; reconnect?: boolean }
  ): void {
    const targetId = options?.agentId ?? this.agentId;
    if (targetId) this.agentId = targetId;

    if (!this.agentId) {
      throw new RovnError('agentId is required. Call register() or getInfo() first, or pass agentId in options.', 0);
    }

    const reconnect = options?.reconnect !== false;
    let lastEventId: string | null = null;

    const doConnect = async () => {
      this.sseController = new AbortController();

      try {
        const headers: Record<string, string> = { ...this.headers() };
        if (lastEventId) headers['Last-Event-ID'] = lastEventId;

        const response = await fetch(`${this.baseUrl}/api/agents/${this.agentId}/stream`, {
          headers,
          signal: this.sseController.signal,
        });

        if (!response.ok || !response.body) {
          throw new RovnError(`SSE connection failed: ${response.status}`, response.status);
        }

        options?.onConnect?.();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = '';
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('id: ')) {
              lastEventId = line.slice(4);
            } else if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            } else if (line === '' && eventType && eventData) {
              try {
                const parsed = JSON.parse(eventData);
                handler(eventType as SSEEventType, parsed);
              } catch {
                // ignore parse errors
              }
              eventType = '';
              eventData = '';
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        options?.onDisconnect?.();
        if (reconnect) {
          await new Promise(r => setTimeout(r, 3000));
          doConnect();
        }
      }
    };

    doConnect();
  }

  disconnect(): void {
    this.sseController?.abort();
    this.sseController = null;
  }

  // ==================== Tasks ====================

  async getTasks(options?: { status?: string; limit?: number }): Promise<Task[]> {
    this.ensureAgentId();
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<Task[]>('GET', `/api/agents/${this.agentId}/tasks${qs ? '?' + qs : ''}`);
  }

  // ==================== Peer Messages ====================

  async getPeerMessages(options?: { direction?: 'inbox' | 'outbox' | 'all'; limit?: number }): Promise<PeerMessage[]> {
    this.ensureAgentId();
    const params = new URLSearchParams();
    if (options?.direction) params.set('direction', options.direction);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<PeerMessage[]>('GET', `/api/agents/${this.agentId}/peer${qs ? '?' + qs : ''}`);
  }

  // ==================== Guardrails ====================

  async getGuardrails(): Promise<Guardrail[]> {
    this.ensureAgentId();
    return this.request<Guardrail[]>('GET', `/api/agents/${this.agentId}/guardrails`);
  }

  // ==================== Guardrail Helper ====================

  /**
   * Returns how many units remain before hitting the guardrail limit for the
   * given metric.  Returns `null` if no guardrail matches.
   *
   * Results are cached for 60 seconds to reduce API calls.
   */
  async getGuardrailRemaining(metric: string): Promise<number | null> {
    this.ensureAgentId();

    const now = Date.now();
    if (!this.guardrailCache || now - this.guardrailCache.cachedAt > GUARDRAIL_CACHE_TTL_MS) {
      this.guardrailCache = {
        data: await this.request<Guardrail[]>('GET', `/api/agents/${this.agentId}/guardrails`),
        cachedAt: now,
      };
    }

    const guardrail = this.guardrailCache.data.find(g => g.metric === metric);
    if (!guardrail) return null;
    return guardrail.limit_value - guardrail.current_value;
  }

  /** Clears the cached guardrail data so the next call fetches fresh values. */
  invalidateGuardrailCache(): void {
    this.guardrailCache = null;
  }

  // ==================== Constraints (Self-Constraint Declaration) ====================

  async declareConstraint(task: string, constraints: Record<string, unknown>): Promise<Constraint> {
    this.ensureAgentId();
    return this.request<Constraint>('POST', `/api/agents/${this.agentId}/constraints`, {
      task,
      constraints,
    });
  }

  async updateConstraint(
    constraintId: string,
    actualUsage: Record<string, unknown>,
    completed = false,
  ): Promise<Record<string, unknown>> {
    this.ensureAgentId();
    return this.request<Record<string, unknown>>('PATCH', `/api/agents/${this.agentId}/constraints`, {
      constraint_id: constraintId,
      actual_usage: actualUsage,
      completed,
    });
  }

  async getConstraints(): Promise<Constraint[]> {
    this.ensureAgentId();
    return this.request<Constraint[]>('GET', `/api/agents/${this.agentId}/constraints`);
  }

  // ==================== Trust Score ====================

  async getTrustScore(): Promise<TrustScoreResult> {
    this.ensureAgentId();
    return this.request<TrustScoreResult>('GET', `/api/agents/${this.agentId}/trust-score`);
  }

  // ==================== Approvals (Polling) ====================

  async getApprovals(options?: { status?: string; limit?: number }): Promise<ApprovalRequest[]> {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    const data = await this.request<{ approvals: ApprovalRequest[] }>('GET', `/api/approvals${qs ? '?' + qs : ''}`);
    return (data as unknown as { approvals: ApprovalRequest[] }).approvals ?? (data as unknown as ApprovalRequest[]);
  }

  async pollApproval(approvalId: string): Promise<ApprovalRequest> {
    return this.request<ApprovalRequest>('GET', `/api/approvals/${approvalId}`);
  }

  // ==================== Pre-flight Check ("Can I Do This?") ====================

  async checkAction(
    action: string,
    options?: { urgency?: string; cost?: number; data_fields?: string[] }
  ): Promise<CheckResult> {
    this.ensureAgentId();
    const params = new URLSearchParams({ action });
    if (options?.urgency) params.set('urgency', options.urgency);
    if (options?.cost !== undefined) params.set('cost', String(options.cost));
    if (options?.data_fields) params.set('data_fields', options.data_fields.join(','));
    return this.request<CheckResult>('GET', `/api/agents/${this.agentId}/check?${params}`);
  }

  // ==================== Report Card ====================

  async getReportCard(options?: { days?: number }): Promise<ReportCard> {
    this.ensureAgentId();
    const params = new URLSearchParams();
    if (options?.days) params.set('days', String(options.days));
    const qs = params.toString();
    return this.request<ReportCard>('GET', `/api/agents/${this.agentId}/report-card${qs ? '?' + qs : ''}`);
  }
}

// ==================== LangChain-style Tool Wrapper ====================

/**
 * Wraps any function with Rovn governance: pre-flight policy check + activity reporting.
 *
 * @example
 * ```ts
 * import { RovnAgent, createGovernedTool } from 'rovn-sdk';
 *
 * const agent = new RovnAgent({ baseUrl: '...', apiKey: '...' });
 * await agent.getInfo();
 *
 * const search = createGovernedTool(agent, {
 *   name: 'search',
 *   actionName: 'db_read',
 *   fn: async (query: string) => `Results for ${query}`,
 * });
 *
 * const result = await search('my query');
 * ```
 */
export function createGovernedTool<TArgs extends unknown[], TResult>(
  agent: RovnAgent,
  options: {
    name: string;
    actionName?: string;
    fn: (...args: TArgs) => TResult | Promise<TResult>;
  },
): (...args: TArgs) => Promise<TResult> {
  const actionName = options.actionName ?? options.name;

  return async (...args: TArgs): Promise<TResult> => {
    // Pre-flight check
    try {
      const check = await agent.checkAction(actionName);
      if (!check.allowed) {
        await agent.logActivity(`Blocked: ${actionName}`, {
          type: 'policy_block',
          description: check.summary,
        });
        throw new RovnError(
          `Action '${actionName}' blocked by policy: ${check.summary}`,
          403,
          'POLICY_BLOCKED',
        );
      }
    } catch (err) {
      if (err instanceof RovnError) throw err;
      // If check fails (network, etc.), allow execution but continue
    }

    // Execute
    try {
      const result = await options.fn(...args);
      await agent.logActivity(`Executed: ${actionName}`, {
        type: 'tool_execution',
        description: `Tool '${options.name}' completed successfully`,
      });
      return result;
    } catch (err) {
      if (err instanceof RovnError) throw err;
      await agent.logActivity(`Failed: ${actionName}`, {
        type: 'tool_error',
        description: `Tool '${options.name}' failed: ${err}`,
      });
      throw err;
    }
  };
}

// ==================== Vercel AI SDK Middleware ====================

/**
 * Creates a middleware-style wrapper for Vercel AI SDK that reports
 * each generation to Rovn and checks policies.
 *
 * @example
 * ```ts
 * import { RovnAgent, createVercelAIMiddleware } from 'rovn-sdk';
 *
 * const agent = new RovnAgent({ baseUrl: '...', apiKey: '...' });
 * await agent.getInfo();
 *
 * const middleware = createVercelAIMiddleware(agent);
 *
 * // Wrap your doGenerate or doStream calls:
 * const result = await middleware.wrapGenerate(async () => {
 *   return await model.doGenerate({ prompt: '...' });
 * });
 * ```
 */
export function createVercelAIMiddleware(agent: RovnAgent, options?: {
  actionName?: string;
}) {
  const actionName = options?.actionName ?? 'ai_generate';

  return {
    /**
     * Wraps a doGenerate call with policy check + activity reporting.
     */
    async wrapGenerate<T>(fn: () => Promise<T>): Promise<T> {
      // Pre-flight check
      try {
        const check = await agent.checkAction(actionName);
        if (!check.allowed) {
          await agent.logActivity(`Blocked: ${actionName}`, {
            type: 'policy_block',
            description: check.summary,
          });
          throw new RovnError(
            `Action '${actionName}' blocked by policy: ${check.summary}`,
            403,
            'POLICY_BLOCKED',
          );
        }
      } catch (err) {
        if (err instanceof RovnError) throw err;
      }

      const start = Date.now();
      try {
        const result = await fn();
        const duration = Date.now() - start;
        await agent.logActivity(`AI Generate completed`, {
          type: 'ai_generate',
          description: `Generation took ${duration}ms`,
          metadata: { duration_ms: duration } as Record<string, unknown>,
        });
        return result;
      } catch (err) {
        if (err instanceof RovnError) throw err;
        const duration = Date.now() - start;
        await agent.logActivity(`AI Generate failed`, {
          type: 'ai_error',
          description: `Generation failed after ${duration}ms: ${err}`,
        });
        throw err;
      }
    },

    /**
     * Wraps a doStream call with policy check + activity reporting.
     */
    async wrapStream<T>(fn: () => Promise<T>): Promise<T> {
      try {
        const check = await agent.checkAction(actionName);
        if (!check.allowed) {
          await agent.logActivity(`Blocked: ${actionName} (stream)`, {
            type: 'policy_block',
            description: check.summary,
          });
          throw new RovnError(
            `Action '${actionName}' blocked by policy: ${check.summary}`,
            403,
            'POLICY_BLOCKED',
          );
        }
      } catch (err) {
        if (err instanceof RovnError) throw err;
      }

      try {
        const result = await fn();
        await agent.logActivity(`AI Stream started`, { type: 'ai_stream' });
        return result;
      } catch (err) {
        if (err instanceof RovnError) throw err;
        await agent.logActivity(`AI Stream failed`, {
          type: 'ai_error',
          description: `Stream failed: ${err}`,
        });
        throw err;
      }
    },
  };
}

export default RovnAgent;
