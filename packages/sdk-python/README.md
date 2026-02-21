# rovn-sdk

**AI Agent Governance SDK** -- manage, monitor, and govern your AI agents.

The official Python SDK for [Rovn](https://github.com/rovn-agent/rovn), the AI Agent Command Center. Zero external dependencies -- uses only Python stdlib (`urllib`, `json`, `threading`).

## Installation

```bash
pip install rovn-sdk
```

Requires **Python 3.10+**. No external dependencies.

## Quick Start (5 minutes)

```python
from rovn_sdk import RovnAgent, RovnError

# 1. Register your agent
agent, agent_id, api_key = RovnAgent.register(
    "https://your-rovn-instance.com",
    name="my-data-pipeline",
    description="Processes and analyzes customer data",
    type="data_pipeline",
    capabilities=["read_database", "write_reports", "send_email"],
)
# Save api_key -- you will need it to reconnect later

# 2. Send an activity
agent.log_activity(
    "Processed 1,200 records",
    type="data_processing",
    metadata={"records": 1200, "duration_ms": 4500},
)

# 3. Check if an action is allowed (pre-flight)
check = agent.check_action("send_email", urgency="high", cost=0.05)
if check.allowed:
    print("Go ahead!")
elif check.needs_approval:
    # 4. Request approval from the owner
    approval_id = agent.request_approval(
        type="action",
        title="Send 500 marketing emails",
        description="Campaign targeting new signups from last week",
        urgency="high",
    )
    print(f"Waiting for approval: {approval_id}")

# 5. Get your report card
report = agent.get_report_card(days=7)
print(f"Trust grade: {report.trust}")
print(f"Recommendations: {report.recommendations}")
```

## All Available Methods

### Registration & Info

```python
# Register a new agent (class method, no API key needed)
agent, agent_id, api_key = RovnAgent.register(
    base_url,
    *,
    name: str,
    description: str | None = None,
    type: str | None = None,
    capabilities: list[str] | None = None,
    owner_email: str | None = None,
    metadata: dict | None = None,
    fire_and_forget: bool = False,
)

# Connect with an existing API key
agent = RovnAgent(base_url="https://...", api_key="rovn_...")

# Get agent info (auto-discovers agent_id on first call)
info: AgentInfo = agent.get_info()
# info.id, info.name, info.description, info.status, info.type,
# info.approved, info.capabilities, info.metadata, info.created_at,
# info.updated_at, info.last_seen_at
```

### Events & Activities

```python
# Log an activity
agent.log_activity(
    title: str,
    *,
    type: str | None = None,
    description: str | None = None,
    metadata: dict | None = None,
)

# Update agent status
agent.update_status(status)  # "active" | "idle" | "busy" | "offline" | "error"

# Share structured data with the owner
agent.share_data(title: str, content: dict, type: str | None = None)

# Send a raw event (low-level)
agent.send_event(event: WebhookEvent, data: dict) -> dict | None
```

### Tasks

```python
# Get assigned tasks
tasks: list[Task] = agent.get_tasks(*, status: str | None = None, limit: int | None = None)
# Each task has: id, agent_id, owner_id, title, description, status,
# priority, result, scheduled_at, started_at, completed_at

# Update a task's status
agent.update_task_status(task_id: str, status: str, result: dict | None = None)
```

### Messages & Chat

```python
# Send a message to the owner
agent.send_message(
    content: str,
    *,
    message_type: str | None = None,
    metadata: dict | None = None,
)

# Respond to an owner command
agent.respond_to_command(command_id: str, status: str, response: dict | None = None)

# Send a message to another agent
agent.send_peer_message(
    to_agent_id: str,
    content: str,
    *,
    message_type: str | None = None,
    metadata: dict | None = None,
)

# Get peer messages
messages: list[PeerMessage] = agent.get_peer_messages(
    *, direction: "inbox" | "outbox" | "all" | None = None, limit: int | None = None
)
```

### Approvals

```python
# Request approval from the owner (always synchronous, returns approval_id)
approval_id: str | None = agent.request_approval(
    *,
    type: str,
    title: str,
    description: str | None = None,
    urgency: "low" | "medium" | "high" | "critical" | None = None,
    metadata: dict | None = None,
)

# Poll all approvals
approvals: list[ApprovalRequest] = agent.get_approvals(
    *, status: str | None = None, limit: int | None = None
)

# Poll a specific approval by ID
approval: ApprovalRequest = agent.poll_approval(approval_id: str)
# approval.id, approval.status, approval.decided_at, approval.decision_note
```

### Guardrails & Constraints

```python
# Get all guardrails set by the owner
guardrails: list[Guardrail] = agent.get_guardrails()
# Each guardrail: id, metric, limit_value, current_value, window, action, enabled

# Check remaining budget for a specific metric (cached for 60s)
remaining: int | None = agent.get_guardrail_remaining(metric: str)

# Declare self-constraints before starting a task
constraint: Constraint = agent.declare_constraint(
    task: str,
    constraints: dict,  # e.g. {"max_api_calls": 100, "max_cost_usd": 5.0}
)

# Update actual usage against a declared constraint
result: dict = agent.update_constraint(
    constraint_id: str,
    actual_usage: dict,  # e.g. {"api_calls": 45, "cost_usd": 2.10}
    *, completed: bool = False,
)

# Get all constraints for this agent
constraints: list[Constraint] = agent.get_constraints()
```

### Trust Score

```python
trust: TrustScore = agent.get_trust_score()
# trust.score (0-100), trust.grade ("A" through "F"), trust.breakdown, trust.computed_at
```

### Pre-flight Check

```python
# "Can I do this?" -- checks policies, guardrails, and earned autonomy
check: CheckResult = agent.check_action(
    action: str,
    *,
    urgency: str | None = None,
    cost: float | None = None,
    data_fields: list[str] | None = None,
)
# check.allowed        -- True if the action can proceed
# check.needs_approval -- True if the action requires owner approval
# check.would_auto_approve -- True if earned autonomy would auto-approve
# check.checks         -- list of individual check results
# check.summary        -- human-readable summary
```

### Report Card

```python
report: ReportCard = agent.get_report_card(*, days: int | None = None)
# report.agent          -- agent info dict
# report.period         -- time period string
# report.productivity   -- productivity metrics
# report.reliability    -- reliability metrics
# report.compliance     -- compliance metrics
# report.trust          -- trust metrics
# report.recommendations -- list of improvement suggestions
```

### SSE Connection (Real-Time)

```python
def handler(event: str, data: dict):
    # event is one of: "connected", "command", "approval_response",
    #                   "interrupt", "agent_updated", "peer_message"
    if event == "command":
        print("Owner command:", data)
    elif event == "approval_response":
        print(f"Approval {data['id']}: {data['status']}")
    elif event == "interrupt":
        agent.disconnect()

agent.connect(
    handler,
    *,
    agent_id: str | None = None,    # override auto-discovered ID
    on_connect: Callable | None = None,
    on_disconnect: Callable | None = None,
    reconnect: bool = True,          # auto-reconnect on disconnect
)

# Stop listening
agent.disconnect()
```

## Advanced Features

### Fire-and-Forget Mode

Events are queued in memory and sent by a background daemon thread. Your code never blocks on HTTP calls. Use the context manager to ensure graceful shutdown.

```python
with RovnAgent(base_url="https://...", api_key="rovn_...", fire_and_forget=True) as agent:
    agent.log_activity("Instant return, sent in background")
    agent.send_message("Also queued")
    agent.update_status("busy")
# close() is called automatically here, flushing all remaining events

# Or manage the lifecycle manually:
agent = RovnAgent(base_url="...", api_key="...", fire_and_forget=True)
agent.log_activity("queued")
agent.flush()   # block until all queued events are sent
agent.close()   # flush + stop background worker + disconnect SSE
```

Note: `request_approval()` is always synchronous, even in fire-and-forget mode, so you always receive the `approval_id`.

### Batch Mode

Buffer multiple events and send them all when the batch context exits.

```python
with agent.batch():
    agent.log_activity("Step 1 complete")
    agent.log_activity("Step 2 complete")
    agent.send_message("Both steps done")
# All three events are sent here
```

### Error Handling

All API errors raise `RovnError` with structured information.

```python
from rovn_sdk import RovnError

try:
    agent.log_activity("test")
except RovnError as e:
    print(e)                # human-readable message
    print(e.status_code)    # HTTP status code (0 for network errors)
    print(e.error_code)     # server error code (e.g. "rate_limited")
```

Common error scenarios:
- **`status_code=0`** -- Network error (connection refused, DNS failure)
- **`status_code=401`** -- Invalid or expired API key
- **`status_code=429`** -- Rate limited (auto-retried in fire-and-forget mode)
- **`status_code=5xx`** -- Server error (auto-retried in fire-and-forget mode)
- **`error_code="missing_agent_id"`** -- Call `get_info()` or `register()` first

### Retry Behavior

In fire-and-forget mode, the background worker automatically retries on:
- Network errors (connection refused, timeout)
- HTTP 429 (rate limit)
- HTTP 5xx (server errors)

Retry uses exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s max. Non-retryable errors (4xx except 429) cause the event to be dropped.

The event queue holds up to 10,000 events. When full, new events are dropped silently.

### Guardrail Cache

`get_guardrail_remaining()` caches the guardrail list for 60 seconds to avoid excessive API calls. The cache is automatically refreshed when stale.

```python
# First call fetches from API
remaining = agent.get_guardrail_remaining("api_calls")  # -> 950

# Subsequent calls within 60s use the cache
remaining = agent.get_guardrail_remaining("api_calls")  # -> 950 (cached)

# Force a fresh fetch
agent.get_guardrails()  # updates the cache
remaining = agent.get_guardrail_remaining("api_calls")  # -> 947 (fresh)
```

## Complete Workflow Example

```python
from rovn_sdk import RovnAgent, RovnError

ROVN_URL = "https://your-rovn-instance.com"
API_KEY = "rovn_abc123..."

def main():
    # Connect to Rovn
    agent = RovnAgent(base_url=ROVN_URL, api_key=API_KEY)
    info = agent.get_info()
    print(f"Agent: {info.name} (trust: {info.status})")

    # Check trust score
    trust = agent.get_trust_score()
    print(f"Trust: {trust.grade} ({trust.score}/100)")

    # Check if we're allowed to send emails
    check = agent.check_action("send_email", cost=2.50)

    if not check.allowed:
        if check.needs_approval:
            # Request approval and wait
            approval_id = agent.request_approval(
                type="action",
                title="Send weekly report emails",
                description="150 emails to subscribers, estimated cost $2.50",
                urgency="medium",
            )
            print(f"Approval requested: {approval_id}")

            # Poll until decided
            while True:
                approval = agent.poll_approval(approval_id)
                if approval.status != "pending":
                    break
                import time; time.sleep(5)

            if approval.status != "approved":
                print(f"Denied: {approval.decision_note}")
                return
        else:
            print(f"Blocked: {check.summary}")
            return

    # Declare constraints for the task
    constraint = agent.declare_constraint(
        task="send_weekly_emails",
        constraints={"max_emails": 200, "max_cost_usd": 5.0},
    )

    # Do the work
    agent.update_status("busy")
    agent.log_activity("Sending weekly report emails", type="email_campaign")

    emails_sent = 150
    cost = 2.35

    # Report actual usage
    agent.update_constraint(
        constraint.id,
        actual_usage={"emails": emails_sent, "cost_usd": cost},
        completed=True,
    )

    # Notify owner
    agent.send_message(
        f"Weekly emails sent: {emails_sent} emails, ${cost:.2f}",
        metadata={"emails_sent": emails_sent, "cost_usd": cost},
    )

    agent.update_status("idle")

    # Check report card
    report = agent.get_report_card(days=7)
    print(f"Recommendations: {report.recommendations}")

if __name__ == "__main__":
    main()
```

## Exported Types

All types are dataclasses importable from `rovn_sdk`:

```python
from rovn_sdk import (
    RovnAgent,         # Client class
    RovnError,         # Exception class
    AgentInfo,         # Agent profile
    Task,              # Assigned task
    PeerMessage,       # Inter-agent message
    Guardrail,         # Usage limit
    Constraint,        # Self-constraint declaration
    ApprovalRequest,   # Approval request/response
    TrustScore,        # Trust score result
    CheckResult,       # Pre-flight check result
    ReportCard,        # Performance report card
)
```

## Requirements

- Python 3.10+
- No external dependencies (stdlib only)

## License

MIT
