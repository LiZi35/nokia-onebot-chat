import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';

export function isAuthEnabled(config: AppConfig): boolean {
  return config.authUsername.length > 0 && config.authPassword.length > 0;
}

export function verifyCredentials(config: AppConfig, username: string, password: string): boolean {
  if (!isAuthEnabled(config)) return true;
  return (
    safeEqual(Buffer.from(username, 'utf8'), Buffer.from(config.authUsername, 'utf8')) &&
    safeEqual(Buffer.from(password, 'utf8'), Buffer.from(config.authPassword, 'utf8'))
  );
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
