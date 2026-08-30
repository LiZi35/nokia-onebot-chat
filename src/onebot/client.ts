import type { OneBotMessageEvent, ConnectionState } from './types.js';
import {
  OneBotConnectionError,
  OneBotTimeoutError,
  OneBotApiError,
  OneBotProtocolError,
} from './errors.js';
import type { OneBotSocket, SocketFactory } from './socket.js';
import type { Logger } from '../logger.js';

export interface OneBotClientOptions {
  wsUrl: string;
  socketFactory: SocketFactory;
  logger: Logger;
  apiTimeoutMs: number;
  connectTimeoutMs: number;
  reconnectMinDelayMs: number;
  reconnectMaxDelayMs: number;
  maxReconnectAttempts: number;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export type MessageEventHandler = (event: OneBotMessageEvent) => void;
export type StateChangeHandler = (state: ConnectionState) => void;

export interface OneBotClient {
  connect(): void;
  close(): void;
  sendApi<T>(action: string, params: Record<string, unknown>): Promise<T>;
  getState(): ConnectionState;
  onMessage(handler: MessageEventHandler): () => void;
  onStateChange(handler: StateChangeHandler): () => void;
}

export class OneBotWebSocketClient implements OneBotClient {
  private readonly options: OneBotClientOptions;
  private socket: OneBotSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private echoCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly messageHandlers = new Set<MessageEventHandler>();
  private readonly stateHandlers = new Set<StateChangeHandler>();

  constructor(options: OneBotClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.failAllPending(new OneBotConnectionError('连接已关闭'));
    this.setState('disconnected');
  }

  getState(): ConnectionState {
    return this.state;
  }

  sendApi<T>(action: string, params: Record<string, unknown>): Promise<T> {
    if (this.state !== 'connected' || !this.socket) {
      return Promise.reject(new OneBotConnectionError('OneBot 服务未连接'));
    }

    const echo = `echo-${++this.echoCounter}-${Date.now().toString(36)}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new OneBotTimeoutError(`API 请求超时: ${action}`));
      }, this.options.apiTimeoutMs);

      this.pending.set(echo, { resolve: resolve as (d: unknown) => void, reject, timer });

      try {
        this.socket?.send(JSON.stringify({ action, params, echo }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(new OneBotConnectionError('发送请求失败'));
      }
    });
  }

  onMessage(handler: MessageEventHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private openSocket(): void {
    if (this.closed || this.socket) return;

    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.options.logger.info('正在连接 OneBot WebSocket', { url: this.options.wsUrl });

    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      if (this.socket) {
        this.options.logger.warn('OneBot 连接超时');
        this.socket.close();
        this.socket = null;
        this.scheduleReconnect();
      }
    }, this.options.connectTimeoutMs);

    const socket = this.options.socketFactory(this.options.wsUrl, {
      onOpen: () => this.handleOpen(),
      onMessage: (data) => this.handleMessage(data),
      onError: (err) => this.handleError(err),
      onClose: (code, reason) => this.handleClose(code, reason),
    });
    this.socket = socket;
  }

  private handleOpen(): void {
    this.clearConnectTimer();
    this.reconnectAttempts = 0;
    this.setState('connected');
    this.options.logger.info('OneBot WebSocket 已连接');
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.options.logger.warn('收到无法解析的消息');
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this.options.logger.warn('收到非对象消息');
      return;
    }

    const record = parsed as Record<string, unknown>;

    if ('echo' in record) {
      this.handleApiResponse(record);
      return;
    }

    if (record.post_type === 'message') {
      this.dispatchMessageEvent(record);
      return;
    }

    if (record.post_type === 'meta_event' || record.post_type === 'notice') {
      this.options.logger.debug('收到事件', { post_type: String(record.post_type) });
    }
  }

  private handleApiResponse(record: Record<string, unknown>): void {
    const echo = String(record.echo);
    const pending = this.pending.get(echo);
    if (!pending) {
      this.options.logger.debug('收到未匹配的响应', { echo });
      return;
    }

    this.pending.delete(echo);
    clearTimeout(pending.timer);

    const status = record.status;
    if (status === 'ok') {
      pending.resolve(record.data);
      return;
    }

    if (status === 'async') {
      pending.resolve(record.data);
      return;
    }

    if (status === 'failed') {
      const retcode = typeof record.retcode === 'number' ? record.retcode : -1;
      const message = String(record.message ?? record.wording ?? 'OneBot API 调用失败');
      pending.reject(new OneBotApiError(message, retcode));
      return;
    }

    pending.reject(new OneBotProtocolError('未知的 OneBot 响应状态'));
  }

  private dispatchMessageEvent(record: Record<string, unknown>): void {
    const event = parseMessageEvent(record);
    if (!event) return;
    for (const handler of this.messageHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.options.logger.error('消息处理出错', { error: errMessage(err) });
      }
    }
  }

  private handleError(err: Error): void {
    this.options.logger.warn('OneBot WebSocket 错误', { error: err.message });
  }

  private handleClose(code: number, reason: string): void {
    this.clearConnectTimer();
    if (this.socket) {
      this.socket = null;
    }
    this.failAllPending(new OneBotConnectionError('连接已断开'));
    if (this.closed) return;
    this.options.logger.warn('OneBot 连接已断开', { code, reason });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setState('disconnected');
      this.options.logger.error('OneBot 重连次数达到上限，停止重连');
      return;
    }

    const attempt = this.reconnectAttempts++;
    const base = this.options.reconnectMinDelayMs * 2 ** attempt;
    const jitter = Math.random() * 0.3 + 0.85;
    const delay = Math.min(this.options.reconnectMaxDelayMs, Math.round(base * jitter));

    this.setState('reconnecting');
    this.options.logger.info('将在稍后重连', { delayMs: delay, attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch (err) {
        this.options.logger.error('状态回调出错', { error: errMessage(err) });
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
}

function parseMessageEvent(record: Record<string, unknown>): OneBotMessageEvent | null {
  const messageType = record.message_type;
  if (messageType !== 'private' && messageType !== 'group') {
    return null;
  }
  if (typeof record.message_id !== 'number' && typeof record.message_id !== 'string') {
    return null;
  }
  return record as unknown as OneBotMessageEvent;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
