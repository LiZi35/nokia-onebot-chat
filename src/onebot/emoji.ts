import { EMOJI_NAMES } from './emoji-names.js';

/**
 * 常见 Emoji 的中文描述覆盖：用于修正数据表中不够口语化或容易混淆的名称。
 * 键为去掉变体选择符（U+FE0F）后的 Emoji 序列。
 */
const OVERRIDES: Readonly<Record<string, string>> = {
  '😀': '开心',
  '😊': '微笑',
  '😂': '笑哭',
  '🤣': '爆笑',
  '😅': '苦笑',
  '😎': '酷',
  '🤔': '思考',
  '🥰': '喜爱',
  '🥳': '庆祝',
  '🥺': '可怜',
  '😬': '龇牙',
  '😡': '发怒',
  '😱': '惊恐',
  '😴': '睡觉',
  '🥵': '热',
  '🥶': '冷',
  '😵': '晕',
  '🤫': '嘘',
  '🤬': '咒骂',
  '🤠': '牛仔',
  '🤞': '好运',
  '🤟': '爱你',
  '🤙': '打电话',
  '🙏': '祈祷',
  '👍': '赞',
  '👎': '踩',
  '💪': '加油',
  '❤': '爱心',
  '💓': '心跳',
  '💘': '一箭穿心',
  '💝': '礼物心',
  '🎊': '彩球',
  '🌟': '闪亮星星',
  '✅': '对号',
  '❌': '错号',
  '💯': '满分',
  '❗': '感叹号',
  '❓': '问号',
};

/**
 * 匹配一条完整的 Emoji 序列：允许组合 ZWJ 序列、肤色修饰符、变体选择符、
 * 区域指示符（国旗）、按键帽与标签序列。仅匹配以 Emoji 方式呈现的字符，
 * 例如 `❤`（默认文本样式）不会被匹配，而 `❤️` 会。
 */
const EMOJI_SEQUENCE_RE =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F|\p{Emoji_Modifier})?)*(?:[\u{E0020}-\u{E007F}]+)?)/gu;

const VARIATION_SELECTOR_RE = /\uFE0F/g;
const SKIN_TONE_RE = /[\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * 将文本中的 Emoji 替换为 `[表情:描述]` 占位符，避免在 Nokia 108 等
 * 不支持 Emoji 字体的设备上显示为乱码；无法识别的 Emoji 退化为 `[表情]`。
 */
export function replaceEmojiWithDescriptions(text: string): string {
  if (text.length === 0) return text;
  return text.replace(EMOJI_SEQUENCE_RE, (sequence) => {
    const description = describeEmoji(sequence);
    return description === null ? '[表情]' : `[表情:${description}]`;
  });
}

/**
 * 查询一条 Emoji 序列的中文描述；数据表与覆盖表均未收录时返回 null。
 */
export function describeEmoji(sequence: string): string | null {
  for (const candidate of emojiCandidates(sequence)) {
    const name = OVERRIDES[candidate] ?? EMOJI_NAMES[candidate];
    if (name) return name;
  }
  return null;
}

function emojiCandidates(sequence: string): string[] {
  const withoutSelectors = sequence.replace(VARIATION_SELECTOR_RE, '');
  const withoutSkinTone = withoutSelectors.replace(SKIN_TONE_RE, '');
  if (withoutSkinTone === withoutSelectors) return [withoutSelectors];
  return [withoutSelectors, withoutSkinTone];
}
