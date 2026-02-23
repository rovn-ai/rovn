#!/usr/bin/env node

import { initCommand } from './commands/init.js';
import { logCommand } from './commands/log.js';
import { tasksCommand } from './commands/tasks.js';
import { checkCommand } from './commands/check.js';
import { trustCommand } from './commands/trust.js';
import { reportCommand } from './commands/report.js';
import { approveCommand } from './commands/approve.js';
import { statusCommand } from './commands/status.js';
import { agentsCommand, useCommand, whoamiCommand } from './commands/agents.js';
import { sessionCommand } from './commands/session.js';
import { tuiCommand } from './commands/tui.js';
import { fmt, error } from './format.js';
import { ApiError } from './api.js';

const VERSION = '0.3.0';

class ExitError extends Error {
  constructor() { super(); this.name = 'ExitError'; }
}

const COMMANDS: Record<string, string> = {
  init: 'Register a new agent',
  agents: 'List all registered agents',
  use: 'Switch active agent',
  whoami: 'Show current agent',
  log: 'View/push activities',
  session: 'Manage sessions',
  tasks: 'View/manage assigned tasks',
  check: 'Pre-flight governance check',
  approve: 'Manage approvals',
  trust: 'View trust score',
  report: 'View report card',
  status: 'Agent overview',
  tui: 'Interactive terminal dashboard',
};

const COMMAND_NAMES = Object.keys(COMMANDS);

// ─── Levenshtein Distance ────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function suggestCommand(input: string): string | null {
  let best = '';
  let bestDist = Infinity;
  for (const cmd of COMMAND_NAMES) {
    const dist = levenshtein(input.toLowerCase(), cmd);
    if (dist < bestDist) {
      bestDist = dist;
      best = cmd;
    }
  }
  return bestDist <= 2 ? best : null;
}

// ─── Subcommand Help ─────────────────────────────────────

const SUBCOMMAND_HELP: Record<string, string> = {
  init: `${fmt.bold('rovn init')} — Register a new agent

${fmt.bold('Options:')}
  --name <name>     Agent name
  --as <profile>    Profile name (default: derived from name)
  --email <email>   Owner email (optional)
  --url <url>       Server URL (default: https://rovn.io)`,

  log: `${fmt.bold('rovn log')} — View and push activities

${fmt.bold('Usage:')}
  rovn log                     View recent activities
  rovn log --push "title"      Log a new activity
  rovn log --last 20           Show last N activities

${fmt.bold('Options:')}
  --push <title>    Log a new activity
  --type <type>     Activity type (default: action)
  --desc <text>     Description
  --task <id>       Link activity to a task
  --session <id>    Link activity to / filter by session
  --last <n>        Number of activities to show (default: 10)`,

  session: `${fmt.bold('rovn session')} — Manage sessions

${fmt.bold('Usage:')}
  rovn session                 Show current active session
  rovn session start           Start a new session
  rovn session end             End the current session
  rovn session list            List recent sessions

${fmt.bold('Options:')}
  --name <name>     Session name (start)
  --summary <text>  Session summary (end)
  --id <id>         Session ID (end specific session)
  --limit <n>       Number of sessions to show (list, default: 10)`,

  tasks: `${fmt.bold('rovn tasks')} — View and manage assigned tasks

${fmt.bold('Usage:')}
  rovn tasks                   List assigned tasks
  rovn tasks start <id>        Mark task as in_progress
  rovn tasks done <id>         Mark task as completed

${fmt.bold('Options:')}
  --status <status>  Filter by status`,

  check: `${fmt.bold('rovn check')} — Pre-flight governance check

${fmt.bold('Usage:')}
  rovn check <action>

${fmt.bold('Options:')}
  --urgency <level>  low | medium | high | critical (default: medium)
  --cost <amount>    Estimated cost in USD
  --context <text>   Additional context`,

  approve: `${fmt.bold('rovn approve')} — Manage approvals

${fmt.bold('Usage:')}
  rovn approve                            List pending approvals
  rovn approve request "title"            Request approval

${fmt.bold('Options:')}
  --type <type>       Category (default: action)
  --urgency <level>   low | medium | high | critical (default: medium)
  --desc <text>       Description`,

  trust: `${fmt.bold('rovn trust')} — View trust score

${fmt.bold('Usage:')}
  rovn trust`,

  report: `${fmt.bold('rovn report')} — View report card

${fmt.bold('Usage:')}
  rovn report

${fmt.bold('Options:')}
  --days <n>   Report period in days (default: 7)`,

  status: `${fmt.bold('rovn status')} — Agent overview dashboard

${fmt.bold('Usage:')}
  rovn status`,

  tui: `${fmt.bold('rovn tui')} — Interactive terminal dashboard

${fmt.bold('Usage:')}
  rovn tui

${fmt.bold('Keys:')}
  ↑/↓          Navigate items
  Shift+↑/↓    Switch panels
  Tab           Next panel
  r             Refresh data
  q / Esc       Quit`,

  agents: `${fmt.bold('rovn agents')} — List all registered agent profiles

${fmt.bold('Usage:')}
  rovn agents`,

  use: `${fmt.bold('rovn use')} — Switch active agent profile

${fmt.bold('Usage:')}
  rovn use <profile>`,

  whoami: `${fmt.bold('rovn whoami')} — Show current active agent

${fmt.bold('Usage:')}
  rovn whoami`,
};

