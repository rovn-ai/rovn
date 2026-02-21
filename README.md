<p align="center">
  <img src="https://rovn.io/r-logo-site.svg" width="60" alt="Rovn" />
</p>

<h1 align="center">Rovn</h1>

<p align="center">
  <strong>Governance toolkit for AI Agents</strong><br/>
  SDK &middot; CLI &middot; MCP Server
</p>

<p align="center">
  <a href="https://rovn.io">Website</a> &middot;
  <a href="https://rovn.io/docs">Docs</a> &middot;
  <a href="https://github.com/rovn-ai/rovn/issues">Issues</a>
</p>

---

## What is Rovn?

Rovn is a governance platform for AI agents. It lets agent owners **monitor, control, and trust** their AI agents through a single dashboard.

Agents use these open-source tools to register, report activities, check policies, and request approvals — all through a simple API.

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`sdk-python`](./packages/sdk-python) | Python SDK (zero dependencies) | `pip install rovn-sdk` |
| [`sdk-ts`](./packages/sdk-ts) | TypeScript/JavaScript SDK (zero dependencies) | `npm install @rovn/sdk` |
| [`mcp-server`](./packages/mcp-server) | MCP Server for Claude, Cursor, GPT, etc. | `npx @rovn/mcp-server` |
| [`cli`](./packages/cli) | CLI for agents & developers | `npm install -g @rovn/cli` |

## Quick Start

### Python SDK

```python
from rovn import RovnClient

client = RovnClient()
agent = client.register(name="My Agent", owner_email="me@example.com")

# Log activities
client.log_activity(title="Deployed v2.1", type="deployment")

# Pre-flight check
result = client.check_action(action="send_email", urgency="high")
if result["decision"] == "approved":
    send_email()
```

### TypeScript SDK

```typescript
import { RovnClient } from '@rovn/sdk';

const client = new RovnClient();
const agent = await client.register({ name: 'My Agent', ownerEmail: 'me@example.com' });

// Log activities
await client.logActivity({ title: 'Deployed v2.1', type: 'deployment' });

// Pre-flight check
const result = await client.checkAction({ action: 'send_email', urgency: 'high' });
if (result.decision === 'approved') {
  await sendEmail();
}
```

### MCP Server (Claude, Cursor, etc.)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "rovn": {
      "command": "npx",
      "args": ["@rovn/mcp-server", "--email", "me@example.com"]
    }
  }
}
```

The agent can then use governance tools like `rovn_register`, `rovn_log_activity`, `rovn_check_action`, and more — directly from the AI.

## Features

- **Agent Registration** — Self-service agent onboarding via API
- **Activity Logging** — Track what your agents are doing
- **Pre-flight Checks** — "Can I do this?" before risky actions
- **Approval Requests** — Human-in-the-loop for important decisions
- **Trust Score** — Earned Autonomy: more trust = more freedom
- **Report Cards** — Performance grades and recommendations
- **Policy Engine** — Visual policy builder (Pro)
- **Compliance Passports** — Exportable compliance snapshots (Pro)

## Links

- [Rovn Dashboard](https://rovn.io) — Sign in and manage your agents
- [Documentation](https://rovn.io/docs) — Full API reference and guides
- [Python SDK README](./packages/sdk-python/README.md)
- [TypeScript SDK README](./packages/sdk-ts/README.md)
- [MCP Server README](./packages/mcp-server/README.md)

## License

MIT — see [LICENSE](./LICENSE) for details.
