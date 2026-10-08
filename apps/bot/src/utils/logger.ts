/**
 * Structured logger.
 *
 * Emits single-line JSON in production (easy to ship to a log aggregator) and
 * readable lines in development. Every value passes through a redactor so a
 * token accidentally placed in a message never reaches the log stream.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'bot token', pattern: /\b[MNO][A-Za-z\d_-]{23,}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,}\b/g },
  { label: 'bearer token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  { label: 'key=value secret', pattern: /\b(token|secret|password|api[_-]?key)\s*[=:]\s*\S+/gi },
  { label: 'connection string', pattern: /\bpostgres(?:ql)?:\/\/[^\s]+/gi },
];

export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    let out = input;
    for (const { label, pattern } of SECRET_PATTERNS) {
      out = out.replace(pattern, `[redacted:${label}]`);
    }
    return out;
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = redact(value);
    }
    return out;
  }
  return input;
}

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  bindings?: Record<string, unknown>;
}

/**
 * Process-wide counters. Module level because `child()` creates new instances and
 * a per-instance counter would miss every scoped logger.
 */
const LOG_COUNTERS: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

/** Snapshot of how many lines were logged at each level since boot. */
export function logStats(): Record<LogLevel, number> {
  return { ...LOG_COUNTERS };
}

export class Logger {
  private readonly level: LogLevel;
  private readonly json: boolean;
  private readonly bindings: Record<string, unknown>;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
    this.json = options.json ?? process.env.NODE_ENV === 'production';
    this.bindings = options.bindings ?? {};
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      level: this.level,
      json: this.json,
      bindings: { ...this.bindings, ...bindings },
    });
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    this.write('debug', message, extra);
  }
  info(message: string, extra?: Record<string, unknown>): void {
    this.write('info', message, extra);
  }
  warn(message: string, extra?: Record<string, unknown>): void {
    this.write('warn', message, extra);
  }
  error(message: string, extra?: Record<string, unknown>): void {
    this.write('error', message, extra);
  }

  private write(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    // Counted before the level filter: an error happened even if the console
    // level hides it.
    LOG_COUNTERS[level] += 1;
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const payload = redact({ ...this.bindings, ...extra }) as Record<string, unknown>;
    const timestamp = new Date().toISOString();
    if (this.json) {
      const line = JSON.stringify({ timestamp, level, message, ...payload });
      process.stdout.write(`${line}\n`);
      return;
    }
    const details = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : '';
    process.stdout.write(`[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${details}\n`);
  }
}

/**
 * Rate-limited logger for hot paths, so a repeating error cannot flood the
 * stream. Identical (scope, message) pairs log at most once per window.
 */
export class ThrottledLogger {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly windowMs = 60_000,
  ) {}

  warn(scope: string, message: string, extra?: Record<string, unknown>): void {
    const key = `${scope}:${message}`;
    const last = this.seen.get(key) ?? 0;
    const now = Date.now();
    if (now - last < this.windowMs) return;
    this.seen.set(key, now);
    this.logger.warn(message, { scope, ...extra });
    if (this.seen.size > 500) {
      // Bound memory: drop the oldest half of the window.
      const cutoff = now - this.windowMs;
      for (const [k, t] of this.seen) if (t < cutoff) this.seen.delete(k);
    }
  }
}
