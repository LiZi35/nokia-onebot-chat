export type ChatType = 'private' | 'group';

export interface MessageRecord {
  messageId: number;
  sessionKey: string;
  type: ChatType;
  senderId: number;
  senderName: string;
  text: string;
  time: number;
  self: boolean;
}

export interface SessionSummary {
  sessionKey: string;
  type: ChatType;
  peerId: number;
  name: string;
  lastMessage: MessageRecord | null;
  messageCount: number;
}

export function buildSessionKey(type: ChatType, peerId: number): string {
  return `${type}:${peerId}`;
}

export function parseSessionKey(key: string): { type: ChatType; peerId: number } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  if (type !== 'private' && type !== 'group') return null;
  const peerId = Number(key.slice(idx + 1));
  if (!Number.isSafeInteger(peerId) || peerId <= 0) return null;
  return { type, peerId };
}

export interface MessageStoreOptions {
  maxSessions: number;
  messagesPerSession: number;
}

/**
 * 消息持久化接口，由 SQLite 等后端实现；单元测试可注入内存替身或不注入（纯内存）。
 */
export interface MessagePersistence {
  save(record: MessageRecord, keep: number): void;
  listRecent(sessionKey: string, limit: number): MessageRecord[];
  listSessionKeys(): string[];
}

/**
 * 消息与会话存储：内存缓存带容量上限与 LRU 淘汰，可选用持久化后端保存聊天记录。
 */
export class MessageStore {
  private readonly messages = new Map<string, MessageRecord[]>();
  private readonly order: string[] = [];
  private readonly maxSessions: number;
  private readonly messagesPerSession: number;
  private readonly persistence: MessagePersistence | null;

  constructor(options: MessageStoreOptions, persistence?: MessagePersistence) {
    this.maxSessions = options.maxSessions;
    this.messagesPerSession = options.messagesPerSession;
    this.persistence = persistence ?? null;
    if (this.persistence) {
      this.loadFromPersistence();
    }
  }

  add(record: MessageRecord): void {
    if (this.insertIntoMemory(record, true)) {
      this.persistence?.save(record, this.messagesPerSession);
    }
  }

  getMessages(sessionKey: string, limit?: number): MessageRecord[] {
    this.ensureLoaded(sessionKey);
    const list = this.messages.get(sessionKey);
    if (!list) return [];
    if (limit === undefined || limit <= 0) return [...list];
    return list.slice(Math.max(0, list.length - limit));
  }

  getSessionSummaries(): SessionSummary[] {
    const result: SessionSummary[] = [];
    for (const key of [...this.order].reverse()) {
      const list = this.messages.get(key);
      const last = list && list.length > 0 ? list[list.length - 1] : undefined;
      const parsed = parseSessionKey(key);
      if (!parsed) continue;
      result.push({
        sessionKey: key,
        type: parsed.type,
        peerId: parsed.peerId,
        name: last?.senderName ?? parsed.peerId.toString(),
        lastMessage: last ?? null,
        messageCount: list?.length ?? 0,
      });
    }
    return result;
  }

  get sessionCount(): number {
    return this.messages.size;
  }

  private loadFromPersistence(): void {
    const keys = this.persistence?.listSessionKeys() ?? [];
    for (const key of keys) {
      const records = this.persistence?.listRecent(key, this.messagesPerSession) ?? [];
      for (const record of records) {
        this.insertIntoMemory(record, false);
      }
    }
  }

  private ensureLoaded(sessionKey: string): void {
    if (this.messages.has(sessionKey) || !this.persistence) return;
    const records = this.persistence.listRecent(sessionKey, this.messagesPerSession);
    for (const record of records) {
      this.insertIntoMemory(record, false);
    }
  }

  private insertIntoMemory(record: MessageRecord, dedupe: boolean): boolean {
    let list = this.messages.get(record.sessionKey);
    if (!list) {
      list = [];
      this.messages.set(record.sessionKey, list);
      this.order.push(record.sessionKey);
    }

    if (dedupe && list.some((m) => m.messageId === record.messageId)) {
      return false;
    }

    list.push(record);
    if (list.length > this.messagesPerSession) {
      list.splice(0, list.length - this.messagesPerSession);
    }

    this.touch(record.sessionKey);
    this.evictIfNeeded();
    return true;
  }

  private touch(sessionKey: string): void {
    const idx = this.order.indexOf(sessionKey);
    if (idx >= 0) this.order.splice(idx, 1);
    this.order.push(sessionKey);
  }

  private evictIfNeeded(): void {
    while (this.messages.size > this.maxSessions && this.order.length > 0) {
      const oldest = this.order.shift();
      if (oldest === undefined) break;
      this.messages.delete(oldest);
    }
  }
}
