import { requireAgent } from '../config.js';
import { apiGet, apiPost } from '../api.js';
import { fmt, table, timeAgo, spinner, success, error, emptyState, header } from '../format.js';

export async function logCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  // rovn log --push "title" --type "type"
  const pushIdx = args.indexOf('--push');
  if (pushIdx >= 0) {
    const title = args[pushIdx + 1];
    if (!title) { console.error(error('Missing title', 'Usage: rovn log --push "Activity title"')); process.exit(1); }

    let type = 'action';
    const typeIdx = args.indexOf('--type');
    if (typeIdx >= 0 && args[typeIdx + 1]) type = args[typeIdx + 1];

    let description = '';
    const descIdx = args.indexOf('--desc');
    if (descIdx >= 0 && args[descIdx + 1]) description = args[descIdx + 1];

    const s = spinner('Logging activity...');
    const res = await apiPost(agent, `/api/agents/${agent.id}/activities`, {
      title,
      type,
      description: description || undefined,
    });
    s.stop();

    if (res.success) {
      console.log(success(`Logged: ${fmt.bold(title)}`));
    } else {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn log (list activities)
  let limit = 10;
  const lastIdx = args.indexOf('--last');
  if (lastIdx >= 0 && args[lastIdx + 1]) limit = parseInt(args[lastIdx + 1], 10) || 10;

  const s = spinner('Loading activities...');
  const res = await apiGet(agent, `/api/agents/${agent.id}/activities?limit=${limit}`);
  s.stop();

  if (!res.success) {
    console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const resData = (res.data ?? {}) as Record<string, unknown>;
  const activities = (resData.activities ?? res.activities ?? []) as Array<Record<string, unknown>>;

  if (activities.length === 0) {
    console.log(emptyState('No activities yet.', 'Log one with: rovn log --push "Did something"'));
    return;
  }

  console.log(header(`Recent Activities (${activities.length})`));

  const rows = activities.map((a, i) => [
    String(i + 1),
    (a.title as string) ?? '',
    (a.type as string) ?? '',
    a.created_at ? timeAgo(a.created_at as string) : '',
  ]);

  console.log(table(['#', 'Title', 'Type', 'Time'], rows));
  console.log('');
}
