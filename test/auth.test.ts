import { describe, it, expect, vi } from 'vitest';
import Koa from 'koa';
import request from 'supertest';
import { createApp } from '../src/web/app.js';
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

  getState(): ConnectionState {
    return this.state;
  }

  onMessage(_handler: MessageEventHandler): () => void {
    return () => undefined;
  }

  onStateChange(_handler: StateChangeHandler): () => void {
    return () => undefined;
  }
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
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
    ...overrides,
  };
}

function buildApp(config: AppConfig): Koa {
  const client = new FakeClient();
  const store = new MessageStore({ maxSessions: 100, messagesPerSession: 100 });
  const chatService = new ChatService({
    client,
    store,
    logger: new Logger('error'),
    messageMaxLength: 4000,
  });
  return createApp({ config, logger: new Logger('error'), chatService });
}

describe('authentication', () => {
  it('skips auth when no credentials are configured', async () => {
    const app = buildApp(makeConfig());
    const res = await request(app.callback()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('会话列表');
  });

  it('redirects to /login when auth is enabled and not authenticated', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const res = await request(app.callback()).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('renders the login form', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const res = await request(app.callback()).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="username"');
    expect(res.text).toContain('name="password"');
    expect(res.text).toContain('name="_csrf"');
  });

  it('rejects a login POST without csrf', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const res = await request(app.callback())
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'secret' });
    expect(res.status).toBe(403);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const agent = request.agent(app.callback());

    const loginPage = await agent.get('/login');
    const token = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)?.[1] ?? '';

    const wrong = await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'nope', _csrf: token });
    expect(wrong.status).toBe(302);
    expect(wrong.headers.location).toBe('/login');

    const wrongFollow = await agent.get('/login');
    expect(wrongFollow.text).toContain('账号或密码错误');

    const ok = await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'secret', _csrf: token });
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe('/');

    const home = await agent.get('/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('会话列表');
  });

  it('logs out and requires re-authentication', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const agent = request.agent(app.callback());

    const loginPage = await agent.get('/login');
    const token = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)?.[1] ?? '';
    await agent
      .post('/login')
      .type('form')
      .send({ username: 'admin', password: 'secret', _csrf: token });

    const logout = await agent.get('/logout');
    expect(logout.status).toBe(302);
    expect(logout.headers.location).toBe('/login');

    const after = await agent.get('/');
    expect(after.status).toBe(302);
    expect(after.headers.location).toBe('/login');
  });

  it('keeps /healthz accessible without authentication', async () => {
    const app = buildApp(makeConfig({ authUsername: 'admin', authPassword: 'secret' }));
    const res = await request(app.callback()).get('/healthz');
    expect(res.status).toBe(200);
  });
});
