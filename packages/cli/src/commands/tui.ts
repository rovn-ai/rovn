import readline from 'readline';
import type { AgentProfile } from '../config.js';
import { requireAgent, loadConfig, saveConfig } from '../config.js';
import { stripAnsi } from '../format.js';

// ─── ANSI Helpers ────────────────────────────────────────

const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  enterAlt: `${CSI}?1049h`,
  leaveAlt: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  inverse: `${CSI}7m`,
  fg: {
    black: `${CSI}30m`, red: `${CSI}31m`, green: `${CSI}32m`,
    yellow: `${CSI}33m`, blue: `${CSI}34m`, magenta: `${CSI}35m`,
    cyan: `${CSI}36m`, white: `${CSI}37m`, default: `${CSI}39m`,
    gray: `${CSI}90m`, brightWhite: `${CSI}97m`,
    brightCyan: `${CSI}96m`, brightGreen: `${CSI}92m`,
    brightYellow: `${CSI}93m`, brightRed: `${CSI}91m`,
  },
  bg: {
    black: `${CSI}40m`, red: `${CSI}41m`, green: `${CSI}42m`,
    yellow: `${CSI}43m`, blue: `${CSI}44m`, magenta: `${CSI}45m`,
    cyan: `${CSI}46m`, white: `${CSI}47m`, default: `${CSI}49m`,
    brightBlack: `${CSI}100m`,
  },
  moveTo: (x: number, y: number) => `${CSI}${y};${x}H`,
  clearLine: `${CSI}2K`,
  clearScreen: `${CSI}2J`,
};

function c(style: string, text: string): string {
  return `${style}${text}${ansi.reset}`;
}

// ─── Types ───────────────────────────────────────────────

type Panel = 'status' | 'tasks' | 'activity' | 'approvals' | 'trust' | 'report';

interface TUIState {
  agent: AgentProfile;
  activePanel: Panel;
  sidebarIndex: number;
  listIndex: number;
  scrollOffset: number;
  loading: boolean;
  error: string | null;
  // Data
  trustScore: number | null;
  trustGrade: string | null;
  tasks: TaskItem[];
  activities: ActivityItem[];
  approvals: ApprovalItem[];
  reportCard: ReportData | null;
  lastUpdate: number;
}

interface TaskItem {
  id: string;
  subject: string;
  status: string;
  urgency?: string;
  created_at?: string;
}

interface ActivityItem {
  id: string;
  title: string;
  type: string;
  created_at: string;
  description?: string;
}

interface ApprovalItem {
  id: string;
  title: string;
  status: string;
  urgency: string;
  type?: string;
  created_at?: string;
}

interface ReportData {
  grades: Record<string, string>;
  recommendations: string[];
  summary: Record<string, unknown>;
}

// ─── Constants ───────────────────────────────────────────

const PANELS: { key: Panel; label: string; icon: string }[] = [
  { key: 'status', label: 'Status', icon: '◉' },
  { key: 'tasks', label: 'Tasks', icon: '☰' },
  { key: 'activity', label: 'Activity', icon: '⚡' },
  { key: 'approvals', label: 'Approvals', icon: '◎' },
  { key: 'trust', label: 'Trust', icon: '♦' },
  { key: 'report', label: 'Report', icon: '□' },
];

const SIDEBAR_WIDTH = 20;
const POLL_INTERVAL_MS = 8000;

// ─── API Fetching ────────────────────────────────────────

async function fetchJSON(agent: AgentProfile, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${agent.url}${path}`, {
    headers: { Authorization: `Bearer ${agent.api_key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Render Helpers ──────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  const clean = stripAnsi(s);
  if (clean.length <= maxLen) return s;
  return clean.slice(0, maxLen - 1) + '…';
}

function padRight(s: string, width: number): string {
  const diff = width - stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, diff));
}

function hLine(char: string, width: number): string {
  return char.repeat(width);
}

function trustColor(score: number): string {
  if (score >= 80) return ansi.fg.green;
  if (score >= 60) return ansi.fg.brightGreen;
  if (score >= 40) return ansi.fg.yellow;
  if (score >= 20) return ansi.fg.brightYellow;
  return ansi.fg.red;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return ansi.fg.green;
    case 'in_progress': return ansi.fg.yellow;
    case 'pending': return ansi.fg.cyan;
    case 'cancelled': case 'failed': case 'denied': return ansi.fg.red;
    case 'approved': return ansi.fg.green;
    case 'needs_approval': return ansi.fg.yellow;
    default: return ansi.fg.gray;
  }
}

