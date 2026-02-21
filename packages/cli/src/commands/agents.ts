import { loadConfig, saveConfig, listProfiles } from '../config.js';
import { fmt, table } from '../format.js';

export function agentsCommand(args: string[]): void {
  // rovn use <profile>
  if (args[0] === 'use' || args[0] === 'switch') {
    const profile = args[1];
    if (!profile) {
      console.error(fmt.red('Usage: rovn use <profile-name>'));
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.agents[profile]) {
      console.error(fmt.red(`Profile "${profile}" not found.`));
      console.log(fmt.dim('Available profiles:'));
      for (const name of Object.keys(config.agents)) {
        console.log(`  ${name}`);
      }
      process.exit(1);
    }

    config.current = profile;
    saveConfig(config);
    console.log(fmt.green(`Switched to: ${config.agents[profile].name} (${profile})`));
    return;
  }

  // rovn agents (list)
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log(fmt.dim('No agents configured. Run: rovn init'));
    return;
  }

  console.log(fmt.bold('\nRegistered Agents\n'));

  const rows = profiles.map(p => [
    p.isCurrent ? `${p.name} *` : p.name,
    p.agent.name,
    p.agent.id.slice(0, 12) + '...',
    p.agent.url,
  ]);

  console.log(table(['Profile', 'Name', 'ID', 'Server'], rows));
  console.log(`\n  ${fmt.dim('rovn use <profile>')}  Switch active agent\n`);
}

export function useCommand(args: string[]): void {
  agentsCommand(['use', ...args]);
}

export function whoamiCommand(): void {
  const profiles = listProfiles();
  const current = profiles.find(p => p.isCurrent);

  if (!current) {
    console.log(fmt.dim('No agent configured. Run: rovn init'));
    return;
  }

  console.log(`${fmt.bold(current.agent.name)} (${fmt.cyan(current.name)})`);
}
