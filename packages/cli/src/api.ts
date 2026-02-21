import type { AgentProfile } from './config.js';

// ─── HTTP Client ─────────────────────────────────────────

export async function apiGet(agent: AgentProfile, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${agent.url}${path}`, {
    headers: agent.api_key ? { Authorization: `Bearer ${agent.api_key}` } : {},
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function apiPost(agent: AgentProfile, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${agent.url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'rovn-cli',
      ...(agent.api_key ? { Authorization: `Bearer ${agent.api_key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export async function apiPatch(agent: AgentProfile, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${agent.url}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'rovn-cli',
      ...(agent.api_key ? { Authorization: `Bearer ${agent.api_key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}