// ─── Main Help ───────────────────────────────────────────

function showHelp(): void {
  console.log(`
${fmt.bold('rovn')} ${fmt.dim(`v${VERSION}`)} — Governance toolkit for AI agents

${fmt.bold('Setup:')}
  init                Register a new agent
  agents              List all registered agents
  use <profile>       Switch active agent
  whoami              Show current agent

${fmt.bold('Activity:')}
  log                 View recent activities
  log --push "title"  Log a new activity
  session             Manage sessions
  session start       Start a new session

${fmt.bold('Tasks:')}
  tasks               View assigned tasks
  tasks start <id>    Mark task as in_progress
  tasks done <id>     Mark task as completed

${fmt.bold('Governance:')}
  check <action>      Pre-flight check (can I do this?)
  approve             List pending approvals
  approve request     Request approval

${fmt.bold('Insights:')}
  trust               View trust score
  report              View report card
  status              Agent overview
  tui                 Interactive dashboard

${fmt.bold('Global Options:')}
  --help, -h          Show help (use with command for details)
  --version, -v       Show version
  --json              Output raw JSON (for scripting)

${fmt.dim(`https://rovn.io`)}
`);
}

// ─── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Extract --json global flag
  const jsonIdx = rawArgs.indexOf('--json');
  if (jsonIdx >= 0) {
    process.env.ROVN_JSON = '1';
    rawArgs.splice(jsonIdx, 1);
  }

  const command = rawArgs[0];
  const rest = rawArgs.slice(1);

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  // Subcommand --help
  if (rest.includes('--help') || rest.includes('-h')) {
    const help = SUBCOMMAND_HELP[command];
    if (help) {
      console.log(`\n${help}\n`);
      return;
    }
  }

  switch (command) {
    case 'init':
      await initCommand(rest);
      break;
    case 'log':
      await logCommand(rest);
      break;
    case 'session':
      await sessionCommand(rest);
      break;
    case 'tasks':
      await tasksCommand(rest);
      break;
    case 'check':
      await checkCommand(rest);
      break;
    case 'trust':
      await trustCommand();
      break;
    case 'report':
      await reportCommand(rest);
      break;
    case 'approve':
      await approveCommand(rest);
      break;
    case 'status':
      await statusCommand();
      break;
    case 'agents':
      agentsCommand(rest);
      break;
    case 'use':
      useCommand(rest);
      break;
    case 'whoami':
      await whoamiCommand();
      break;
    case 'tui':
      await tuiCommand();
      break;
    default: {
      const suggestion = suggestCommand(command);
      let msg = error(`Unknown command: ${command}`);
      if (suggestion) {
        msg += `\n\n  Did you mean ${fmt.cyan(`rovn ${suggestion}`)}?\n`;
      } else {
        msg += `\n${fmt.dim('  Run rovn --help for usage.')}\n`;
      }
      console.error(msg);
      throw new ExitError();
    }
  }
}

main().catch(err => {
  if (err instanceof ExitError) {
    process.exit(1);
  }
  if (err instanceof ApiError) {
    console.error(error(err.message, err.hint));
  } else {
    console.error(error(String(err)));
  }
  process.exit(1);
});
