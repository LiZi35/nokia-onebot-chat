import type Database from 'better-sqlite3';
import type { MessagePersistence, MessageRecord } from '../domain/message-store.js';

interface MessageRow {
  message_id: number;
  session_key: string;
  type: string;
  sender_id: number;
  sender_name: string;
  text: string;
  time: number;
  self: number;
}

/**
 * 基于 SQLite 的聊天记录存储。每个会话仅保留最近 `keep` 条消息，防止无限增长。
 */
export class SqliteMessageRepository implements MessagePersistence {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  save(record: MessageRecord, keep: number): void {
    const insert = this.db.prepare(
      `INSERT INTO messages
         (message_id, session_key, type, sender_id, sender_name, text, time, self)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const prune = this.db.prepare(
      `DELETE FROM messages
       WHERE session_key = ? AND id NOT IN (
         SELECT id FROM messages WHERE session_key = ? ORDER BY id DESC LIMIT ?
       )`,
    );

    const tx = this.db.transaction(() => {
      insert.run(
        record.messageId,
        record.sessionKey,
        record.type,
        record.senderId,
        record.senderName,
        record.text,
        record.time,
        record.self ? 1 : 0,
      );
      prune.run(record.sessionKey, record.sessionKey, keep);
    });
    tx();
  }

  listRecent(sessionKey: string, limit: number): MessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT message_id, session_key, type, sender_id, sender_name, text, time, self
         FROM (
           SELECT * FROM messages WHERE session_key = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id ASC`,
      )
      .all(sessionKey, limit) as MessageRow[];

    return rows.map((row) => ({
      messageId: row.message_id,
      sessionKey: row.session_key,
      type: row.type === 'group' ? 'group' : 'private',
      senderId: row.sender_id,
      senderName: row.sender_name,
      text: row.text,
      time: row.time,
      self: row.self === 1,
    }));
  }

  listSessionKeys(): string[] {
    const rows = this.db
      .prepare(`SELECT session_key FROM messages GROUP BY session_key ORDER BY MAX(id) ASC`)
      .all() as Array<{ session_key: string }>;
    return rows.map((r) => r.session_key);
  }

  countMessages(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    return row.n;
  }
}
