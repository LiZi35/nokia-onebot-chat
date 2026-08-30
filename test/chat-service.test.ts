import { describe, it, expect, vi } from 'vitest';
import { ChatService } from '../src/domain/chat-service.js';
import { MessageStore } from '../src/domain/message-store.js';
import type {
  OneBotClient,
  MessageEventHandler,
  StateChangeHandler,
} from '../src/onebot/client.js';
import type { ConnectionState, OneBotMessageEvent } from '../src/onebot/types.js';
import { Logger } from '../src/logger.js';

class FakeClient implements OneBotClient {
  state: ConnectionState = 'connected';
  sendApi = vi.fn();
  connect = vi.fn();
  close = vi.fn();
  messageHandler: MessageEventHandler | null = null;

  getState(): ConnectionState {
    return this.state;
  }

  onMessage(handler: MessageEventHandler): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = null;
    };
  }

  onStateChange(_handler: StateChangeHandler): () => void {
    return () => undefined;
  }
}

function setup(): { service: ChatService; store: MessageStore; client: FakeClient } {
  const client = new FakeClient();
  const store = new MessageStore({ maxSessions: 10, messagesPerSession: 10 });
  const service = new ChatService({
    client,
    store,
    logger: new Logger('error'),
    messageMaxLength: 100,
  });
  return { service, store, client };
}

describe('ChatService', () => {
  it('sends a private text message and records it', async () => {
    const { service, store, client } = setup();
    client.sendApi.mockResolvedValueOnce({ user_id: 100 });
    client.sendApi.mockResolvedValueOnce([]);
    client.sendApi.mockResolvedValueOnce([]);
    await service.refreshDirectory();

    client.sendApi.mockResolvedValueOnce({ message_id: 7 });
    const result = await service.sendText('private', 100, 'hello');
    expect(result.ok).toBe(true);
    expect(store.getMessages('private:100')).toHaveLength(1);

    const call = client.sendApi.mock.calls.find((c) => c[0] === 'send_msg') as
      [string, Record<string, unknown>] | undefined;
    expect(call?.[1]).toMatchObject({
      message_type: 'private',
      user_id: 100,
      message: 'hello',
      auto_escape: true,
    });
  });

  it('rejects empty messages', async () => {
    const { service } = setup();
    const result = await service.sendText('private', 100, '   ');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('消息不能为空');
  });

  it('sends group mentions as message segments', async () => {
    const { service, client } = setup();
    client.sendApi.mockResolvedValueOnce({ user_id: 100 });
    client.sendApi.mockResolvedValueOnce([]);
    client.sendApi.mockResolvedValueOnce([{ group_id: 200, group_name: 'g' }]);
    await service.refreshDirectory();

    client.sendApi.mockResolvedValueOnce({ message_id: 9 });
    const result = await service.sendText('group', 200, '你好 @123456 在吗');
    expect(result.ok).toBe(true);

    const call = client.sendApi.mock.calls.find((c) => c[0] === 'send_msg') as
      [string, Record<string, unknown>] | undefined;
    expect(call?.[1]).toMatchObject({ message_type: 'group', group_id: 200 });
    expect(call?.[1].message).toEqual([
      { type: 'text', data: { text: '你好 ' } },
      { type: 'at', data: { qq: '123456' } },
      { type: 'text', data: { text: ' 在吗' } },
    ]);
  });

  it('rejects overlong messages', async () => {
    const { service } = setup();
    const result = await service.sendText('private', 100, 'x'.repeat(101));
    expect(result.ok).toBe(false);
  });

  it('returns an error when the API call fails', async () => {
    const { service, client } = setup();
    client.sendApi.mockRejectedValueOnce(new Error('网络错误'));
    const result = await service.sendText('private', 100, 'hi');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('网络错误');
  });

  it('validates targets against the directory', async () => {
    const { service, client } = setup();
    client.sendApi.mockResolvedValueOnce({ user_id: 1 });
    client.sendApi.mockResolvedValueOnce([{ user_id: 100, nickname: 'a' }]);
    client.sendApi.mockResolvedValueOnce([{ group_id: 200, group_name: 'g' }]);
    await service.refreshDirectory();

    expect(service.validateTarget('private', 100)).toBeNull();
    expect(service.validateTarget('group', 200)).toBeNull();
    expect(service.validateTarget('private', 999)).toContain('好友');
    expect(service.validateTarget('group', 999)).toContain('群');
    expect(service.validateTarget('private', -1)).toBe('无效的目标 ID');
  });

  it('stores incoming message events', () => {
    const { service, store, client } = setup();
    service.start();

    const event: OneBotMessageEvent = {
      time: 1000,
      self_id: 100,
      post_type: 'message',
      message_type: 'group',
      sub_type: 'normal',
      message_id: 5,
      user_id: 200,
      group_id: 300,
      message: '你好',
      raw_message: '你好',
      sender: { user_id: 200, nickname: '李四' },
    };
    client.messageHandler?.(event);

    const messages = store.getMessages('group:300');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('你好');
    expect(messages[0]?.senderName).toBe('李四');
    expect(messages[0]?.type).toBe('group');
  });
});
