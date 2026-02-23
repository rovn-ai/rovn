import { requireAgent } from '../config.js';
import { apiGet, apiPost, apiPatch } from '../api.js';
import { fmt, table, timeAgo, spinner, success, error, emptyState, header } from '../format.js';

export async function sessionCommand(args: string[]): Promise<void> {
  const agent = requireAgent();
  const subcommand = args[0];

  // rovn session start [--name "name"]
  if (subcommand === 'start') {
    let name: string | undefined;
    const nameIdx = args.indexOf('--name');
    if (nameIdx >= 0 && args[nameIdx + 1]) name = args[nameIdx + 1];

    const s = spinner('Starting session...');
    const res = await apiPost(agent, `/api/agents/${agent.id}/sessions`, {
      name: name || undefined,
    });
    s.stop();

    if (res.success) {
      const data = res.data as Record<string, unknown>;
      console.log(success(`Session started: ${fmt.bold(String(data.id))}`));
      if (name) console.log(fmt.dim(`  Name: ${name}`));
    } else {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn session end [--summary "summary"] --id <session-id>
  if (subcommand === 'end') {
    let sessionId: string | undefined;
    const idIdx = args.indexOf('--id');
    if (idIdx >= 0 && args[idIdx + 1]) sessionId = args[idIdx + 1];

    if (!sessionId) {
      // Try to get the most recent active session
      const listRes = await apiGet(agent, `/api/agents/${agent.id}/sessions?status=active&limit=1`);
      if (listRes.success) {
        const data = listRes.data as Record<string, unknown>;
        const sessions = (data.sessions ?? []) as Array<Record<string, unknown>>;
        if (sessions.length > 0) {
          sessionId = sessions[0].id as string;
        }
      }
    }

    if (!sessionId) {
      console.error(error('No active session found', 'Start one with: rovn session start'));
      process.exit(1);
    }

    let summary: string | undefined;
    const summaryIdx = args.indexOf('--summary');
    if (summaryIdx >= 0 && args[summaryIdx + 1]) summary = args[summaryIdx + 1];

    const s = spinner('Ending session...');
    const res = await apiPatch(agent, `/api/sessions/${sessionId}`, {
      summary: summary || undefined,
    });
    s.stop();

    if (res.success) {
      console.log(success(`Session ended: ${fmt.bold(sessionId)}`));
      if (summary) console.log(fmt.dim(`  Summary: ${summary}`));
    } else {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    }
    return;
  }

  // rovn session list [--limit N]
  if (subcommand === 'list') {
    let limit = 10;
    const limitIdx = args.indexOf('--limit');
    if (limitIdx >= 0 && args[limitIdx + 1]) limit = parseInt(args[limitIdx + 1], 10) || 10;

    const s = spinner('Loading sessions...');
    const res = await apiGet(agent, `/api/agents/${agent.id}/sessions?limit=${limit}`);
    s.stop();

    if (!res.success) {
      console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
      process.exit(1);
    }

    const resData = res.data as Record<string, unknown>;
    const sessions = (resData.sessions ?? []) as Array<Record<string, unknown>>;

    if (sessions.length === 0) {
      console.log(emptyState('No sessions yet.', 'Start one with: rovn session start'));
      return;
    }

    console.log(header(`Recent Sessions (${sessions.length})`));

    const rows = sessions.map((s, i) => [
      String(i + 1),
      (s.name as string) ?? fmt.dim('unnamed'),
      (s.status as string) ?? '',
      s.started_at ? timeAgo(s.started_at as string) : '',
    ]);

    console.log(table(['#', 'Name', 'Status', 'Started'], rows));
    console.log('');
    return;
  }

  // rovn session (no subcommand) — show current active session
  const s = spinner('Loading active session...');
  const res = await apiGet(agent, `/api/agents/${agent.id}/sessions?status=active&limit=1`);
  s.stop();

  if (!res.success) {
    console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const resData = res.data as Record<string, unknown>;
  const sessions = (resData.sessions ?? []) as Array<Record<string, unknown>>;

  if (sessions.length === 0) {
    console.log(emptyState('No active session.', 'Start one with: rovn session start'));
    return;
  }

  const active = sessions[0];
  console.log(header('Active Session'));
  console.log(`  ${fmt.bold('ID:')}      ${active.id}`);
  console.log(`  ${fmt.bold('Name:')}    ${(active.name as string) ?? fmt.dim('unnamed')}`);
  console.log(`  ${fmt.bold('Started:')} ${active.started_at ? timeAgo(active.started_at as string) : 'Unknown'}`);
  console.log('');
}
