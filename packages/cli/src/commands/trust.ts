import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt } from '../format.js';

export async function trustCommand(): Promise<void> {
  const agent = requireAgent();

  const res = await apiGet(agent, `/api/agents/${agent.id}/trust-score`);

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;
  const score = (data.trust_score ?? data.score ?? 0) as number;
  const level = (data.trust_level ?? data.level ?? 0) as number;
  const label = (data.trust_label ?? data.label ?? '') as string;

  // Visual bar
  const filled = Math.round(score / 5);
  const bar = fmt.green('█'.repeat(filled)) + fmt.dim('░'.repeat(20 - filled));

  console.log(fmt.bold(`\nTrust Score (${agent.name})\n`));
  console.log(`  ${bar}  ${fmt.bold(String(score))}/100`);
  console.log(`  Level: ${fmt.cyan(String(level))} ${label ? `(${label})` : ''}`);
  console.log('');
}
