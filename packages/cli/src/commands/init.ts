import { createInterface } from 'readline';
import { loadConfig, saveConfig } from '../config.js';
import { apiPost } from '../api.js';
import { fmt } from '../format.js';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function initCommand(args: string[]): Promise<void> {
  console.log(fmt.bold('\nRovn Agent Setup\n'));

  // Parse flags
  let name = '';
  let profile = '';
  let email = '';
  let url = 'https://rovn.io';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
    if (args[i] === '--as' && args[i + 1]) profile = args[++i];
    if (args[i] === '--email' && args[i + 1]) email = args[++i];
    if (args[i] === '--url' && args[i + 1]) url = args[++i];
  }

  // Interactive prompts for missing values
  if (!name) name = await prompt('Agent name: ');
  if (!name) { console.error(fmt.red('Agent name is required.')); process.exit(1); }

  if (!profile) profile = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!email) email = await prompt('Owner email (optional): ');

  console.log(`\nRegistering ${fmt.cyan(name)} at ${fmt.dim(url)}...`);

  // Register via API
  const res = await apiPost(
    { id: '', api_key: '', name: '', url },
    '/api/agents/register',
    {
      name,
      type: 'cli-agent',
      owner_email: email || undefined,
      metadata: { platform: 'cli', registered_at: new Date().toISOString() },
    },
  );

  if (!res.success) {
    console.error(fmt.red(`\nRegistration failed: ${res.error ?? 'Unknown error'}`));
    process.exit(1);
  }

  const data = res.data as Record<string, unknown>;

  // Save to config
  const config = loadConfig();
  config.agents[profile] = {
    id: data.id as string,
    api_key: data.api_key as string,
    name: data.name as string,
    url,
  };
  config.current = profile;
  saveConfig(config);

  console.log(fmt.green('\nAgent registered successfully!\n'));
  console.log(`  Profile:   ${fmt.bold(profile)}`);
  console.log(`  Agent ID:  ${fmt.dim(data.id as string)}`);
  console.log(`  Name:      ${data.name as string}`);
  if (data.claim_url) {
    console.log(`\n  ${fmt.yellow('Share this URL with the owner to claim:')}`);
    console.log(`  ${fmt.cyan(data.claim_url as string)}`);
  }
  console.log(`\n  Config saved to ${fmt.dim('~/.rovnrc')}`);
  console.log(`  Run ${fmt.cyan('rovn status')} to check your agent.\n`);
}
