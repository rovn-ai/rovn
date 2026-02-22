import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt, spinner, box, error, symbols } from '../format.js';

export async function checkCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  const action = args[0];
  if (!action) {
    console.error(error('Missing action', 'Usage: rovn check <action> [--urgency low|medium|high|critical] [--cost 10.00]'));
    process.exit(1);
  }

  let urgency = 'medium';
  let cost: number | undefined;
  let context = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--urgency' && args[i + 1]) urgency = args[++i];
    if (args[i] === '--cost' && args[i + 1]) cost = parseFloat(args[++i]);
    if (args[i] === '--context' && args[i + 1]) context = args[++i];
  }

  const params = new URLSearchParams({ action, urgency });
  if (cost !== undefined) params.set('cost', String(cost));
  if (context) params.set('context', context);

  const s = spinner(`Checking: ${action}...`);
  const res = await apiGet(agent, `/api/agents/${agent.id}/check?${params}`);
  s.stop();

  if (!res.success) {
    console.error(error(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;
  const decision = (data.decision as string) ?? 'unknown';

  const decisionDisplay = decision === 'approved'
    ? fmt.bgGreen(` ${symbols.check} APPROVED `)
    : decision === 'denied'
    ? fmt.bgRed(` ${symbols.cross} DENIED `)
    : fmt.bgYellow(` ${symbols.warning} NEEDS APPROVAL `);

  const lines = [
    `${fmt.dim('Action')}    ${fmt.bold(action)}`,
    `${fmt.dim('Decision')}  ${decisionDisplay}`,
    ...(data.reason ? [`${fmt.dim('Reason')}    ${data.reason as string}`] : []),
    ...(data.trust_level !== undefined ? [`${fmt.dim('Trust')}     Level ${data.trust_level as number}`] : []),
  ];

  console.log('');
  console.log(box(lines, 'Pre-flight Check'));
  console.log('');
}
