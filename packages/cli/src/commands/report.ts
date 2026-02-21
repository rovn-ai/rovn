import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt } from '../format.js';

export async function reportCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  let days = 7;
  const daysIdx = args.indexOf('--days');
  if (daysIdx >= 0 && args[daysIdx + 1]) days = parseInt(args[daysIdx + 1], 10) || 7;

  const res = await apiGet(agent, `/api/agents/${agent.id}/report-card?days=${days}`);

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;

  console.log(fmt.bold(`\nReport Card (${agent.name}) — Last ${days} days\n`));

  // Grades
  const sections = (data.sections ?? data.grades ?? []) as Array<Record<string, unknown>>;
  if (sections.length > 0) {
    for (const section of sections) {
      const grade = (section.grade as string) ?? '';
      const gradeColor = grade.startsWith('A') ? fmt.green(grade)
        : grade.startsWith('B') ? fmt.cyan(grade)
        : grade.startsWith('C') ? fmt.yellow(grade)
        : fmt.red(grade);
      console.log(`  ${gradeColor}  ${(section.label ?? section.name) as string}`);
    }
    console.log('');
  }

  // Recommendations
  const recommendations = (data.recommendations ?? []) as string[];
  if (recommendations.length > 0) {
    console.log(fmt.bold('  Recommendations:'));
    for (const rec of recommendations) {
      console.log(`    ${fmt.dim('•')} ${rec}`);
    }
    console.log('');
  }

  // Summary stats
  if (data.total_activities !== undefined) {
    console.log(`  Activities: ${fmt.bold(String(data.total_activities))}`);
  }
  if (data.trust_score !== undefined) {
    console.log(`  Trust Score: ${fmt.bold(String(data.trust_score))}`);
  }
  console.log('');
}
