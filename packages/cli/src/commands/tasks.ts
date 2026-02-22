import { requireAgent } from '../config.js';
import { apiGet, apiPatch } from '../api.js';
import { fmt, table, timeAgo, spinner, success, error, emptyState, header } from '../format.js';

export async function tasksCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  // rovn tasks done <id>
  if (args[0] === 'done' && args[1]) {
    const s = spinner('Updating task...');
    const res = await apiPatch(agent, `/api/tasks/${args[1]}`, { status: 'completed' });
    s.stop();
    if (res.success) {
      console.log(success(`Task ${fmt.bold(args[1])} marked as completed`));
    } else {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn tasks start <id>
  if (args[0] === 'start' && args[1]) {
    const s = spinner('Updating task...');
    const res = await apiPatch(agent, `/api/tasks/${args[1]}`, { status: 'in_progress' });
    s.stop();
    if (res.success) {
      console.log(success(`Task ${fmt.bold(args[1])} marked as in_progress`));
    } else {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn tasks (list)
  let query = '';
  const statusIdx = args.indexOf('--status');
  if (statusIdx >= 0 && args[statusIdx + 1]) query = `?status=${args[statusIdx + 1]}`;

  const s = spinner('Loading tasks...');
  const res = await apiGet(agent, `/api/agents/${agent.id}/tasks${query}`);
  s.stop();

  if (!res.success) {
    console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const tasks = (res.data ?? res.tasks ?? []) as Array<Record<string, unknown>>;

  if (tasks.length === 0) {
    console.log(emptyState('No tasks assigned.', 'Tasks will appear here when your owner assigns them'));
    return;
  }

  console.log(header(`Tasks (${tasks.length})`));

  const statusColor = (s: string) => {
    if (s === 'completed') return fmt.green(s);
    if (s === 'in_progress') return fmt.yellow(s);
    if (s === 'cancelled' || s === 'failed') return fmt.red(s);
    return s;
  };

  const rows = tasks.map((t, i) => [
    String(i + 1),
    ((t.id as string) ?? '').slice(0, 8),
    (t.title as string) ?? '',
    statusColor((t.status as string) ?? ''),
    t.created_at ? timeAgo(t.created_at as string) : '',
  ]);

  console.log(table(['#', 'ID', 'Title', 'Status', 'Created'], rows));
  console.log(`\n  ${fmt.cyan('rovn tasks start <id>')}  ${fmt.dim('Mark as in_progress')}`);
  console.log(`  ${fmt.cyan('rovn tasks done <id>')}   ${fmt.dim('Mark as completed')}\n`);
}
