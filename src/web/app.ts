import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import session from 'koa-session';
import helmet from 'koa-helmet';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { ChatService } from '../domain/chat-service.js';
import type { SessionStore } from '../db/session-store.js';
import { normalizeContentType, requireCsrf, errorHandler, requireAuth } from './middleware.js';
import { createRouter } from './routes.js';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  chatService: ChatService;
  sessionStore?: SessionStore;
}

export function createApp(deps: AppDeps): Koa {
  const { config, logger, chatService, sessionStore } = deps;
  const app = new Koa();

  app.proxy = config.trustProxy;
  app.keys = config.sessionKeys;

  app.use(errorHandler(logger));
  app.use(normalizeContentType());
  app.use(
    bodyParser({
      enableTypes: ['form'],
      formLimit: '64kb',
    }),
  );
  app.use(
    session(
      {
        key: 'nokia.sid',
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        signed: true,
        secure: config.cookieSecure ? true : undefined,
        sameSite: 'lax',
        overwrite: true,
        store: sessionStore,
      },
      app,
    ),
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  app.use(async (ctx, next) => {
    ctx.state.connectionState = chatService.getConnectionState();
    await next();
  });

  app.use(requireAuth(config));
  app.use(requireCsrf());

  const router = createRouter({
    chatService,
    logger,
    maxMessagesPerPage: config.displayMaxMessages,
    config,
  });
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
