import type { OneBotMessageEvent, OneBotMessageSegment } from './types.js';

const CQ_AT_RE = /\[CQ:at,qq=(\d+)(?:,name=([^\]]*))?\]/g;

/**
 * 从 OneBot v11 消息事件中提取可读文本内容。
 * - `message` 为字符串时，将 `[CQ:at,qq=xxx]` 转为 `@xxx`（或 `@昵称`）。
 * - `message` 为段数组时，拼接 text 段，并将 at 段转为 `@xxx`（或 `@昵称`）。
 */
export function extractMessageText(message: unknown): string {
  if (typeof message === 'string') {
    return message.replace(CQ_AT_RE, (_m, qq: string, name?: string) => {
      const resolved = name && name.length > 0 ? name : qq;
      return `@${resolved}`;
    });
  }
  if (Array.isArray(message)) {
    const parts: string[] = [];
    for (const seg of message) {
      if (!isRecord(seg)) continue;
      const typed = seg as unknown as OneBotMessageSegment;
      if (typed.type === 'text' && typed.data && typeof typed.data.text === 'string') {
        parts.push(typed.data.text);
      } else if (typed.type === 'at' && typed.data) {
        parts.push(formatMention(typed.data));
      }
    }
    return parts.join('');
  }
  return '';
}

/**
 * 将用户输入的文本解析为 OneBot 消息段数组：`@QQ号` 会转为 at 段，其余为 text 段。
 * 仅在群聊中调用；私聊中不转换，保持字面文本。
 */
export function parseMentionText(text: string): OneBotMessageSegment[] {
  const segments: OneBotMessageSegment[] = [];
  const re = /@(\d{1,15})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const qq = match[1];
    if (match.index > lastIndex) {
      segments.push({ type: 'text', data: { text: text.slice(lastIndex, match.index) } });
    }
    segments.push({ type: 'at', data: { qq } });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', data: { text: text.slice(lastIndex) } });
  }
  if (segments.length === 0) {
    segments.push({ type: 'text', data: { text } });
  }
  return segments;
}

export function containsMention(text: string): boolean {
  return /@(\d{1,15})/.test(text);
}

function formatMention(data: Record<string, unknown>): string {
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : '';
  const qq =
    typeof data.qq === 'string' ? data.qq : typeof data.qq === 'number' ? String(data.qq) : '';
  if (name) return `@${name}`;
  if (qq) return `@${qq}`;
  return '@';
}

export function resolveSenderName(event: OneBotMessageEvent, selfId: number): string {
  const sender = event.sender;
  if (sender && typeof sender.nickname === 'string' && sender.nickname.length > 0) {
    return sender.nickname;
  }
  if (sender && typeof sender.card === 'string' && sender.card.length > 0) {
    return sender.card;
  }
  if (event.user_id === selfId) {
    return `自己 (${event.user_id})`;
  }
  return String(event.user_id);
}

export function isMessageEvent(value: Record<string, unknown>): value is OneBotMessageEvent {
  return (
    value.post_type === 'message' &&
    (value.message_type === 'private' || value.message_type === 'group')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
