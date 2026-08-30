import type Koa from 'koa';
import type { Flash } from './views.js';
import { generateCsrfToken } from './csrf.js';

interface SessionLike {
  csrfToken?: string;
  flashes?: Flash[];
  authenticated?: boolean;
}

function getSession(ctx: Koa.Context): SessionLike {
  const session = ctx.session as SessionLike | null | undefined;
  if (!session) return {};
  return session;
}

export function isAuthenticated(ctx: Koa.Context): boolean {
  return getSession(ctx).authenticated === true;
}

export function setAuthenticated(ctx: Koa.Context, value: boolean): void {
  const session = getSession(ctx);
  if (value) {
    session.authenticated = true;
  } else {
    delete session.authenticated;
  }
}

export function getCsrfToken(ctx: Koa.Context): string {
  const session = getSession(ctx);
  if (!session.csrfToken) {
    session.csrfToken = generateCsrfToken();
  }
  return session.csrfToken;
}

export function setFlash(ctx: Koa.Context, kind: Flash['kind'], message: string): void {
  const session = getSession(ctx);
  session.flashes = [{ kind, message }];
}

export function takeFlashes(ctx: Koa.Context): Flash[] {
  const session = getSession(ctx);
  const flashes = session.flashes ?? [];
  session.flashes = [];
  return flashes;
}
