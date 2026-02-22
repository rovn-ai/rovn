// ─── Terminal Formatting ─────────────────────────────────

const NO_COLOR = !!process.env.NO_COLOR || !process.stdout.isTTY;

const RESET = NO_COLOR ? '' : '\x1b[0m';
const BOLD = NO_COLOR ? '' : '\x1b[1m';
const DIM = NO_COLOR ? '' : '\x1b[2m';
const GREEN = NO_COLOR ? '' : '\x1b[32m';
const YELLOW = NO_COLOR ? '' : '\x1b[33m';
const RED = NO_COLOR ? '' : '\x1b[31m';
const CYAN = NO_COLOR ? '' : '\x1b[36m';
const BLUE = NO_COLOR ? '' : '\x1b[34m';
const MAGENTA = NO_COLOR ? '' : '\x1b[35m';
const WHITE = NO_COLOR ? '' : '\x1b[37m';
const BG_GREEN = NO_COLOR ? '' : '\x1b[42m';
const BG_RED = NO_COLOR ? '' : '\x1b[41m';
const BG_YELLOW = NO_COLOR ? '' : '\x1b[43m';
const BG_BLUE = NO_COLOR ? '' : '\x1b[44m';

export const fmt = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  bgGreen: (s: string) => `${BG_GREEN}${BOLD}${s}${RESET}`,
  bgRed: (s: string) => `${BG_RED}${BOLD}${s}${RESET}`,
  bgYellow: (s: string) => `${BG_YELLOW}${BOLD}${s}${RESET}`,
  bgBlue: (s: string) => `${BG_BLUE}${BOLD}${s}${RESET}`,
};

// ─── Symbols ─────────────────────────────────────────────

export const symbols = {
  check: '\u2713',
  cross: '\u2717',
  arrow: '\u2192',
  dot: '\u25CF',
  info: '\u2139',
  warning: '\u26A0',
  bullet: '\u2022',
};

// ─── ANSI Helpers ────────────────────────────────────────

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

// ─── Table ───────────────────────────────────────────────

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map(r => visibleLength(r[i] ?? '')))
  );

  function pad(s: string, width: number): string {
    const diff = width - visibleLength(s);
    return s + ' '.repeat(Math.max(0, diff));
  }

  const sep = widths.map(w => '\u2500'.repeat(w + 2)).join('\u253C');
  const headerRow = headers.map((h, i) => ` ${pad(h, widths[i])} `).join('\u2502');
  const dataRows = rows.map(row =>
    row.map((cell, i) => ` ${pad(cell ?? '', widths[i])} `).join('\u2502')
  );

  return [
    `\u250C${widths.map(w => '\u2500'.repeat(w + 2)).join('\u252C')}\u2510`,
    `\u2502${headerRow}\u2502`,
    `\u251C${sep}\u2524`,
    ...dataRows.map(r => `\u2502${r}\u2502`),
    `\u2514${widths.map(w => '\u2500'.repeat(w + 2)).join('\u2534')}\u2518`,
  ].join('\n');
}

// ─── Time ────────────────────────────────────────────────

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ─── Spinner ─────────────────────────────────────────────

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

export function spinner(text: string): { stop: (finalText?: string) => void } {
  if (NO_COLOR || !process.stderr.isTTY) {
    process.stderr.write(`${text}\n`);
    return { stop: (finalText?: string) => { if (finalText) process.stderr.write(`${finalText}\n`); } };
  }

  let frame = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r\x1b[K  ${CYAN}${SPINNER_FRAMES[frame]}${RESET} ${text}`);
    frame = (frame + 1) % SPINNER_FRAMES.length;
  }, 80);

  return {
    stop(finalText?: string) {
      clearInterval(interval);
      process.stderr.write('\r\x1b[K');
      if (finalText) process.stderr.write(`  ${finalText}\n`);
    },
  };
}

// ─── Box ─────────────────────────────────────────────────

export function box(lines: string[], title?: string): string {
  const maxWidth = Math.max(
    ...(title ? [visibleLength(title) + 2] : []),
    ...lines.map(l => visibleLength(l))
  );
  const w = maxWidth + 2; // padding inside box

  const topTitle = title
    ? `\u250C\u2500 ${fmt.bold(title)} ${'─'.repeat(Math.max(0, w - visibleLength(title) - 2))}\u2510`
    : `\u250C${'─'.repeat(w)}\u2510`;

  const bottom = `\u2514${'─'.repeat(w)}\u2518`;

  const body = lines.map(line => {
    const padding = w - visibleLength(line) - 1;
    return `\u2502 ${line}${' '.repeat(Math.max(0, padding))}\u2502`;
  });

  return [topTitle, ...body, bottom].join('\n');
}

// ─── Badge ───────────────────────────────────────────────

export function badge(text: string, color: 'green' | 'red' | 'yellow' | 'blue' | 'cyan' | 'magenta' | 'dim' = 'dim'): string {
  const colorFn = color === 'dim' ? fmt.dim : fmt[color];
  return colorFn(`[${text}]`);
}

// ─── Section Header ──────────────────────────────────────

export function header(title: string): string {
  return `\n${fmt.bold(title)}\n`;
}

// ─── Empty State ─────────────────────────────────────────

export function emptyState(message: string, hint?: string): string {
  let out = `\n  ${fmt.dim(message)}`;
  if (hint) out += `\n  ${fmt.dim(`${symbols.arrow} ${hint}`)}`;
  return out + '\n';
}

// ─── Success / Error ─────────────────────────────────────

export function success(msg: string): string {
  return `  ${fmt.green(symbols.check)} ${msg}`;
}

export function error(msg: string, hint?: string): string {
  let out = `  ${fmt.red(symbols.cross)} ${msg}`;
  if (hint) out += `\n  ${fmt.dim(`${symbols.arrow} ${hint}`)}`;
  return out;
}
