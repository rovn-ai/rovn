# @rovn/mcp-server

MCP (Model Context Protocol) server for [Rovn](https://rovn.io) — AI Agent governance tools for Claude, GPT, Cursor, and any MCP-compatible agent.

## Quick Start

```bash
npx @rovn/mcp-server --url https://rovn.io --email you@example.com
```

Or with an existing API key:

```bash
npx @rovn/mcp-server --url https://rovn.io --api-key rovn_...
```

## Claude Desktop / Claude Code Config

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "rovn": {
      "command": "npx",
      "args": ["@rovn/mcp-server", "--url", "https://rovn.io", "--email", "you@example.com"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `rovn_register` | Register agent with Rovn. Returns API key and agent ID. |
| `rovn_log_activity` | Log what the agent has done. |
| `rovn_check_action` | Pre-flight check — is this action allowed? |
| `rovn_request_approval` | Request owner approval for risky actions. |
| `rovn_get_tasks` | Get tasks assigned to this agent. |
| `rovn_update_task` | Update task status. |
| `rovn_get_report_card` | Get performance report card with grades. |
| `rovn_get_trust_score` | Get Trust Score (0-100). |

## Features

- **Zero dependencies** — uses only Node.js built-in APIs
- **Auto-logging** — governance tool calls are automatically recorded
- **HTTP hardening** — 15s timeout, status-specific error messages, safe JSON parsing
- **Register reuse** — validates existing credentials before re-registering
- **29 tests** — comprehensive test coverage

## CLI Arguments

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--url` | `ROVN_URL` | `https://rovn.io` | Rovn server URL |
| `--email` | `ROVN_OWNER_EMAIL` | — | Owner email for agent registration |
| `--api-key` | `ROVN_API_KEY` | — | Existing API key |
| `--agent-id` | `ROVN_AGENT_ID` | — | Existing agent ID |

## License

MIT
