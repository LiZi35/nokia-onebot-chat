import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { SqliteMessageRepository } from '../src/db/message-repository.js';
import { SqliteSessionStore } from '../src/db/session-store.js';
import { MessageStore, type MessageRecord } from '../src/domain/message-store.js';

function record(partial: Partial<MessageRecord>): MessageRecord {
  return {
    messageId: 1,
    sessionKey: 'private:100',
    type: 'private',
    senderId: 100,
    senderName: 'a',
    text: 'x',
    time: 1,
    self: false,
    ...partial,
  };
}

describe('SqliteMessageRepository', () => {
  it('saves and lists recent messages in order', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    repo.save(record({ sessionKey: 'private:100', messageId: 1, text: 'one' }), 10);
    repo.save(record({ sessionKey: 'private:100', messageId: 2, text: 'two' }), 10);

    const recent = repo.listRecent('private:100', 10);
    expect(recent.map((m) => m.text)).toEqual(['one', 'two']);
    expect(repo.listSessionKeys()).toEqual(['private:100']);
    db.close();
  });

  it('prunes old messages beyond the keep limit', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    for (let i = 1; i <= 5; i++) {
      repo.save(record({ sessionKey: 'private:100', messageId: i, text: `m${i}` }), 3);
    }
    const recent = repo.listRecent('private:100', 10);
    expect(recent.map((m) => m.text)).toEqual(['m3', 'm4', 'm5']);
    expect(repo.countMessages()).toBe(3);
    db.close();
  });

  it('round-trips record fields', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    repo.save(
      record({
        sessionKey: 'group:9',
        type: 'group',
        messageId: 42,
        senderId: 7,
        senderName: '张三',
        text: '你好',
        time: 12345,
        self: true,
      }),
      10,
    );
    const [m] = repo.listRecent('group:9', 10);
    expect(m).toMatchObject({
      messageId: 42,
      sessionKey: 'group:9',
      type: 'group',
      senderId: 7,
      senderName: '张三',
      text: '你好',
      time: 12345,
      self: true,
    });
    db.close();
  });
});

describe('MessageStore with persistence', () => {
  it('persists new messages and survives a store rebuild', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 }, repo);
    store.add(record({ sessionKey: 'private:100', messageId: 1, text: 'hello' }));
    store.add(record({ sessionKey: 'private:100', messageId: 2, text: 'world' }));

    const store2 = new MessageStore({ maxSessions: 10, messagesPerSession: 10 }, repo);
    expect(store2.getMessages('private:100').map((m) => m.text)).toEqual(['hello', 'world']);
    db.close();
  });

  it('lazy-loads a session from persistence on demand', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    repo.save(record({ sessionKey: 'group:5', messageId: 9, text: 'lazy' }), 10);
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 }, repo);
    // group:5 was not loaded into memory (no matching in-memory session), but
    // getMessages triggers a lazy load from the repository.
    expect(store.getMessages('group:5').map((m) => m.text)).toEqual(['lazy']);
    db.close();
  });

  it('dedupes duplicates on add but not on load', () => {
    const db = openDatabase(':memory:');
    const repo = new SqliteMessageRepository(db);
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 }, repo);
    store.add(record({ sessionKey: 'private:1', messageId: 5, text: 'first' }));
    store.add(record({ sessionKey: 'private:1', messageId: 5, text: 'dup' }));
    expect(store.getMessages('private:1')).toHaveLength(1);
    expect(store.getMessages('private:1')[0]?.text).toBe('first');
    db.close();
  });
});

describe('SqliteSessionStore', () => {
  it('stores and retrieves session data', async () => {
    const db = openDatabase(':memory:');
    const store = new SqliteSessionStore(db);
    await store.set('sid-1', { _expire: Date.now() + 60000, authenticated: true });
    const data = await store.get('sid-1');
    expect(data).toMatchObject({ authenticated: true });
    db.close();
  });

  it('returns null for missing sessions', async () => {
    const db = openDatabase(':memory:');
    const store = new SqliteSessionStore(db);
    expect(await store.get('nope')).toBeNull();
    db.close();
  });

  it('expires and cleans up expired sessions', async () => {
    const db = openDatabase(':memory:');
    const store = new SqliteSessionStore(db);
    await store.set('sid-1', { _expire: Date.now() - 1000, authenticated: true });
    expect(await store.get('sid-1')).toBeNull();
    const row = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(row.n).toBe(0);
    db.close();
  });

  it('destroys sessions', async () => {
    const db = openDatabase(':memory:');
    const store = new SqliteSessionStore(db);
    await store.set('sid-1', { _expire: Date.now() + 60000 });
    await store.destroy('sid-1');
    expect(await store.get('sid-1')).toBeNull();
    db.close();
  });
});
