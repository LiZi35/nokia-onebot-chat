/**
 * OneBot v11 协议类型（仅实现本项目所需子集）。
 */

export interface OneBotApiResponse<T> {
  status: 'ok' | 'failed' | 'async';
  retcode: number;
  data: T;
  echo?: string | number;
  message?: string;
  wording?: string;
}

export interface OneBotEventBase {
  time: number;
  self_id: number;
  post_type: string;
  [key: string]: unknown;
}

export interface OneBotMessageSender {
  user_id: number;
  nickname?: string;
  card?: string;
  sex?: string;
  age?: number;
}

export interface OneBotMessageEvent extends OneBotEventBase {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type: string;
  message_id: number;
  user_id: number;
  message: unknown;
  raw_message?: string;
  font?: number;
  sender?: OneBotMessageSender;
  group_id?: number;
  anonymous?: unknown;
}

export type OneBotMessageSegment =
  { type: 'text'; data: { text: string } } | { type: string; data: Record<string, unknown> };

export interface FriendInfo {
  user_id: number;
  nickname: string;
  remark?: string;
}

export interface GroupInfo {
  group_id: number;
  group_name: string;
  member_count?: number;
  max_member_count?: number;
}

export interface SendPrivateMsgParams {
  user_id: number;
  message: string;
  auto_escape?: boolean;
}

export interface SendGroupMsgParams {
  group_id: number;
  message: string;
  auto_escape?: boolean;
}

export interface SendMsgParams {
  message_type: 'private' | 'group';
  user_id?: number;
  group_id?: number;
  message: string | OneBotMessageSegment[];
  auto_escape?: boolean;
}

export interface SendMessageResult {
  message_id: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
