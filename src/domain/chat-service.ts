import type { FriendInfo, GroupInfo, OneBotMessageEvent } from '../onebot/types.js';
import type { OneBotClient } from '../onebot/client.js';
import { extractMessageText, resolveSenderName } from '../onebot/message-format.js';
import type { Logger } from '../logger.js';
import {
  MessageStore,
  buildSessionKey,
  type ChatType,
  type MessageRecord,
  type SessionSummary,
} from './message-store.js';

export interface ChatServiceOptions {
  client: OneBotClient;
  store: MessageStore;
  logger: Logger;
  messageMaxLength: number;
}

export interface Directory {
  friends: FriendInfo[];
  groups: GroupInfo[];
}

export interface SendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export class ChatService {
  private readonly client: OneBotClient;
  private readonly store: MessageStore;
  private readonly logger: Logger;
  private readonly messageMaxLength: number;
  private selfId = 0;
  private directory: Directory = { friends: [], groups: [] };
  private unsubscribe: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;

  constructor(options: ChatServiceOptions) {
    this.client = options.client;
    this.store = options.store;
    this.logger = options.logger;
    this.messageMaxLength = options.messageMaxLength;
  }

  start(): void {
    this.unsubscribe = this.client.onMessage((event) => this.handleMessageEvent(event));
    this.unsubscribeState = this.client.onStateChange((state) => {
      if (state === 'connected') {
        void this.refreshDirectory();
      }
    });
    this.client.connect();
    if (this.client.getState() === 'connected') {
      void this.refreshDirectory();
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.client.close();
  }

  getConnectionState(): string {
    return this.client.getState();
  }

  getSelfId(): number {
    return this.selfId;
  }

  getDirectory(): Directory {
    return {
      friends: [...this.directory.friends],
      groups: [...this.directory.groups],
    };
  }

  async refreshDirectory(): Promise<void> {
    await this.refreshLoginInfo();
    const [friends, groups] = await Promise.allSettled([
      this.client.sendApi<FriendInfo[]>('get_friend_list', {}),
      this.client.sendApi<GroupInfo[]>('get_group_list', {}),
    ]);

    if (friends.status === 'fulfilled' && Array.isArray(friends.value)) {
      this.directory.friends = friends.value.filter((f) => typeof f.user_id === 'number');
    } else {
      this.logger.warn('获取好友列表失败');
    }

    if (groups.status === 'fulfilled' && Array.isArray(groups.value)) {
      this.directory.groups = groups.value.filter((g) => typeof g.group_id === 'number');
    } else {
      this.logger.warn('获取群列表失败');
    }
  }

  getSessions(): SessionSummary[] {
    const summaries = this.store.getSessionSummaries();
    for (const summary of summaries) {
      summary.name = this.resolveName(summary.type, summary.peerId, summary.name);
    }
    return summaries;
  }

  getMessages(sessionKey: string, limit?: number): MessageRecord[] {
    return this.store.getMessages(sessionKey, limit);
  }

  resolveName(type: ChatType, peerId: number, fallback: string): string {
    if (type === 'private') {
      const friend = this.directory.friends.find((f) => f.user_id === peerId);
      if (friend) return friend.remark || friend.nickname || fallback;
    } else {
      const group = this.directory.groups.find((g) => g.group_id === peerId);
      if (group) return group.group_name || fallback;
    }
    return fallback;
  }

  validateTarget(type: ChatType, peerId: number): string | null {
    if (!Number.isSafeInteger(peerId) || peerId <= 0) {
      return '无效的目标 ID';
    }
    if (type === 'private') {
      const exists = this.directory.friends.some((f) => f.user_id === peerId);
      if (exists) return null;
      return '该好友不在好友列表中（或列表尚未加载）';
    }
    const exists = this.directory.groups.some((g) => g.group_id === peerId);
    if (exists) return null;
    return '该群不在群列表中（或列表尚未加载）';
  }

  async sendText(type: ChatType, peerId: number, text: string): Promise<SendResult> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: '消息不能为空' };
    }
    if (trimmed.length > this.messageMaxLength) {
      return { ok: false, error: `消息过长（最多 ${this.messageMaxLength} 字符）` };
    }

    try {
      const result = await this.client.sendApi<{ message_id?: number }>('send_msg', {
        message_type: type,
        ...(type === 'private' ? { user_id: peerId } : { group_id: peerId }),
        message: trimmed,
        auto_escape: true,
      });
      const messageId = typeof result.message_id === 'number' ? result.message_id : 0;
      this.store.add({
        messageId,
        sessionKey: buildSessionKey(type, peerId),
        type,
        senderId: this.selfId,
        senderName: `自己 (${this.selfId})`,
        text: trimmed,
        time: Math.floor(Date.now() / 1000),
        self: true,
      });
      return { ok: true, messageId };
    } catch (err) {
      this.logger.warn('发送消息失败', { type, peerId });
      return { ok: false, error: describeError(err) };
    }
  }

  private async refreshLoginInfo(): Promise<void> {
    try {
      const info = await this.client.sendApi<{ user_id?: number }>('get_login_info', {});
      if (typeof info.user_id === 'number') {
        this.selfId = info.user_id;
      }
    } catch {
      this.logger.debug('获取登录信息失败');
    }
  }

  private handleMessageEvent(event: OneBotMessageEvent): void {
    const type: ChatType = event.message_type;
    const peerId = type === 'private' ? event.user_id : (event.group_id ?? event.user_id);
    const text = extractMessageText(event.message);
    const self = event.user_id === this.selfId || event.sender?.user_id === this.selfId;

    this.store.add({
      messageId: typeof event.message_id === 'number' ? event.message_id : Number(event.message_id),
      sessionKey: buildSessionKey(type, peerId),
      type,
      senderId: event.user_id,
      senderName: resolveSenderName(event, this.selfId),
      text,
      time: event.time,
      self,
    });
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return '发送失败';
}
