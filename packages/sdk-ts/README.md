# @rovn-platform/sdk

**AI Agent Governance SDK** -- manage, monitor, and govern your AI agents.

The official TypeScript/JavaScript SDK for [Rovn](https://rovn.io), the AI Agent Command Center. Zero runtime dependencies -- uses only the Fetch API.

## Installation

```bash
npm install @rovn-platform/sdk
```

Works with Node.js 18+ (Fetch API required), Deno, Bun, and modern browsers.

## Quick Start (5 minutes)

```typescript
import { RovnAgent, RovnError } from '@rovn-platform/sdk';

// 1. Register your agent
const { agent, id, apiKey } = await RovnAgent.register(
  'https://your-rovn-instance.com',
  {
    name: 'my-data-pipeline',
    description: 'Processes and analyzes customer data',
    type: 'data_pipeline',
    capabilities: ['read_database', 'write_reports', 'send_email'],
  }
);
// Save apiKey -- you will need it to reconnect later

// 2. Send an activity
await agent.logActivity('Processed 1,200 records', {
  type: 'data_processing',
  metadata: { records: 1200, duration_ms: 4500 },
});

// 3. Check if an action is allowed (pre-flight)
const check = await agent.checkAction('send_email', {
  urgency: 'high',
  cost: 0.05,
});

if (check.allowed) {
  console.log('Go ahead!');
} else if (check.needs_approval) {
  // 4. Request approval from the owner
  const approvalId = await agent.requestApproval({
    type: 'action',
    title: 'Send 500 marketing emails',
    description: 'Campaign targeting new signups from last week',
    urgency: 'high',
  });
  console.log(`Waiting for approval: ${approvalId}`);
}

// 5. Get your report card
const report = await agent.getReportCard({ days: 7 });
console.log('Trust:', report.trust);
console.log('Recommendations:', report.recommendations);
```

## All Available Methods

### Registration & Info

```typescript
// Register a new agent (static method, no API key needed)
const { agent, id, apiKey } = await RovnAgent.register(
  baseUrl: string,
  options: {
    name: string;
    description?: string;
    type?: string;
    capabilities?: string[];
    owner_email?: string;
    metadata?: Record<string, unknown>;
  }
);

// Connect with an existing API key
const agent = new RovnAgent({
  baseUrl: 'https://...',
  apiKey: 'rovn_...',
  fireAndForget: false,  // optional, default false
});

// Get agent info (auto-discovers agentId on first call)
const info: AgentInfo = await agent.getInfo();
// info.id, info.name, info.description, info.status, info.type,
// info.approved, info.capabilities, info.metadata, info.created_at,
// info.updated_at, info.last_seen_at
```

### Events & Activities

```typescript
// Log an activity
await agent.logActivity(
  title: string,
  options?: { type?: string; description?: string; metadata?: Record<string, unknown> }
);

// Update agent status
await agent.updateStatus(status);  // 'active' | 'idle' | 'busy' | 'offline' | 'error'

// Share structured data with the owner
await agent.shareData(title: string, content: Record<string, unknown>, type?: string);

// Send a raw event (low-level)
await agent.sendEvent(event: WebhookEvent, data: Record<string, unknown>);
```

### Tasks

```typescript
// Get assigned tasks
const tasks: Task[] = await agent.getTasks({ status?: string, limit?: number });
// Each task has: id, agent_id, owner_id, title, description, status,
// priority, result, scheduled_at, started_at, completed_at

// Update a task's status
await agent.updateTaskStatus(taskId: string, status: string, result?: Record<string, unknown>);
```

### Messages & Chat

```typescript
// Send a message to the owner
await agent.sendMessage(
  content: string,
  options?: { message_type?: string; metadata?: Record<string, unknown> }
);

// Respond to an owner command
await agent.respondToCommand(
  commandId: string, status: string, response?: Record<string, unknown>
);

// Send a message to another agent
await agent.sendPeerMessage(
  toAgentId: string,
  content: string,
  options?: { message_type?: string; metadata?: Record<string, unknown> }
);

// Get peer messages
const messages: PeerMessage[] = await agent.getPeerMessages({
  direction?: 'inbox' | 'outbox' | 'all',
  limit?: number,
});
```

### Approvals

```typescript
// Request approval from the owner
const approvalId: string | undefined = await agent.requestApproval({
  type: string,
  title: string,
  description?: string,
  urgency?: 'low' | 'medium' | 'high' | 'critical',
  metadata?: Record<string, unknown>,
});

// Poll all approvals
const approvals: ApprovalRequest[] = await agent.getApprovals({
  status?: string,
  limit?: number,
});

// Poll a specific approval by ID
const approval: ApprovalRequest = await agent.pollApproval(approvalId: string);
// approval.id, approval.status, approval.decided_at, approval.decision_note
```

### Guardrails & Constraints

```typescript
// Get all guardrails set by the owner
const guardrails: Guardrail[] = await agent.getGuardrails();
// Each guardrail: id, metric, limit_value, current_value, window, action, enabled

// Check remaining budget for a specific metric (cached for 60s)
const remaining: number | null = await agent.getGuardrailRemaining(metric: string);

// Clear the guardrail cache to force a fresh fetch
agent.invalidateGuardrailCache();

// Declare self-constraints before starting a task
const constraint: Constraint = await agent.declareConstraint(
  task: string,
  constraints: Record<string, unknown>,  // e.g. { max_api_calls: 100, max_cost_usd: 5.0 }
);

// Update actual usage against a declared constraint
const result = await agent.updateConstraint(
  constraintId: string,
  actualUsage: Record<string, unknown>,  // e.g. { api_calls: 45, cost_usd: 2.10 }
  completed: boolean = false,
);

// Get all constraints for this agent
const constraints: Constraint[] = await agent.getConstraints();
```

### Trust Score

```typescript
const trust: TrustScoreResult = await agent.getTrustScore();
// trust.score (0-100), trust.grade ('A' through 'F'), trust.breakdown, trust.computed_at
```

### Pre-flight Check

```typescript
// "Can I do this?" -- checks policies, guardrails, and earned autonomy
const check: CheckResult = await agent.checkAction(
  action: string,
  options?: {
    urgency?: string;
    cost?: number;
    data_fields?: string[];
  }
);
// check.allowed        -- true if the action can proceed
// check.needs_approval -- true if the action requires owner approval
// check.would_auto_approve -- true if earned autonomy would auto-approve
// check.checks         -- array of individual check results
// check.summary        -- human-readable summary
```

### Report Card

```typescript
const report: ReportCard = await agent.getReportCard({ days?: number });
// report.agent          -- { id, name }
// report.period         -- time period string
// report.productivity   -- productivity metrics
// report.reliability    -- reliability metrics
// report.compliance     -- compliance metrics
// report.trust          -- trust metrics
// report.recommendations -- array of improvement suggestions
```

### SSE Connection (Real-Time)

```typescript
agent.connect(
  handler: (event: SSEEventType, data: Record<string, unknown>) => void,
  options?: {
    agentId?: string;      // override auto-discovered ID
    onConnect?: () => void;
    onDisconnect?: () => void;
    reconnect?: boolean;   // default true, auto-reconnect on disconnect
  }
);

// Example handler
agent.connect((event, data) => {
  // event is one of: 'connected', 'command', 'approval_response',
  //                   'interrupt', 'agent_updated', 'peer_message'
  switch (event) {
    case 'command':
      console.log('Owner command:', data);
      break;
    case 'approval_response':
      console.log(`Approval ${data.id}: ${data.status}`);
      break;
    case 'interrupt':
      agent.disconnect();
      break;
  }
});

// Stop listening
agent.disconnect();
```

### Flush & Close

```typescript
// Flush all queued events (blocks until drained)
await agent.flush();

// Graceful shutdown: disconnect SSE + flush pending events
await agent.close();
```

## Advanced Features

### Fire-and-Forget Mode

Events are queued in memory and sent asynchronously with automatic retry. Your code never awaits HTTP calls for event delivery.

```typescript
const agent = new RovnAgent({
  baseUrl: 'https://...',
  apiKey: 'rovn_...',
  fireAndForget: true,
});

await agent.logActivity('Instant return, sent in background');
await agent.sendMessage('Also queued');
await agent.updateStatus('busy');

// Flush before shutdown to guarantee delivery
await agent.flush();

// Or use close() for full graceful shutdown
await agent.close();
```

Even in synchronous mode, transient failures (5xx, network errors) are automatically queued for retry instead of throwing.

### Error Handling

All API errors throw `RovnError` with structured information.

```typescript
import { RovnError } from '@rovn-platform/sdk';

try {
  await agent.logActivity('test');
} catch (err) {
  if (err instanceof RovnError) {
    console.error(err.message);     // human-readable message
    console.error(err.statusCode);  // HTTP status code (0 for network errors)
    console.error(err.errorCode);   // server error code (e.g. 'rate_limited')
  }
}
```

Common error scenarios:
- **`statusCode === 0`** -- Network error (connection refused, DNS failure)
- **`statusCode === 401`** -- Invalid or expired API key
- **`statusCode === 429`** -- Rate limited (auto-retried)
- **`statusCode >= 500`** -- Server error (auto-retried)
- **`errorCode === 'AGENT_ID_MISSING'`** -- Call `getInfo()` or `register()` first

### Retry Behavior

The SDK automatically retries on:
- Network errors (fetch failures, connection reset)
- HTTP 429 (rate limit)
- HTTP 5xx (server errors)

Retry uses exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s max. Non-retryable errors (4xx except 429) cause the event to be dropped from the queue.

In fire-and-forget mode, failed events stay at the front of the queue and are retried with backoff. In synchronous mode, retryable failures are automatically queued for background retry instead of throwing.

The event queue holds up to 10,000 events. When full, the oldest event is dropped to make room.

### Guardrail Cache

`getGuardrailRemaining()` caches the guardrail list for 60 seconds to avoid excessive API calls. The cache is automatically refreshed when stale.

```typescript
// First call fetches from API
const remaining = await agent.getGuardrailRemaining('api_calls'); // -> 950

// Subsequent calls within 60s use the cache
const remaining2 = await agent.getGuardrailRemaining('api_calls'); // -> 950 (cached)

// Force a fresh fetch
agent.invalidateGuardrailCache();
const remaining3 = await agent.getGuardrailRemaining('api_calls'); // -> 947 (fresh)
```

## Complete Workflow Example

```typescript
import { RovnAgent, RovnError } from '@rovn-platform/sdk';

const ROVN_URL = 'https://your-rovn-instance.com';
const API_KEY = 'rovn_abc123...';

async function main() {
  // Connect to Rovn
  const agent = new RovnAgent({ baseUrl: ROVN_URL, apiKey: API_KEY });
  const info = await agent.getInfo();
  console.log(`Agent: ${info.name} (status: ${info.status})`);

  // Check trust score
  const trust = await agent.getTrustScore();
  console.log(`Trust: ${trust.grade} (${trust.score}/100)`);

  // Check if we're allowed to send emails
  const check = await agent.checkAction('send_email', { cost: 2.5 });

  if (!check.allowed) {
    if (check.needs_approval) {
      // Request approval and wait
      const approvalId = await agent.requestApproval({
        type: 'action',
        title: 'Send weekly report emails',
        description: '150 emails to subscribers, estimated cost $2.50',
        urgency: 'medium',
      });
      console.log(`Approval requested: ${approvalId}`);

      // Poll until decided
      let approval;
      do {
        await new Promise(r => setTimeout(r, 5000));
        approval = await agent.pollApproval(approvalId!);
      } while (approval.status === 'pending');

      if (approval.status !== 'approved') {
        console.log(`Denied: ${approval.decision_note}`);
        return;
      }
    } else {
      console.log(`Blocked: ${check.summary}`);
      return;
    }
  }

  // Declare constraints for the task
  const constraint = await agent.declareConstraint(
    'send_weekly_emails',
    { max_emails: 200, max_cost_usd: 5.0 },
  );

  // Do the work
  await agent.updateStatus('busy');
  await agent.logActivity('Sending weekly report emails', { type: 'email_campaign' });

  const emailsSent = 150;
  const cost = 2.35;

  // Report actual usage
  await agent.updateConstraint(
    constraint.id,
    { emails: emailsSent, cost_usd: cost },
    true, // completed
  );

  // Notify owner
  await agent.sendMessage(
    `Weekly emails sent: ${emailsSent} emails, $${cost.toFixed(2)}`,
    { metadata: { emails_sent: emailsSent, cost_usd: cost } },
  );

  await agent.updateStatus('idle');

  // Check report card
  const report = await agent.getReportCard({ days: 7 });
  console.log('Recommendations:', report.recommendations);

  // Graceful shutdown
  await agent.close();
}

main().catch(console.error);
```

## Exported Types

All types are importable from the package:

```typescript
import {
  RovnAgent,         // Client class
  RovnError,         // Error class
  type RovnConfig,   // Constructor config
  type AgentInfo,    // Agent profile
  type Task,         // Assigned task
  type PeerMessage,  // Inter-agent message
  type Guardrail,    // Usage limit
  type Constraint,   // Self-constraint declaration
  type ApprovalRequest,   // Approval request/response
  type TrustScoreResult,  // Trust score result
  type CheckResult,       // Pre-flight check result
  type ReportCard,        // Performance report card
  type AgentStatus,       // 'active' | 'idle' | 'busy' | 'offline' | 'error'
  type TaskStatus,        // 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed'
  type TaskPriority,      // 'low' | 'medium' | 'high' | 'urgent'
  type WebhookEvent,      // Event type union
  type SSEEventType,      // SSE event type union
  type SSEHandler,        // SSE handler function type
  type GuardrailWindow,   // 'hourly' | 'daily' | 'weekly' | 'monthly'
  type GuardrailAction,   // 'warn' | 'block' | 'approval_required'
} from '@rovn-platform/sdk';
```

## Requirements

- Node.js 18+ (Fetch API), Deno, Bun, or modern browsers
- TypeScript 5+ (for type definitions)
- Zero runtime dependencies

## License

MIT
