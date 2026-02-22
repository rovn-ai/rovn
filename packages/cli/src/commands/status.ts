import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt, spinner, box, symbols, header } from '../format.js';

export async function statusCommand(): Promise<void> {
  const agent = requireAgent();

  const s = spinner('Loading agent status...');

  // Parallel API calls
  const [trustResult, activityResult] = await Promise.allSettled([
    apiGet(agent, `/api/agents/${agent.id}/trust-score`),
    apiGet(agent, `/api/agents/${agent.id}/activities?limit=1`),
  ]);

  s.stop();

  // Extract data
  let score = '?';
  let grade = '?';
  if (trustResult.status === 'fulfilled' && trustResult.value.success) {
    const data = (trustResult.value.data ?? trustResult.value) as Record<string, unknown>;
    score = String(data.trust_score ?? data.score ?? '?');
    grade = String(data.grade ?? data.trust_level ?? data.level ?? '?');
  }

  let totalActivities = '?';
  if (activityResult.status === 'fulfilled' && activityResult.value.success) {
    const data = activityResult.value;
    const inner = (data.data ?? {}) as Record<string, unknown>;
    totalActivities = String(inner.total ?? data.total ?? (inner.activities as unknown[] ?? data.activities as unknown[] ?? []).length ?? '?');
  }

  // Score color
  const scoreNum = parseInt(score, 10);
  const coloredScore = isNaN(scoreNum) ? score
    : scoreNum >= 61 ? fmt.green(score)
    : scoreNum >= 31 ? fmt.yellow(score)
    : fmt.red(score);

  const lines = [
    `${fmt.bold(agent.name)}`,
    ``,
    `${fmt.dim('ID')}         ${agent.id}`,
    `${fmt.dim('Server')}     ${agent.url}`,
    `${fmt.dim('Trust')}      ${coloredScore}/100 ${fmt.dim(`(Grade ${grade})`)}`,
    `${fmt.dim('Activities')} ${fmt.bold(totalActivities)}`,
  ];

  console.log(header('Agent Status'));
  console.log(box(lines, `${symbols.dot} ${agent.name}`));

  console.log(`\n  ${fmt.dim('Commands:')}`);
  console.log(`  ${fmt.cyan('rovn log')}       ${fmt.dim('View recent activities')}`);
  console.log(`  ${fmt.cyan('rovn tasks')}     ${fmt.dim('View assigned tasks')}`);
  console.log(`  ${fmt.cyan('rovn trust')}     ${fmt.dim('View trust score')}`);
  console.log(`  ${fmt.cyan('rovn report')}    ${fmt.dim('View report card')}`);
  console.log('');
}
