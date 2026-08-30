import type Database from 'better-sqlite3';

export interface SessionStore {
  get(key: string): Promise<object | null>;
  set(key: string, sess: object): Promise<void>;
  destroy(key: string): Promise<void>;
}

interface StoredSession {
  _expire?: number;
  [key: string]: unknown;
}

/**
 * 基于 SQLite 的 koa-session 存储，用于持久化登录态、CSRF 令牌与会话数据。
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async get(key: string): Promise<object | null> {
    const row = this.db.prepare('SELECT data FROM sessions WHERE sid = ?').get(key) as
      { data: string } | undefined;
    if (!row) return null;

    let data: StoredSession;
    try {
      data = JSON.parse(row.data) as StoredSession;
    } catch {
      return null;
    }

    if (typeof data._expire === 'number' && data._expire < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(key);
      return null;
    }
    return data;
  }

  async set(key: string, sess: object): Promise<void> {
    const data = sess as StoredSession;
    const expiresAt = typeof data._expire === 'number' ? data._expire : null;
    this.db
      .prepare(
        `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
      )
      .run(key, JSON.stringify(sess), expiresAt);
  }

  async destroy(key: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(key);
  }
}
