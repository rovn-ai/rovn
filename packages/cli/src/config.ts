import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

// ─── Types ───────────────────────────────────────────────

export interface AgentProfile {
  id: string;
  api_key: string;
  name: string;
  url: string;
}

export interface RovnConfig {
  current: string;
  agents: Record<string, AgentProfile>;
}

// ─── Paths ───────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), '.rovnrc');

// ─── Read / Write ────────────────────────────────────────

export function loadConfig(): RovnConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as RovnConfig;
  } catch {
    return { current: '', agents: {} };
  }
}

export function saveConfig(config: RovnConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ─── Helpers ─────────────────────────────────────────────

export function getCurrentAgent(): AgentProfile | null {
  const config = loadConfig();
  if (!config.current || !config.agents[config.current]) return null;
  return config.agents[config.current];
}

export function requireAgent(): AgentProfile {
  const agent = getCurrentAgent();
  if (!agent) {
    console.error('No agent configured. Run: rovn init');
    process.exit(1);
  }
  return agent;
}

export function listProfiles(): { name: string; agent: AgentProfile; isCurrent: boolean }[] {
  const config = loadConfig();
  return Object.entries(config.agents).map(([name, agent]) => ({
    name,
    agent,
    isCurrent: name === config.current,
  }));
}
