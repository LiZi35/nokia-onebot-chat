import { describe, it, expect, vi } from 'vitest';
import Koa from 'koa';
import request from 'supertest';
import { createApp } from '../src/web/app.js';
import { normalizeContentType, requireCsrf } from '../src/web/middleware.js';
import { ChatService } from '../src/domain/chat-service.js';
import { MessageStore } from '../src/domain/message-store.js';
import type {
  OneBotClient,
  MessageEventHandler,
  StateChangeHandler,
} from '../src/onebot/client.js';
import type { ConnectionState } from '../src/onebot/types.js';
import type { AppConfig } from '../src/config.js';
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

const config: AppConfig = {
  onebotWsUrl: 'ws://127.0.0.1:3001',
  port: 3000,
  dbPath: ':memory:',
  sessionKeys: ['test-secret'],
  cookieSecure: false,
  authUsername: '',
  authPassword: '',
  messageMaxLength: 4000,
  maxSessions: 100,
  messagesPerSession: 100,
  apiTimeoutMs: 1000,
  connectTimeoutMs: 1000,
  reconnectMinDelayMs: 100,
  reconnectMaxDelayMs: 1000,
  maxReconnectAttempts: 5,
};

async function buildApp(): Promise<{ app: Koa; client: FakeClient; store: MessageStore }> {
  const client = new FakeClient();
  client.sendApi.mockImplementation(async (action: string) => {
    if (action === 'get_login_info') return { user_id: 1 };
    if (action === 'get_friend_list') return [{ user_id: 100, nickname: 'Alice' }];
    if (action === 'get_group_list') return [{ group_id: 200, group_name: '测试群' }];
    if (action === 'send_msg') return { message_id: 1 };
    return {};
  });
  const store = new MessageStore({ maxSessions: 100, messagesPerSession: 100 });
  const chatService = new ChatService({
    client,
    store,
    logger: new Logger('error'),
    messageMaxLength: 4000,
  });
  await chatService.refreshDirectory();
  const app = createApp({ config, logger: new Logger('error'), chatService });
  return { app, client, store };
}
describe('routes', () => {
  it('serves the index page', async () => {
    const { app } = await buildApp();
    const res = await request(app.callback()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('会话列表');
    expect(res.text).toContain('连接状态');
  });

  it('serves healthz with connection state', async () => {
    const { app } = await buildApp();
    const res = await request(app.callback()).get('/healthz');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.text) as { status: string; onebot: string };
    expect(body.status).toBe('ok');
    expect(body.onebot).toBe('connected');
  });

  it('returns 404 for an invalid chat path', async () => {
    const { app } = await buildApp();
    const res = await request(app.callback()).get('/chat/foo/123');
    expect(res.status).toBe(404);
  });

  it('renders the chat page with a csrf token', async () => {
    const { app } = await buildApp();
    const res = await request(app.callback()).get('/chat/private/100');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="_csrf"');
    expect(res.text).toContain('method="post"');
  });

  it('rejects a POST without a csrf token', async () => {
    const { app } = await buildApp();
    const res = await request(app.callback())
      .post('/chat/private/100/send')
      .type('form')
      .send({ message: 'hi' });
    expect(res.status).toBe(403);
  });

  it('sends a message via PRG and avoids duplicate submission', async () => {
    const { app, client } = await buildApp();
    const agent = request.agent(app.callback());

    const chat = await agent.get('/chat/private/100');
    const match = /name="_csrf" value="([^"]+)"/.exec(chat.text);
    expect(match).not.toBeNull();
    const token = match?.[1] ?? '';

    const post = await agent.post('/chat/private/100/send').type('form').send({
      message: '你好世界',
      _csrf: token,
    });
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe('/chat/private/100');

    const follow = await agent.get('/chat/private/100');
    expect(follow.text).toContain('消息已发送');
    expect(follow.text).toContain('你好世界');

    await agent.get('/chat/private/100');
    const sendCalls = client.sendApi.mock.calls.filter((c) => c[0] === 'send_msg');
    expect(sendCalls).toHaveLength(1);
  });

  it('rejects an empty message without calling the API', async () => {
    const { app, client } = await buildApp();
    const agent = request.agent(app.callback());

    const chat = await agent.get('/chat/private/100');
    const token = /name="_csrf" value="([^"]+)"/.exec(chat.text)?.[1] ?? '';

    const post = await agent
      .post('/chat/private/100/send')
      .type('form')
      .send({ message: '   ', _csrf: token });
    expect(post.status).toBe(302);
    expect(client.sendApi.mock.calls.filter((c) => c[0] === 'send_msg')).toHaveLength(0);

    const follow = await agent.get('/chat/private/100');
    expect(follow.text).toContain('消息不能为空');
  });

  it('escapes user content in rendered HTML', async () => {
    const { app, store } = await buildApp();
    store.add({
      messageId: 9,
      sessionKey: 'private:100',
      type: 'private',
      senderId: 100,
      senderName: '<img src=x onerror=alert(1)>',
      text: '<script>alert("xss")</script>',
      time: 1,
      self: false,
    });
    const res = await request(app.callback()).get('/chat/private/100');
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).not.toContain('<img src=x');
  });
});

describe('normalizeContentType middleware', () => {
  it('collapses a duplicated Content-Type header', async () => {
    const ctx = {
      req: {
        headers: {
          'content-type': 'application/x-www-form-urlencoded, application/x-www-form-urlencoded',
        },
      },
    } as unknown as Koa.Context;
    let called = false;
    await normalizeContentType()(ctx, async () => {
      called = true;
    });
    expect(ctx.req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(called).toBe(true);
  });
});

describe('requireCsrf middleware', () => {
  it('allows GET without a token', async () => {
    const app = new Koa();
    app.use(requireCsrf());
    app.use(async (ctx) => {
      ctx.body = 'ok';
    });
    const res = await request(app.callback()).get('/');
    expect(res.status).toBe(200);
  });
});
