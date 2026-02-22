import type { AgentProfile } from './config.js';

// ─── HTTP Client ─────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 0,
    public hint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isJsonMode(): boolean {
  return process.env.ROVN_JSON === '1';
}

function statusMessage(status: number): { message: string; hint?: string } {
  if (status === 401 || status === 403) {
    return { message: 'Authentication failed', hint: 'Run `rovn init` to register or check your API key' };
  }
  if (status === 404) {
    return { message: 'Resource not found' };
  }
  if (status >= 500) {
    return { message: `Server error (${status})`, hint: 'Try again later' };
  }
  return { message: `Request failed (${status})` };
}

async function safeFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new ApiError('Request timed out', 0, 'Check your network connection or try again');
    }
    throw new ApiError('Could not connect to server', 0, 'Verify the server URL and your network');
  }

  if (!res.ok) {
    const { message, hint } = statusMessage(res.status);
    // Try to extract server error message
    let serverMsg = '';
    try {
      const body = await res.json() as Record<string, unknown>;
      serverMsg = (body.error as string) ?? '';
    } catch { /* ignore */ }
    throw new ApiError(serverMsg || message, res.status, hint);
  }

  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError('Invalid response from server', res.status, 'The server returned non-JSON data');
  }
}

function makeHeaders(agent: AgentProfile, method: 'GET' | 'POST' | 'PATCH'): Record<string, string> {
  const headers: Record<string, string> = {};
  if (agent.api_key) headers['Authorization'] = `Bearer ${agent.api_key}`;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'rovn-cli';
  }
  return headers;
}

export async function apiGet(agent: AgentProfile, path: string): Promise<Record<string, unknown>> {
  const data = await safeFetch(`${agent.url}${path}`, {
    headers: makeHeaders(agent, 'GET'),
  });
  if (isJsonMode()) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  return data;
}

export async function apiPost(agent: AgentProfile, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const data = await safeFetch(`${agent.url}${path}`, {
    method: 'POST',
    headers: makeHeaders(agent, 'POST'),
    body: JSON.stringify(body),
  });
  if (isJsonMode()) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  return data;
}

export async function apiPatch(agent: AgentProfile, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const data = await safeFetch(`${agent.url}${path}`, {
    method: 'PATCH',
    headers: makeHeaders(agent, 'PATCH'),
    body: JSON.stringify(body),
  });
  if (isJsonMode()) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }
  return data;
}
