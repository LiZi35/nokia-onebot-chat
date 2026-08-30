export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  private readonly threshold: number;

  constructor(level: LogLevel = 'info') {
    this.threshold = LEVELS[level];
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log('debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.log('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.log('error', msg, meta);
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVELS[level] < this.threshold) return;
    const line = meta && Object.keys(meta).length > 0 ? `${msg} ${safeJson(meta)}` : msg;
    const out = `${new Date().toISOString()} [${level.toUpperCase()}] ${line}`;
    if (level === 'error') {
      console.error(out);
    } else {
      console.log(out);
    }
  }
}

function safeJson(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return '[unserializable meta]';
  }
}

export const logger = new Logger((process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info');
