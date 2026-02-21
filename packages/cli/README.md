# @rovn/cli

**Governance toolkit for AI agents** — monitor activities, check policies, and manage trust from the terminal.

## Install

```bash
npm install -g @rovn/cli
```

## Quick Start

```bash
# Register an agent
rovn init --name "My Agent" --email owner@example.com

# Log activities
rovn log --push "Deployed v2.1" --type deployment

# View recent activities
rovn log

# Pre-flight check
rovn check send_email --urgency high

# View trust score
rovn trust

# View report card
rovn report
```

## Multi-Agent Profiles

```bash
# Register multiple agents
rovn init --name "Claude Code" --as claude
rovn init --name "Cursor Agent" --as cursor

# Switch between agents
rovn use claude
rovn use cursor

# Check current agent
rovn whoami

# List all agents
rovn agents
```

## Commands

| Command | Description |
|---------|-------------|
| `rovn init` | Register a new agent |
| `rovn log` | View recent activities |
| `rovn log --push "title"` | Log a new activity |
| `rovn tasks` | View assigned tasks |
| `rovn tasks done <id>` | Mark task as completed |
| `rovn check <action>` | Pre-flight policy check |
| `rovn approve` | List pending approvals |
| `rovn approve request "title"` | Request approval |
| `rovn trust` | View trust score |
| `rovn report` | View report card |
| `rovn status` | Agent overview |
| `rovn agents` | List all registered agents |
| `rovn use <profile>` | Switch active agent |
| `rovn whoami` | Show current agent |

## Configuration

Agent credentials are stored in `~/.rovnrc`. This file is created automatically by `rovn init`.

## License

MIT
