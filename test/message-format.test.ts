import { describe, it, expect } from 'vitest';
import {
  extractMessageText,
  resolveSenderName,
  parseMentionText,
  containsMention,
} from '../src/onebot/message-format.js';
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

  it('converts at segments to @mention', () => {
    expect(
      extractMessageText([
        { type: 'at', data: { qq: '123456' } },
        { type: 'text', data: { text: ' 你好' } },
      ]),
    ).toBe('@123456 你好');
  });

  it('prefers name in at segments when present', () => {
    expect(extractMessageText([{ type: 'at', data: { qq: '123456', name: '张三' } }])).toBe(
      '@张三',
    );
  });

  it('converts CQ at codes in string messages', () => {
    expect(extractMessageText('你好[CQ:at,qq=123456]在吗')).toBe('你好@123456在吗');
    expect(extractMessageText('[CQ:at,qq=123456,name=李四] 早')).toBe('@李四 早');
  });

  it('parses CQ at codes with extra fields in any order', () => {
    expect(extractMessageText('[CQ:at,qq=123456,id=9] hi')).toBe('@123456 hi');
    expect(extractMessageText('[CQ:at,name=王五,qq=111] hi')).toBe('@王五 hi');
  });

  it('resolves at names via the resolver callback', () => {
    const resolve = (qq: string) => (qq === '123456' ? '张三' : null);
    expect(
      extractMessageText(
        [
          { type: 'at', data: { qq: '123456' } },
          { type: 'text', data: { text: ' 早' } },
        ],
        resolve,
      ),
    ).toBe('@张三 早');
    expect(extractMessageText('[CQ:at,qq=123456] 早', resolve)).toBe('@张三 早');
    expect(extractMessageText('[CQ:at,qq=999] 早', resolve)).toBe('@999 早');
  });
});

describe('parseMentionText', () => {
  it('splits text around mentions into segments', () => {
    expect(parseMentionText('你好 @123456 在吗')).toEqual([
      { type: 'text', data: { text: '你好 ' } },
      { type: 'at', data: { qq: '123456' } },
      { type: 'text', data: { text: ' 在吗' } },
    ]);
  });

  it('handles a message that is only a mention', () => {
    expect(parseMentionText('@123456')).toEqual([{ type: 'at', data: { qq: '123456' } }]);
  });

  it('returns a single text segment when no mention present', () => {
    expect(parseMentionText('普通文本')).toEqual([{ type: 'text', data: { text: '普通文本' } }]);
  });

  it('detects mentions', () => {
    expect(containsMention('你好 @123456')).toBe(true);
    expect(containsMention('你好')).toBe(false);
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
