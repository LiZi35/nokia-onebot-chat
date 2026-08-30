import { describe, it, expect, vi, afterEach } from 'vitest';
import { OneBotWebSocketClient } from '../src/onebot/client.js';
import type { OneBotSocket, SocketEventHandlers, SocketFactory } from '../src/onebot/socket.js';
import { OneBotApiError, OneBotConnectionError, OneBotTimeoutError } from '../src/onebot/errors.js';
import { Logger } from '../src/logger.js';

class FakeSocket implements OneBotSocket {
  handlers!: SocketEventHandlers;
  sent: string[] = [];
  closeCount = 0;
  readyState = 1;

  connect(_url: string, handlers: SocketEventHandlers): void {
    this.handlers = handlers;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = 3;
  }
}

function makeFactory(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = (_url, handlers) => {
    const s = new FakeSocket();
    s.handlers = handlers;
    sockets.push(s);
    return s;
  };
  return { factory, sockets };
}

function makeClient(factory: SocketFactory): OneBotWebSocketClient {
  return new OneBotWebSocketClient({
    wsUrl: 'ws://example.test',
    socketFactory: factory,
    logger: new Logger('error'),
    apiTimeoutMs: 1000,
    connectTimeoutMs: 1000,
    reconnectMinDelayMs: 100,
    reconnectMaxDelayMs: 1000,
    maxReconnectAttempts: 5,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OneBotWebSocketClient', () => {
  it('resolves sendApi on matching echo', async () => {
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    client.connect();
    sockets[0]?.handlers.onOpen();

    const promise = client.sendApi<{ message_id: number }>('send_msg', { message: 'hi' });
    const sent = JSON.parse(sockets[0]?.sent[0] ?? '{}') as { action: string; echo: string };
    expect(sent.action).toBe('send_msg');

    sockets[0]?.handlers.onMessage(
      JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 42 }, echo: sent.echo }),
    );
    await expect(promise).resolves.toEqual({ message_id: 42 });
  });

  it('rejects on failed status with retcode', async () => {
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    client.connect();
    sockets[0]?.handlers.onOpen();

    const promise = client.sendApi('get_friend_list', {});
    const sent = JSON.parse(sockets[0]?.sent[0] ?? '{}') as { echo: string };
    sockets[0]?.handlers.onMessage(
      JSON.stringify({ status: 'failed', retcode: 100, message: 'boom', echo: sent.echo }),
    );
    const err = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(OneBotApiError);
    expect((err as OneBotApiError).retcode).toBe(100);
  });

  it('rejects when the API call times out', async () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    client.connect();
    sockets[0]?.handlers.onOpen();

    const promise = client.sendApi('get_group_list', {});
    const rejection = promise.then(
      () => null,
      (e: unknown) => e,
    );
    vi.advanceTimersByTime(1500);
    expect(await rejection).toBeInstanceOf(OneBotTimeoutError);
  });

  it('rejects immediately when not connected', async () => {
    const { factory } = makeFactory();
    const client = makeClient(factory);
    await expect(client.sendApi('send_msg', {})).rejects.toBeInstanceOf(OneBotConnectionError);
  });

  it('reconnects after a close', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    client.connect();
    sockets[0]?.handlers.onOpen();
    expect(client.getState()).toBe('connected');

    sockets[0]?.handlers.onClose(1006, '');
    expect(client.getState()).toBe('reconnecting');

    vi.advanceTimersByTime(2000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it('dispatches message events to handlers', () => {
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    const handler = vi.fn();
    client.onMessage(handler);
    client.connect();
    sockets[0]?.handlers.onOpen();

    sockets[0]?.handlers.onMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        message_id: 1,
        user_id: 99,
        message: 'hello',
        raw_message: 'hello',
        time: 123,
        self_id: 100,
        sub_type: 'friend',
      }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]?.user_id).toBe(99);
  });

  it('ignores malformed JSON without throwing', () => {
    const { factory, sockets } = makeFactory();
    const client = makeClient(factory);
    client.connect();
    sockets[0]?.handlers.onOpen();
    expect(() => sockets[0]?.handlers.onMessage('not json')).not.toThrow();
  });
});
