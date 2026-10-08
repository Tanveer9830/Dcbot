/** Duration parsing/formatting helpers shared by reminders, timeouts and music. */

const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parses "1h30m", "45s", "2d" into milliseconds. Returns null when invalid. */
export function parseDuration(input: string): number | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  // Plain number is treated as seconds.
  if (/^\d+$/.test(normalized)) return Number(normalized) * 1000;
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d|w)/g)];
  if (matches.length === 0) return null;
  let total = 0;
  for (const match of matches) {
    const value = Number(match[1]);
    const unit = match[2]!;
    if (unit === 'ms') {
      total += value;
      continue;
    }
    const multiplier = UNITS[unit];
    if (!multiplier) return null;
    total += value * multiplier;
  }
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.floor(total);
}

/** Formats ms as "1h 30m 5s", dropping zero components. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const parts: string[] = [];
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

/** Discord message timestamp formatting. */
export function discordTimestamp(
  date: Date,
  style: 't' | 'T' | 'd' | 'D' | 'R' | 'f' | 'F' = 'R',
): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Truncates text for safe display inside embeds. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Formats a byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[exponent]}`;
}

/** Comma-groups a number for leaderboards. */
export function formatNumber(value: number): string {
  return Math.trunc(value).toLocaleString('en-US');
}

/** Bar chart string for rank cards, e.g. ▰▰▰▱▱▱▱▱▱▱ */
export function progressBar(percent: number, length = 10): string {
  const clamped = Math.max(0, Math.min(1, percent));
  const filled = Math.round(clamped * length);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, length - filled));
}
