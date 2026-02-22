import { createInterface } from 'readline';
import { loadConfig, saveConfig } from '../config.js';
import { apiPost } from '../api.js';
import { fmt, spinner, box, success, error, header, symbols } from '../format.js';

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
  console.log(header('Rovn Agent Setup'));

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
  if (!name) name = await prompt(`  ${symbols.arrow} Agent name: `);
  if (!name) { console.error(error('Agent name is required.')); process.exit(1); }

  if (!profile) profile = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!email) email = await prompt(`  ${symbols.arrow} Owner email (optional): `);

  // Register via API
  const s = spinner(`Registering ${name}...`);
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
  s.stop();

  if (!res.success) {
    console.error(error(`Registration failed: ${res.error ?? 'Unknown error'}`));
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

  // Success card
  const lines = [
    `${fmt.green(symbols.check)} ${fmt.bold('Agent registered successfully!')}`,
    ``,
    `${fmt.dim('Profile')}    ${fmt.cyan(profile)}`,
    `${fmt.dim('Agent ID')}   ${data.id as string}`,
    `${fmt.dim('Name')}       ${data.name as string}`,
    `${fmt.dim('Server')}     ${url}`,
    ...(data.claim_url ? [
      ``,
      `${fmt.yellow(symbols.warning)} ${fmt.bold('Share this URL with the owner to claim:')}`,
      `${fmt.cyan(data.claim_url as string)}`,
    ] : []),
  ];

  console.log('');
  console.log(box(lines, 'Registration Complete'));
  console.log(`\n  Config saved to ${fmt.dim('~/.rovnrc')}`);
  console.log(`  Run ${fmt.cyan('rovn status')} to check your agent.\n`);
}
