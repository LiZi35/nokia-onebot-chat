import { describe, it, expect } from 'vitest';
import {
  MessageStore,
  buildSessionKey,
  parseSessionKey,
  type MessageRecord,
} from '../src/domain/message-store.js';

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

describe('buildSessionKey / parseSessionKey', () => {
  it('round trips', () => {
    const key = buildSessionKey('group', 42);
    expect(key).toBe('group:42');
    expect(parseSessionKey(key)).toEqual({ type: 'group', peerId: 42 });
  });

  it('rejects malformed keys', () => {
    expect(parseSessionKey('')).toBeNull();
    expect(parseSessionKey('private')).toBeNull();
    expect(parseSessionKey('bad:123')).toBeNull();
    expect(parseSessionKey('private:abc')).toBeNull();
  });
});

describe('MessageStore', () => {
  it('adds and retrieves messages in order', () => {
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 });
    store.add(record({ messageId: 1, text: 'one' }));
    store.add(record({ messageId: 2, text: 'two' }));
    expect(store.getMessages('private:100').map((m) => m.text)).toEqual(['one', 'two']);
  });

  it('dedupes by message id', () => {
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 });
    store.add(record({ messageId: 5, text: 'first' }));
    store.add(record({ messageId: 5, text: 'dup' }));
    expect(store.getMessages('private:100')).toHaveLength(1);
    expect(store.getMessages('private:100')[0]?.text).toBe('first');
  });

  it('caps messages per session keeping the most recent', () => {
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 3 });
    for (let i = 1; i <= 6; i++) {
      store.add(record({ messageId: i, text: `m${i}` }));
    }
    expect(store.getMessages('private:100').map((m) => m.text)).toEqual(['m4', 'm5', 'm6']);
  });

  it('evicts the least recently used session beyond the cap', () => {
    const store = new MessageStore({ maxSessions: 2, messagesPerSession: 10 });
    store.add(record({ sessionKey: 'private:1', messageId: 1 }));
    store.add(record({ sessionKey: 'private:2', messageId: 2 }));
    store.add(record({ sessionKey: 'private:3', messageId: 3 }));
    expect(store.sessionCount).toBe(2);
    expect(store.getMessages('private:1')).toHaveLength(0);
    expect(store.getMessages('private:3')).toHaveLength(1);
  });

  it('summarizes sessions with last activity first', () => {
    const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 });
    store.add(record({ sessionKey: 'private:1', messageId: 1, text: 'a' }));
    store.add(record({ sessionKey: 'private:2', messageId: 2, text: 'b' }));
    store.add(record({ sessionKey: 'private:1', messageId: 3, text: 'c' }));
    const summaries = store.getSessionSummaries();
    expect(summaries[0]?.sessionKey).toBe('private:1');
    expect(summaries[0]?.lastMessage?.text).toBe('c');
  });
});
