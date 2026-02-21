import { requireAgent } from '../config.js';
import { apiGet } from '../api.js';
import { fmt } from '../format.js';

export async function checkCommand(args: string[]): Promise<void> {
  const agent = requireAgent();

  const action = args[0];
  if (!action) {
    console.error(fmt.red('Usage: rovn check <action> [--urgency low|medium|high|critical] [--cost 10.00]'));
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

  const res = await apiGet(agent, `/api/agents/${agent.id}/check?${params}`);

  if (!res.success) {
    console.error(fmt.red(`Failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = (res.data ?? res) as Record<string, unknown>;
  const decision = (data.decision as string) ?? 'unknown';

  const icon = decision === 'approved' ? fmt.green('APPROVED')
    : decision === 'denied' ? fmt.red('DENIED')
    : fmt.yellow('NEEDS APPROVAL');

  console.log(`\n  Action:   ${fmt.bold(action)}`);
  console.log(`  Decision: ${icon}`);
  if (data.reason) console.log(`  Reason:   ${data.reason as string}`);
  if (data.trust_level !== undefined) console.log(`  Trust:    Level ${data.trust_level as number}`);
  console.log('');
}
