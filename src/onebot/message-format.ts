import type { OneBotMessageEvent, OneBotMessageSegment } from './types.js';

export type AtNameResolver = (qq: string) => string | null | undefined;

const CQ_CODE_RE = /\[CQ:([^,\]]+)(?:,([^\]]*))?\]/g;

const SEGMENT_LABELS: Record<string, string> = {
  image: '[图片]',
  face: '[表情]',
  record: '[语音]',
  video: '[视频]',
  file: '[文件]',
  share: '[链接]',
  music: '[音乐]',
  location: '[位置]',
  reply: '[回复]',
  contact: '[联系人]',
  redbag: '[红包]',
  json: '[卡片]',
  forward: '[合并转发]',
  poke: '[戳一戳]',
  dice: '[骰子]',
  rps: '[猜拳]',
};

/**
 * 从 OneBot v11 消息事件中提取可读文本内容。
 * - `message` 为字符串时，将 `[CQ:xxx,...]` 转为可读文本：at 转 `@昵称`/`@QQ号`，其余转 `[图片]` 等占位符。
 * - `message` 为段数组时，拼接 text 段、at 段，其余类型转占位符。
 * - `resolveAtName` 可选：用于把 at 的 QQ 号解析为昵称/群名片。
 */
export function extractMessageText(message: unknown, resolveAtName?: AtNameResolver): string {
  if (typeof message === 'string') {
    return message.replace(CQ_CODE_RE, (_m, type: string, params: string | undefined) => {
      if (type === 'at') {
        return formatCqAt(params ?? '', resolveAtName);
      }
      return segmentLabel(type) ?? '';
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
        parts.push(formatMention(typed.data, resolveAtName));
      } else {
        const label = segmentLabel(typed.type);
        if (label) parts.push(label);
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

function formatMention(data: Record<string, unknown>, resolveAtName?: AtNameResolver): string {
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : '';
  const qq =
    typeof data.qq === 'string' ? data.qq : typeof data.qq === 'number' ? String(data.qq) : '';
  if (name) return `@${name}`;
  if (qq) return `@${resolveAtName?.(qq) ?? qq}`;
  return '@';
}

function formatCqAt(params: string, resolveAtName?: AtNameResolver): string {
  const { qq, name } = parseCqAtParams(params);
  if (name) return `@${name}`;
  if (qq) return `@${resolveAtName?.(qq) ?? qq}`;
  return '@';
}

function parseCqAtParams(params: string): { qq?: string; name?: string } {
  const result: { qq?: string; name?: string } = {};
  for (const raw of params.split(',')) {
    const eq = raw.indexOf('=');
    if (eq <= 0) continue;
    const key = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (value.length === 0) continue;
    if (key === 'qq') result.qq = value;
    else if (key === 'name') result.name = value;
  }
  return result;
}

function segmentLabel(type: string): string | null {
  return SEGMENT_LABELS[type] ?? null;
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