function urgencyColor(urgency: string): string {
  switch (urgency) {
    case 'critical': return ansi.fg.red;
    case 'high': return ansi.fg.yellow;
    case 'medium': return ansi.fg.cyan;
    default: return ansi.fg.gray;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function activityIcon(type: string): string {
  switch (type) {
    case 'code_generation': return '⟨/⟩';
    case 'deployment': return '🚀';
    case 'testing': return '⚙';
    case 'review': return '⊙';
    case 'milestone': return '⚑';
    default: return '●';
  }
}

// ─── TUI App ─────────────────────────────────────────────

export async function tuiCommand(): Promise<void> {
  const agent = requireAgent();

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('TUI requires an interactive terminal.');
    process.exit(1);
  }

  const state: TUIState = {
    agent,
    activePanel: 'status',
    sidebarIndex: 0,
    listIndex: 0,
    scrollOffset: 0,
    loading: true,
    error: null,
    trustScore: null,
    trustGrade: null,
    tasks: [],
    activities: [],
    approvals: [],
    reportCard: null,
    lastUpdate: 0,
  };

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  // ── Terminal Setup ──

  function setup(): void {
    process.stdout.write(ansi.enterAlt + ansi.hideCursor + ansi.clearScreen);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  function cleanup(): void {
    if (destroyed) return;
    destroyed = true;
    if (pollTimer) clearInterval(pollTimer);
    process.stdout.write(ansi.showCursor + ansi.reset + ansi.leaveAlt);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  // ── Data Fetching ──

  async function fetchAll(): Promise<void> {
    state.loading = true;
    state.error = null;
    render();

    try {
      const results = await Promise.allSettled([
        fetchJSON(agent, `/api/agents/${agent.id}/trust-score`),
        fetchJSON(agent, `/api/agents/${agent.id}/tasks`),
        fetchJSON(agent, `/api/agents/${agent.id}/activities?limit=30`),
        fetchJSON(agent, `/api/agents/${agent.id}/approvals?status=pending`),
        fetchJSON(agent, `/api/agents/${agent.id}/report-card?days=7`),
      ]);

      // Trust
      if (results[0].status === 'fulfilled') {
        const d = results[0].value;
        const data = (d.data ?? d) as Record<string, unknown>;
        state.trustScore = (data.score as number) ?? null;
        state.trustGrade = (data.grade as string) ?? null;

        // Sync agent name from server if available
        const serverName = (data.agent_name ?? (d as Record<string, unknown>).agent_name) as string | undefined;
        if (serverName && serverName !== state.agent.name) {
          state.agent.name = serverName;
          try {
            const cfg = loadConfig();
            const profile = Object.entries(cfg.agents).find(([, a]) => a.id === state.agent.id);
            if (profile) {
              cfg.agents[profile[0]].name = serverName;
              saveConfig(cfg);
            }
          } catch { /* ignore sync errors */ }
        }
      }

      // Tasks
      if (results[1].status === 'fulfilled') {
        const d = results[1].value;
        const arr = (d.data ?? d.tasks ?? []) as TaskItem[];
        state.tasks = Array.isArray(arr) ? arr : [];
      }

      // Activities
      if (results[2].status === 'fulfilled') {
        const d = results[2].value;
        const arr = (d.data ?? d.activities ?? []) as ActivityItem[];
        state.activities = Array.isArray(arr) ? arr : [];
      }

      // Approvals
      if (results[3].status === 'fulfilled') {
        const d = results[3].value;
        const arr = (d.data ?? d.approvals ?? []) as ApprovalItem[];
        state.approvals = Array.isArray(arr) ? arr : [];
      }

      // Report
      if (results[4].status === 'fulfilled') {
        const d = results[4].value;
        state.reportCard = (d.data ?? d) as ReportData;
      }

      state.lastUpdate = Date.now();
    } catch (err) {
      state.error = `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`;
    }

    state.loading = false;
    if (!destroyed) render();
  }

  // ── Input Handling ──

  function handleKey(_str: string | undefined, key: { name?: string; ctrl?: boolean; shift?: boolean }): void {
    if (!key) return;
    if (key.ctrl && key.name === 'c') { cleanup(); process.exit(0); }
    if (key.name === 'q' || key.name === 'escape') { cleanup(); process.exit(0); }

    const listLen = getListLength();

    switch (key.name) {
      case 'up':
        if (key.shift || state.listIndex === 0) {
          // Move sidebar
          state.sidebarIndex = Math.max(0, state.sidebarIndex - 1);
          state.activePanel = PANELS[state.sidebarIndex].key;
          state.listIndex = 0;
          state.scrollOffset = 0;
        } else {
          state.listIndex = Math.max(0, state.listIndex - 1);
        }
        break;
      case 'down':
        if (key.shift || (listLen === 0)) {
          state.sidebarIndex = Math.min(PANELS.length - 1, state.sidebarIndex + 1);
          state.activePanel = PANELS[state.sidebarIndex].key;
          state.listIndex = 0;
          state.scrollOffset = 0;
        } else {
          state.listIndex = Math.min(listLen - 1, state.listIndex + 1);
        }
        break;
      case 'tab':
        state.sidebarIndex = (state.sidebarIndex + 1) % PANELS.length;
        state.activePanel = PANELS[state.sidebarIndex].key;
        state.listIndex = 0;
        state.scrollOffset = 0;
        break;
      case 'r':
        fetchAll();
        return;
    }

    render();
  }

  function getListLength(): number {
    switch (state.activePanel) {
      case 'tasks': return state.tasks.length;
      case 'activity': return state.activities.length;
      case 'approvals': return state.approvals.length;
      default: return 0;
    }
  }

  // ── Rendering ──

  function render(): void {
    if (destroyed) return;
    const W = process.stdout.columns || 80;
    const H = process.stdout.rows || 24;
    const MAIN_W = W - SIDEBAR_WIDTH - 1;
    const HEADER_H = 2;
    const FOOTER_H = 2;
    const CONTENT_H = H - HEADER_H - FOOTER_H;

    let buf = ansi.moveTo(1, 1);

    // ── Header ──
    const trustLabel = state.trustScore !== null
      ? `${trustColor(state.trustScore)}${state.trustScore}${ansi.reset}`
      : c(ansi.fg.gray, '--');
    const gradeLabel = state.trustGrade ? c(ansi.dim, ` (${state.trustGrade})`) : '';
    const agentLabel = c(ansi.bold + ansi.fg.brightWhite, agent.name);
    const updatedLabel = state.lastUpdate > 0
      ? c(ansi.fg.gray, `updated ${timeAgo(new Date(state.lastUpdate).toISOString())} ago`)
      : '';
    const loadingLabel = state.loading ? c(ansi.fg.cyan, ' ⟳') : '';

    const headerLeft = ` ${c(ansi.bold + ansi.fg.cyan, 'rovn')} ${c(ansi.fg.gray, '│')} ${agentLabel} ${c(ansi.fg.gray, '│')} Trust: ${trustLabel}${gradeLabel}${loadingLabel}`;
    const headerRight = updatedLabel + ' ';
    const headerPad = W - stripAnsi(headerLeft).length - stripAnsi(headerRight).length;
    buf += ansi.clearLine + c(ansi.bg.brightBlack, headerLeft + ' '.repeat(Math.max(0, headerPad)) + headerRight);

    // Header separator
    buf += ansi.moveTo(1, 2) + ansi.clearLine + c(ansi.fg.gray, hLine('─', W));

    // ── Sidebar + Content ──
    for (let row = 0; row < CONTENT_H; row++) {
      const y = HEADER_H + row + 1;
      buf += ansi.moveTo(1, y) + ansi.clearLine;

      // Sidebar
      if (row < PANELS.length) {
        const panel = PANELS[row];
        const isActive = row === state.sidebarIndex;
        const prefix = isActive ? c(ansi.fg.cyan + ansi.bold, ' ▸ ') : '   ';
        const icon = c(isActive ? ansi.fg.cyan : ansi.fg.gray, panel.icon);
        const label = isActive
          ? c(ansi.bold + ansi.fg.brightWhite, panel.label)
          : c(ansi.fg.gray, panel.label);

        // Count badges
        let badge = '';
        if (panel.key === 'tasks' && state.tasks.length > 0) {
          const active = state.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
          if (active > 0) badge = c(ansi.fg.yellow, ` ${active}`);
        }
        if (panel.key === 'approvals' && state.approvals.length > 0) {
          badge = c(ansi.fg.red, ` ${state.approvals.length}`);
        }

        buf += prefix + icon + ' ' + padRight(label + badge, SIDEBAR_WIDTH - 6);
      } else {
        buf += ' '.repeat(SIDEBAR_WIDTH);
      }

      // Border
      buf += c(ansi.fg.gray, '│');

      // Main content
      const mainLine = renderMainLine(state, row, MAIN_W, CONTENT_H);
      buf += ' ' + padRight(mainLine, MAIN_W - 1);
    }

    // ── Footer ──
    const footerY = H - FOOTER_H + 1;
    buf += ansi.moveTo(1, footerY) + ansi.clearLine + c(ansi.fg.gray, hLine('─', W));
    buf += ansi.moveTo(1, footerY + 1) + ansi.clearLine;

    const keys = [
      `${c(ansi.fg.cyan, '↑↓')} Navigate`,
      `${c(ansi.fg.cyan, 'Shift+↑↓')} Panel`,
      `${c(ansi.fg.cyan, 'Tab')} Next`,
      `${c(ansi.fg.cyan, 'r')} Refresh`,
      `${c(ansi.fg.cyan, 'q')} Quit`,
    ];
    buf += ' ' + keys.join(c(ansi.fg.gray, '  │  '));

    process.stdout.write(buf);
  }

  function renderMainLine(st: TUIState, row: number, width: number, contentH: number): string {
    if (st.error && row === 0) return c(ansi.fg.red, `✗ ${st.error}`);

    switch (st.activePanel) {
      case 'status': return renderStatusLine(st, row, width);
      case 'tasks': return renderTaskLine(st, row, width, contentH);
      case 'activity': return renderActivityLine(st, row, width, contentH);
      case 'approvals': return renderApprovalLine(st, row, width, contentH);
      case 'trust': return renderTrustLine(st, row, width);
      case 'report': return renderReportLine(st, row, width);
      default: return '';
    }
  }

  // ── Panel Renderers ──

  function renderStatusLine(st: TUIState, row: number, w: number): string {
    const lines: string[] = [];

    // Agent info card
    lines.push(c(ansi.bold + ansi.fg.brightWhite, '◉ Agent Overview'));
    lines.push('');

    // Name & ID
    lines.push(`  ${c(ansi.fg.gray, 'Name')}     ${c(ansi.bold, st.agent.name)}`);
    lines.push(`  ${c(ansi.fg.gray, 'ID')}       ${c(ansi.dim, st.agent.id)}`);
    lines.push(`  ${c(ansi.fg.gray, 'Server')}   ${c(ansi.fg.cyan, st.agent.url)}`);
    lines.push('');

    // Trust score
    if (st.trustScore !== null) {
      const score = st.trustScore;
      const barW = Math.min(30, w - 20);
      const filled = Math.round((score / 100) * barW);
      const bar = c(trustColor(score), '█'.repeat(filled)) + c(ansi.fg.gray, '░'.repeat(barW - filled));
      lines.push(`  ${c(ansi.fg.gray, 'Trust')}    ${bar} ${c(trustColor(score) + ansi.bold, String(score))}${c(ansi.fg.gray, '/100')}${st.trustGrade ? c(ansi.dim, ` ${st.trustGrade}`) : ''}`);
    } else {
      lines.push(`  ${c(ansi.fg.gray, 'Trust')}    ${c(ansi.dim, 'Loading...')}`);
    }

    lines.push('');
    lines.push(c(ansi.fg.gray, '─'.repeat(Math.min(50, w - 2))));
    lines.push('');

    // Quick stats
    const tasksPending = st.tasks.filter(t => t.status === 'pending').length;
    const tasksInProgress = st.tasks.filter(t => t.status === 'in_progress').length;
    const pendingApprovals = st.approvals.length;

    lines.push(`  ${c(ansi.fg.cyan, '☰')} Tasks       ${c(ansi.fg.yellow, String(tasksInProgress))} in progress  ${c(ansi.fg.gray, String(tasksPending))} pending`);
    lines.push(`  ${c(ansi.fg.cyan, '◎')} Approvals   ${pendingApprovals > 0 ? c(ansi.fg.red, `${pendingApprovals} pending`) : c(ansi.fg.green, 'None pending')}`);
    lines.push(`  ${c(ansi.fg.cyan, '⚡')} Activities  ${c(ansi.fg.gray, `${st.activities.length} recent`)}`);

    lines.push('');
    lines.push(c(ansi.fg.gray, '─'.repeat(Math.min(50, w - 2))));
    lines.push('');

    // Last activity
    if (st.activities.length > 0) {
      const last = st.activities[0];
      lines.push(`  ${c(ansi.fg.gray, 'Latest')}   ${truncate(last.title, w - 20)} ${c(ansi.dim, timeAgo(last.created_at))}`);
    }

    return row < lines.length ? lines[row] : '';
  }

  function renderTaskLine(st: TUIState, row: number, w: number, contentH: number): string {
    const items = st.tasks;
    if (items.length === 0 && row === 0) return c(ansi.dim, 'No tasks assigned.');
    if (items.length === 0) return '';

    // Header
    if (row === 0) {
      return c(ansi.bold + ansi.fg.brightWhite, `☰ Tasks (${items.length})`);
    }
    if (row === 1) return '';

    const idx = row - 2;

    // Adjust scroll
    const viewH = contentH - 2;
    if (st.listIndex >= st.scrollOffset + viewH) st.scrollOffset = st.listIndex - viewH + 1;
    if (st.listIndex < st.scrollOffset) st.scrollOffset = st.listIndex;

    const dataIdx = idx + st.scrollOffset;
    if (dataIdx >= items.length) return '';

    const task = items[dataIdx];
    const isSelected = dataIdx === st.listIndex;
    const pointer = isSelected ? c(ansi.fg.cyan + ansi.bold, '▸ ') : '  ';
    const status = c(statusColor(task.status), `[${task.status}]`);
    const subject = truncate(task.subject, w - 30);
    const highlight = isSelected ? ansi.bold : '';

    return `${pointer}${status} ${c(highlight, subject)}`;
  }

  function renderActivityLine(st: TUIState, row: number, w: number, contentH: number): string {
    const items = st.activities;
    if (items.length === 0 && row === 0) return c(ansi.dim, 'No recent activities.');
    if (items.length === 0) return '';

    if (row === 0) {
      return c(ansi.bold + ansi.fg.brightWhite, `⚡ Activities (${items.length})`);
    }
    if (row === 1) return '';

    const idx = row - 2;
    const viewH = contentH - 2;
    if (st.listIndex >= st.scrollOffset + viewH) st.scrollOffset = st.listIndex - viewH + 1;
    if (st.listIndex < st.scrollOffset) st.scrollOffset = st.listIndex;

    const dataIdx = idx + st.scrollOffset;
    if (dataIdx >= items.length) return '';

    const act = items[dataIdx];
    const isSelected = dataIdx === st.listIndex;
    const pointer = isSelected ? c(ansi.fg.cyan + ansi.bold, '▸ ') : '  ';
    const icon = activityIcon(act.type);
    const time = c(ansi.fg.gray, timeAgo(act.created_at));
    const title = truncate(act.title, w - 20);
    const highlight = isSelected ? ansi.bold : '';

    let line = `${pointer}${c(ansi.fg.cyan, icon)} ${c(highlight, title)} ${time}`;

    // Show description for selected item on next line
    if (isSelected && act.description && idx + 1 < viewH) {
      // We'll just show it inline with dimmed text
    }

    return line;
  }

  function renderApprovalLine(st: TUIState, row: number, w: number, contentH: number): string {
    const items = st.approvals;
    if (items.length === 0 && row === 0) return c(ansi.dim, 'No pending approvals. ✓');
    if (items.length === 0) return '';

    if (row === 0) {
      return c(ansi.bold + ansi.fg.brightWhite, `◎ Pending Approvals (${items.length})`);
    }
    if (row === 1) return '';

    const idx = row - 2;
    const viewH = contentH - 2;
    if (st.listIndex >= st.scrollOffset + viewH) st.scrollOffset = st.listIndex - viewH + 1;
    if (st.listIndex < st.scrollOffset) st.scrollOffset = st.listIndex;

    const dataIdx = idx + st.scrollOffset;
    if (dataIdx >= items.length) return '';

    const appr = items[dataIdx];
    const isSelected = dataIdx === st.listIndex;
    const pointer = isSelected ? c(ansi.fg.cyan + ansi.bold, '▸ ') : '  ';
    const urg = c(urgencyColor(appr.urgency), `[${appr.urgency}]`);
    const title = truncate(appr.title, w - 30);
    const type = appr.type ? c(ansi.dim, ` (${appr.type})`) : '';
    const highlight = isSelected ? ansi.bold : '';

    return `${pointer}${urg} ${c(highlight, title)}${type}`;
  }

  function renderTrustLine(st: TUIState, row: number, w: number): string {
    const lines: string[] = [];

    lines.push(c(ansi.bold + ansi.fg.brightWhite, '♦ Trust Score'));
    lines.push('');

    if (st.trustScore !== null) {
      const score = st.trustScore;
      const barW = Math.min(40, w - 15);
      const filled = Math.round((score / 100) * barW);
      const clr = trustColor(score);

      // Big score display
      lines.push(`  ${c(clr + ansi.bold, String(score))}${c(ansi.fg.gray, ' / 100')}`);
      lines.push(`  ${c(clr, '█'.repeat(filled))}${c(ansi.fg.gray, '░'.repeat(barW - filled))}`);
      lines.push('');

      if (st.trustGrade) {
        lines.push(`  ${c(ansi.fg.gray, 'Grade')}  ${c(clr + ansi.bold, st.trustGrade)}`);
      }

      // Level label
      let level = 'Unknown';
      if (score >= 90) level = 'Excellent';
      else if (score >= 75) level = 'Very Good';
      else if (score >= 60) level = 'Good';
      else if (score >= 40) level = 'Fair';
      else if (score >= 20) level = 'Low';
      else level = 'Critical';
      lines.push(`  ${c(ansi.fg.gray, 'Level')}  ${c(clr, level)}`);

      lines.push('');
      lines.push(c(ansi.fg.gray, '─'.repeat(Math.min(50, w - 2))));
      lines.push('');

      // Scale reference
      lines.push(c(ansi.dim, '  Score scale:'));
      lines.push(`  ${c(ansi.fg.green, '█')} 80-100 Excellent   ${c(ansi.fg.brightGreen, '█')} 60-79 Good`);
      lines.push(`  ${c(ansi.fg.yellow, '█')} 40-59  Fair        ${c(ansi.fg.red, '█')} 0-39  Needs work`);
    } else {
      lines.push(c(ansi.dim, '  Loading trust score...'));
    }

    return row < lines.length ? lines[row] : '';
  }

  function renderReportLine(st: TUIState, row: number, w: number): string {
    const lines: string[] = [];

    lines.push(c(ansi.bold + ansi.fg.brightWhite, '□ Report Card (7 days)'));
    lines.push('');

    if (st.reportCard) {
      const rc = st.reportCard;
      const grades = rc.grades ?? {};
      const gradeEntries = Object.entries(grades);

      if (gradeEntries.length > 0) {
        for (const [category, grade] of gradeEntries) {
          const gradeVal = gradeToNumber(grade as string);
          const barW = Math.min(20, w - 30);
          const filled = Math.round((gradeVal / 10) * barW);
          const clr = gradeVal >= 7 ? ansi.fg.green : gradeVal >= 4 ? ansi.fg.yellow : ansi.fg.red;
          const bar = c(clr, '█'.repeat(filled)) + c(ansi.fg.gray, '░'.repeat(barW - filled));
          const label = padRight(c(ansi.fg.gray, category), 18);
          lines.push(`  ${label} ${bar} ${c(clr + ansi.bold, grade as string)}`);
        }
      }

      lines.push('');
      lines.push(c(ansi.fg.gray, '─'.repeat(Math.min(50, w - 2))));
      lines.push('');

      // Recommendations
      const recs = rc.recommendations ?? [];
      if (recs.length > 0) {
        lines.push(c(ansi.bold, '  Recommendations'));
        for (const rec of recs) {
          lines.push(`  ${c(ansi.fg.cyan, '→')} ${truncate(rec, w - 6)}`);
        }
      }
    } else {
      lines.push(c(ansi.dim, '  Loading report card...'));
    }

    return row < lines.length ? lines[row] : '';
  }

  function gradeToNumber(grade: string): number {
    const map: Record<string, number> = {
      'A+': 10, 'A': 9, 'A-': 8.5,
      'B+': 8, 'B': 7, 'B-': 6,
      'C+': 5, 'C': 4, 'C-': 3,
      'D+': 2, 'D': 1.5, 'D-': 1,
      'F': 0,
    };
    return map[grade] ?? 5;
  }

  // ── Start ──

  setup();

  process.stdin.on('keypress', handleKey);
  process.stdout.on('resize', () => { if (!destroyed) render(); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('exit', () => { cleanup(); });

  // Initial fetch
  await fetchAll();

  // Poll loop
  pollTimer = setInterval(() => {
    if (!destroyed) fetchAll();
  }, POLL_INTERVAL_MS);

  // Keep alive
  await new Promise<void>(() => {});
}
