import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(dbPath: string): Database.Database {
  let db: Database.Database;
  if (dbPath === ':memory:') {
    db = new Database(':memory:');
  } else {
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });
    db = new Database(resolved);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_key TEXT NOT NULL,
      type TEXT NOT NULL,
      sender_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      time INTEGER NOT NULL,
      self INTEGER NOT NULL DEFAULT 0,
      image_urls TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, id DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // 旧版本数据库的 messages 表没有 image_urls 列，启动时补上。
  ensureColumn(db, 'messages', 'image_urls', 'TEXT');
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
