import type Koa from 'koa';
import type { Logger } from '../logger.js';
import type { AppConfig } from '../config.js';
import { getCsrfToken, isAuthenticated } from './session.js';
import { verifyCsrfToken } from './csrf.js';
import { isAuthEnabled } from './auth.js';

/**
 * Nokia 108 等旧功能机会重复发送 Content-Type 请求头（见 NOKIA108-COMPATIBILITY.md），
 * Node.js 会将重复头合并为逗号分隔，导致 koa-bodyparser 无法识别。
 * 该中间件在 body 解析前将重复的 Content-Type 归一化为首个值。
 */
export function normalizeContentType(): Koa.Middleware {
  return async (ctx, next) => {
    const raw = ctx.req.headers['content-type'];
    if (typeof raw === 'string' && raw.includes(',')) {
      const first = raw.split(',')[0];
      if (first) {
        ctx.req.headers['content-type'] = first.trim();
      }
    }
    await next();
  };
}

export function requireCsrf(): Koa.Middleware {
  return async (ctx, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) {
      await next();
      return;
    }
    const body = ctx.request.body as Record<string, unknown> | undefined;
    const token = body?._csrf;
    const expected = getCsrfToken(ctx);
    if (typeof token !== 'string' || !verifyCsrfToken(token, expected)) {
      ctx.status = 403;
      ctx.type = 'text/plain; charset=utf-8';
      ctx.body = 'CSRF 校验失败，请返回上一页重试';
      return;
    }
    await next();
  };
}

const PUBLIC_PATHS = new Set(['/login', '/healthz']);

export function requireAuth(config: AppConfig): Koa.Middleware {
  return async (ctx, next) => {
    if (!isAuthEnabled(config) || PUBLIC_PATHS.has(ctx.path) || isAuthenticated(ctx)) {
      await next();
      return;
    }
    ctx.redirect('/login');
  };
}

export function errorHandler(logger: Logger): Koa.Middleware {
  return async (ctx, next) => {
    try {
      await next();
      const status = ctx.status;
      if (status >= 400 && ctx.body === undefined) {
        ctx.body = `请求失败（${status}）`;
      }
    } catch (err) {
      logger.error('未处理的请求错误', {
        message: err instanceof Error ? err.message : String(err),
      });
      ctx.status = 500;
      ctx.type = 'text/html; charset=utf-8';
      ctx.body = '<h1>服务器内部错误</h1><p>请稍后重试。</p>';
    }
  };
}
