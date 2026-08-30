import { describe, it, expect } from 'vitest';
import { extractMessageText, resolveSenderName } from '../src/onebot/message-format.js';
import type { OneBotMessageEvent } from '../src/onebot/types.js';

describe('extractMessageText', () => {
  it('returns plain strings as-is', () => {
    expect(extractMessageText('hello')).toBe('hello');
  });

  it('joins text segments from an array', () => {
    expect(
      extractMessageText([
        { type: 'text', data: { text: '你好' } },
        { type: 'text', data: { text: '世界' } },
        { type: 'image', data: { file: 'x' } },
      ]),
    ).toBe('你好世界');
  });

  it('returns empty string for non-text messages', () => {
    expect(extractMessageText([{ type: 'image', data: { file: 'x' } }])).toBe('');
    expect(extractMessageText(12345)).toBe('');
    expect(extractMessageText(undefined)).toBe('');
  });
});

describe('resolveSenderName', () => {
  const base: OneBotMessageEvent = {
    time: 1,
    self_id: 100,
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    message_id: 1,
    user_id: 200,
    message: 'x',
  };

  it('prefers nickname', () => {
    const name = resolveSenderName(
      { ...base, sender: { user_id: 200, nickname: '张三', card: '卡片' } },
      100,
    );
    expect(name).toBe('张三');
  });

  it('falls back to card', () => {
    const name = resolveSenderName({ ...base, sender: { user_id: 200, card: '卡片' } }, 100);
    expect(name).toBe('卡片');
  });

  it('labels self messages', () => {
    const name = resolveSenderName({ ...base, user_id: 100 }, 100);
    expect(name).toBe('自己 (100)');
  });

  it('falls back to user id', () => {
    expect(resolveSenderName(base, 100)).toBe('200');
  });
});
