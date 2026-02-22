import { loadConfig, saveConfig, listProfiles, requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt, table, box, success, error, header, symbols, emptyState, spinner } from '../format.js';

export function agentsCommand(args: string[]): void {
  // rovn use <profile>
  if (args[0] === 'use' || args[0] === 'switch') {
    const profile = args[1];
    if (!profile) {
      console.error(error('Missing profile name', 'Usage: rovn use <profile-name>'));
      process.exit(1);
    }

    const config = loadConfig();
    if (!config.agents[profile]) {
      console.error(error(`Profile "${profile}" not found`));
      console.log(fmt.dim('\n  Available profiles:'));
      for (const name of Object.keys(config.agents)) {
        console.log(`    ${fmt.cyan(name)}`);
      }
      console.log('');
      process.exit(1);
    }

    config.current = profile;
    saveConfig(config);
    console.log(success(`Switched to: ${fmt.bold(config.agents[profile].name)} ${fmt.dim(`(${profile})`)}`));
    return;
  }

  // rovn agents (list)
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log(emptyState('No agents configured.', 'Run: rovn init'));
    return;
  }

  console.log(header('Registered Agents'));

  const rows = profiles.map(p => [
    p.isCurrent ? fmt.green(`${p.name} ${symbols.dot}`) : p.name,
    p.agent.name,
    p.agent.id.slice(0, 12) + '...',
    p.agent.url,
  ]);

  console.log(table(['Profile', 'Name', 'ID', 'Server'], rows));
  console.log(`\n  ${fmt.dim(`${symbols.dot} = active`)}    ${fmt.cyan('rovn use <profile>')}  ${fmt.dim('Switch agent')}\n`);
}

export function useCommand(args: string[]): void {
  agentsCommand(['use', ...args]);
}

export async function whoamiCommand(): Promise<void> {
  const profiles = listProfiles();
  const current = profiles.find(p => p.isCurrent);

  if (!current) {
    console.log(emptyState('No agent configured.', 'Run: rovn init'));
    return;
  }

  const agent = current.agent;

  // Try to fetch trust score for richer card
  let score = '?';
  let grade = '?';
  try {
    const s = spinner('Loading...');
    const res = await apiGet(agent, `/api/agents/${agent.id}/trust-score`);
    s.stop();
    if (res.success) {
      const data = (res.data ?? res) as Record<string, unknown>;
      score = String(data.trust_score ?? data.score ?? '?');
      grade = String(data.grade ?? data.trust_level ?? data.level ?? '?');
    }
  } catch {
    // Show card without trust score
  }

  const scoreNum = parseInt(score, 10);
  const coloredScore = isNaN(scoreNum) ? score
    : scoreNum >= 61 ? fmt.green(score)
    : scoreNum >= 31 ? fmt.yellow(score)
    : fmt.red(score);

  const lines = [
    `${fmt.bold(agent.name)}`,
    ``,
    `${fmt.dim('Profile')}  ${fmt.cyan(current.name)}`,
    `${fmt.dim('ID')}       ${agent.id}`,
    `${fmt.dim('Server')}   ${agent.url}`,
    `${fmt.dim('Trust')}    ${coloredScore}/100 ${fmt.dim(`(Grade ${grade})`)}`,
  ];

  console.log('');
  console.log(box(lines, `${symbols.dot} whoami`));
  console.log('');
}
