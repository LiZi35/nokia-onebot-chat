import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('uses defaults when env is empty', () => {
    const result = loadConfig({});
    expect(result.ok).toBe(true);
    expect(result.config?.port).toBe(3000);
    expect(result.config?.onebotWsUrl).toBe('ws://127.0.0.1:3001');
    expect(result.config?.messageMaxLength).toBe(4000);
  });

  it('overrides values from env', () => {
    const result = loadConfig({
      ONEBOT_WS_URL: 'ws://example.com:9999',
      PORT: '8080',
      MESSAGE_MAX_LENGTH: '100',
      SESSION_KEYS: 'a,b,c',
    });
    expect(result.ok).toBe(true);
    expect(result.config?.port).toBe(8080);
    expect(result.config?.onebotWsUrl).toBe('ws://example.com:9999');
    expect(result.config?.messageMaxLength).toBe(100);
    expect(result.config?.sessionKeys).toEqual(['a', 'b', 'c']);
  });

  it('rejects an invalid WebSocket URL', () => {
    const result = loadConfig({ ONEBOT_WS_URL: 'not-a-url' });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toContain('onebotWsUrl');
  });

  it('rejects reconnect min delay greater than max delay', () => {
    const result = loadConfig({
      ONEBOT_RECONNECT_MIN_DELAY_MS: '5000',
      ONEBOT_RECONNECT_MAX_DELAY_MS: '1000',
    });
    expect(result.ok).toBe(false);
  });

  it('parses COOKIE_SECURE as boolean', () => {
    expect(loadConfig({ COOKIE_SECURE: 'true' }).config?.cookieSecure).toBe(true);
    expect(loadConfig({ COOKIE_SECURE: 'false' }).config?.cookieSecure).toBe(false);
  });
});
