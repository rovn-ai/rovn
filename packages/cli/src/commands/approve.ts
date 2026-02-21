import { requireAgent } from '../config.js';
import { apiGet, apiPost } from '../api.js';
import { fmt, table, timeAgo } from '../format.js';

export async function approveCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  // rovn approve request "title" --type deployment --urgency high
  if (args[0] === 'request') {
    const title = args[1];
    if (!title) {
      console.error(fmt.red('Usage: rovn approve request "Deploy to production" [--type deployment] [--urgency high]'));
      process.exit(1);
    }

    let type = 'action';
    let urgency = 'medium';
    let description = '';

    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--type' && args[i + 1]) type = args[++i];
      if (args[i] === '--urgency' && args[i + 1]) urgency = args[++i];
      if (args[i] === '--desc' && args[i + 1]) description = args[++i];
    }

    const res = await apiPost(agent, `/api/agents/${agent.id}/approvals`, {
      title,
      type,
      urgency,
      description: description || undefined,
    });

    if (res.success) {
      console.log(fmt.green(`Approval requested: ${title}`));
      console.log(fmt.dim('  The owner will see this in their dashboard.'));
    } else {
      console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn approve (list pending approvals)
  const res = await apiGet(agent, `/api/agents/${agent.id}/approvals?status=pending`);

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const approvals = (res.data ?? res.approvals ?? []) as Array<Record<string, unknown>>;

  if (approvals.length === 0) {
    console.log(fmt.dim('No pending approvals.'));
    return;
  }

  console.log(fmt.bold(`\nPending Approvals (${agent.name})\n`));

  const rows = approvals.map((a, i) => [
    String(i + 1),
    (a.title as string) ?? '',
    (a.type as string) ?? '',
    (a.urgency as string) ?? '',
    a.created_at ? timeAgo(a.created_at as string) : '',
  ]);

  console.log(table(['#', 'Title', 'Type', 'Urgency', 'Requested'], rows));
  console.log('');
}
