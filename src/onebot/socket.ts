export interface SocketEventHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onError: (error: Error) => void;
  onClose: (code: number, reason: string) => void;
}

export interface OneBotSocket {
  connect(url: string, handlers: SocketEventHandlers): void;
  send(data: string): void;
  close(): void;
  readonly readyState: number;
}

export type SocketFactory = (url: string, handlers: SocketEventHandlers) => OneBotSocket;
