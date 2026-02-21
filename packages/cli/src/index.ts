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
import { fmt } from './format.js';

const VERSION = '0.1.0';

function showHelp(): void {
  console.log(`
${fmt.bold('rovn')} — Governance toolkit for AI agents

${fmt.bold('Usage:')}
  rovn <command> [options]

${fmt.bold('Setup:')}
  init                Register a new agent
  agents              List all registered agents
  use <profile>       Switch active agent
  whoami              Show current agent

${fmt.bold('Activity:')}
  log                 View recent activities
  log --push "title"  Log a new activity
  log --last 20       Show last N activities

${fmt.bold('Tasks:')}
  tasks               View assigned tasks
  tasks start <id>    Mark task as in_progress
  tasks done <id>     Mark task as completed

${fmt.bold('Governance:')}
  check <action>      Pre-flight check (can I do this?)
  approve             List pending approvals
  approve request "title"  Request approval

${fmt.bold('Insights:')}
  trust               View trust score
  report              View report card
  status              Agent overview

${fmt.bold('Options:')}
  --help, -h          Show this help
  --version, -v       Show version

${fmt.dim(`v${VERSION}  https://rovn.io`)}
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'init':
      await initCommand(rest);
      break;
    case 'log':
      await logCommand(rest);
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
      whoamiCommand();
      break;
    default:
      console.error(fmt.red(`Unknown command: ${command}`));
      console.log(fmt.dim('Run rovn --help for usage.'));
      process.exit(1);
  }
}

main().catch(err => {
  console.error(fmt.red(`Error: ${err}`));
  process.exit(1);
});
