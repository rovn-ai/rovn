import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt, spinner, header, symbols } from '../format.js';

export async function reportCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  let days = 7;
  const daysIdx = args.indexOf('--days');
  if (daysIdx >= 0 && args[daysIdx + 1]) days = parseInt(args[daysIdx + 1], 10) || 7;

  const s = spinner('Loading report card...');
  const res = await apiGet(agent, `/api/agents/${agent.id}/report-card?days=${days}`);
  s.stop();

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;

  console.log(header(`Report Card — Last ${days} days`));

  // Grades with visual bars
  const sections = (data.sections ?? data.grades ?? []) as Array<Record<string, unknown>>;
  if (sections.length > 0) {
    const maxLabel = Math.max(...sections.map(s => ((s.label ?? s.name) as string).length));

    for (const section of sections) {
      const grade = (section.grade as string) ?? '';
      const label = ((section.label ?? section.name) as string);

      // Grade to bar width (A+=10, A=9, B+=8, B=7, C+=6, C=5, D=3, F=1)
      const gradeMap: Record<string, number> = { 'A+': 10, 'A': 9, 'A-': 8, 'B+': 7, 'B': 6, 'B-': 5, 'C+': 4, 'C': 3, 'C-': 2, 'D': 1, 'F': 0 };
      const barWidth = gradeMap[grade] ?? 5;
      const barFn = grade.startsWith('A') ? fmt.green
        : grade.startsWith('B') ? fmt.cyan
        : grade.startsWith('C') ? fmt.yellow
        : fmt.red;

      const gradeColor = barFn(grade.padEnd(2));
      const bar = barFn('\u2588'.repeat(barWidth)) + fmt.dim('\u2591'.repeat(10 - barWidth));

      console.log(`  ${gradeColor}  ${bar}  ${label.padEnd(maxLabel)}`);
    }
    console.log('');
  }

  // Recommendations
  const recommendations = (data.recommendations ?? []) as string[];
  if (recommendations.length > 0) {
    console.log(`  ${fmt.bold('Recommendations')}`);
    for (const rec of recommendations) {
      console.log(`    ${fmt.yellow(symbols.bullet)} ${rec}`);
    }
    console.log('');
  }

  // Summary stats
  const stats: string[] = [];
  if (data.total_activities !== undefined) stats.push(`Activities: ${fmt.bold(String(data.total_activities))}`);
  if (data.trust_score !== undefined) stats.push(`Trust: ${fmt.bold(String(data.trust_score))}`);
  if (stats.length > 0) {
    console.log(`  ${stats.join(`  ${fmt.dim(symbols.dot)}  `)}`);
    console.log('');
  }
}
