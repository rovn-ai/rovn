import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt, spinner, header } from '../format.js';

export async function trustCommand(): Promise<void> {
  const agent = requireAgent();

  const s = spinner('Fetching trust score...');
  const res = await apiGet(agent, `/api/agents/${agent.id}/trust-score`);
  s.stop();

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;
  const score = (data.trust_score ?? data.score ?? 0) as number;
  const grade = (data.grade ?? data.trust_level ?? data.level ?? '') as string;

  // Score-based color
  const colorFn = score >= 61 ? fmt.green : score >= 31 ? fmt.yellow : fmt.red;
  const levelLabel = score >= 81 ? 'Excellent'
    : score >= 61 ? 'Good'
    : score >= 31 ? 'Fair'
    : 'Low';

  // Visual bar with color gradient
  const filled = Math.round(score / 5);
  const bar = colorFn('\u2588'.repeat(filled)) + fmt.dim('\u2591'.repeat(20 - filled));

  console.log(header(`Trust Score`));
  console.log(`  ${bar}  ${fmt.bold(String(score))}/100`);
  console.log(`  Grade ${fmt.cyan(String(grade))}  ${fmt.dim('\u2022')}  ${colorFn(levelLabel)}`);
  console.log('');
}
