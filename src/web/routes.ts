import Router from '@koa/router';
import type Koa from 'koa';
import type { ChatService } from '../domain/chat-service.js';
import type { Logger } from '../logger.js';
import type { AppConfig } from '../config.js';
import type { ChatType } from '../domain/message-store.js';
import { buildSessionKey } from '../domain/message-store.js';
import {
  renderIndex,
  renderChat,
  renderError,
  renderLogin,
  formatSessionForView,
  formatMessageForView,
  type Flash,
} from './views.js';
import {
  getCsrfToken,
  takeFlashes,
  setFlash,
  isAuthenticated,
  setAuthenticated,
} from './session.js';
import {
  sendMessageBodySchema,
  loginBodySchema,
  parseChatType,
  parsePeerId,
} from './validation.js';
import { isAuthEnabled, verifyCredentials } from './auth.js';

export interface WebDeps {
  chatService: ChatService;
  logger: Logger;
  maxMessagesPerPage: number;
  config: AppConfig;
}

function pageBase(ctx: Koa.Context): { title: string; status: string; flashes: Flash[] } {
  return {
    title: '',
    status: ctx.state.connectionState as string,
    flashes: takeFlashes(ctx),
  };
}

export function createRouter(deps: WebDeps): Router {
  const { chatService, logger, maxMessagesPerPage, config } = deps;
  const router = new Router();

  router.get('/login', (ctx) => {
    if (!isAuthEnabled(config) || isAuthenticated(ctx)) {
      ctx.redirect('/');
      return;
    }
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = renderLogin({
      title: '登录',
      flashes: takeFlashes(ctx),
      csrf: getCsrfToken(ctx),
    });
  });

  router.post('/login', (ctx) => {
    if (!isAuthEnabled(config)) {
      ctx.redirect('/');
      return;
    }
    const parsed = loginBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      setFlash(ctx, 'err', '请输入账号和密码');
      ctx.redirect('/login');
      return;
    }
    if (verifyCredentials(config, parsed.data.username, parsed.data.password)) {
      setAuthenticated(ctx, true);
      ctx.redirect('/');
    } else {
      setFlash(ctx, 'err', '账号或密码错误');
      ctx.redirect('/login');
    }
  });

  router.get('/logout', (ctx) => {
    setAuthenticated(ctx, false);
    ctx.redirect(isAuthEnabled(config) ? '/login' : '/');
  });

  router.get('/', (ctx) => {
    const base = pageBase(ctx);
    base.title = 'OneBot 聊天';
    const sessions = chatService.getSessions().map((s) => formatSessionForView(s));
    const directory = chatService.getDirectory();
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = renderIndex({
      ...base,
      sessions,
      friends: directory.friends,
      groups: directory.groups,
    });
  });

  router.get('/refresh', async (ctx) => {
    await chatService.refreshDirectory();
    ctx.redirect('/');
  });

  router.get('/chat/:type/:id', (ctx) => {
    const type = parseChatType(ctx.params.type);
    const peerId = parsePeerId(ctx.params.id);
    if (!type || peerId === null) {
      ctx.status = 404;
      ctx.type = 'text/html; charset=utf-8';
      ctx.body = renderError({ ...pageBase(ctx), title: '未找到', message: '无效的会话地址' });
      return;
    }

    const sessionKey = buildSessionKey(type, peerId);
    const name = chatService.resolveName(type, peerId, String(peerId));
    const typeLabel = type === 'private' ? '私聊' : '群聊';
    const messages = chatService
      .getMessages(sessionKey, maxMessagesPerPage)
      .map((m) => formatMessageForView(m, typeLabel));

    const base = pageBase(ctx);
    base.title = `${typeLabel} ${name}`;
    ctx.type = 'text/html; charset=utf-8';
    ctx.body = renderChat({
      ...base,
      chatTitle: `${typeLabel}：${name}`,
      typeLabel,
      chatPath: `/chat/${type}/${peerId}`,
      formAction: `/chat/${type}/${peerId}/send`,
      csrf: getCsrfToken(ctx),
      isGroup: type === 'group',
      maxMessages: maxMessagesPerPage,
      messages,
    });
  });

  router.post('/chat/:type/:id/send', async (ctx) => {
    const type = parseChatType(ctx.params.type);
    const peerId = parsePeerId(ctx.params.id);
    if (!type || peerId === null) {
      ctx.status = 404;
      ctx.type = 'text/html; charset=utf-8';
      ctx.body = renderError({ ...pageBase(ctx), title: '未找到', message: '无效的会话地址' });
      return;
    }

    const parsed = sendMessageBodySchema.safeParse(ctx.request.body);
    if (!parsed.success) {
      setFlash(ctx, 'err', '消息格式无效');
      ctx.redirect(chatPath(type, peerId));
      return;
    }

    const targetError = chatService.validateTarget(type, peerId);
    if (targetError) {
      setFlash(ctx, 'err', targetError);
      ctx.redirect(chatPath(type, peerId));
      return;
    }

    const result = await chatService.sendText(type, peerId, parsed.data.message);
    if (result.ok) {
      setFlash(ctx, 'ok', '消息已发送');
    } else {
      logger.warn('发送失败', { type, peerId });
      setFlash(ctx, 'err', result.error ?? '发送失败');
    }
    ctx.redirect(chatPath(type, peerId));
  });

  router.get('/healthz', (ctx) => {
    ctx.type = 'application/json; charset=utf-8';
    ctx.body = JSON.stringify({
      status: 'ok',
      onebot: chatService.getConnectionState(),
      sessions: chatService.getSessions().length,
      selfId: chatService.getSelfId(),
    });
  });

  return router;
}

function chatPath(type: ChatType, peerId: number): string {
  return `/chat/${type}/${peerId}`;
}
