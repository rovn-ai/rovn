import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt } from '../format.js';

export async function statusCommand(): Promise<void> {
  const agent = requireAgent();

  console.log(fmt.bold(`\nAgent Status\n`));
  console.log(`  Name:    ${fmt.cyan(agent.name)}`);
  console.log(`  ID:      ${fmt.dim(agent.id)}`);
  console.log(`  Server:  ${fmt.dim(agent.url)}`);

  // Fetch trust score
  try {
    const trust = await apiGet(agent, `/api/agents/${agent.id}/trust-score`);
    if (trust.success) {
      const data = (trust.data ?? trust) as Record<string, unknown>;
      const score = (data.trust_score ?? data.score ?? '?') as number;
      const level = (data.trust_level ?? data.level ?? '?') as number;
      console.log(`  Trust:   ${fmt.bold(String(score))}/100 (Level ${level})`);
    }
  } catch { /* ignore */ }

  // Fetch recent activities count
  try {
    const activities = await apiGet(agent, `/api/agents/${agent.id}/activities?limit=1`);
    if (activities.success) {
      const data = (activities.data ?? activities.activities ?? []) as Array<unknown>;
      const total = (activities.total ?? data.length ?? 0) as number;
      console.log(`  Activities: ${fmt.bold(String(total))}`);
    }
  } catch { /* ignore */ }

  console.log(`\n  ${fmt.dim('Commands:')}`);
  console.log(`  ${fmt.dim('rovn log')}       View recent activities`);
  console.log(`  ${fmt.dim('rovn tasks')}     View assigned tasks`);
  console.log(`  ${fmt.dim('rovn trust')}     View trust score`);
  console.log(`  ${fmt.dim('rovn report')}    View report card`);
  console.log('');
}
