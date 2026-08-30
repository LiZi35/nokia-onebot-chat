import WebSocket from 'ws';
import type { OneBotSocket, SocketEventHandlers, SocketFactory } from './socket.js';

export class WsSocket implements OneBotSocket {
  private ws: WebSocket | null = null;

  connect(url: string, handlers: SocketEventHandlers): void {
    this.ws = new WebSocket(url);
    this.ws.on('open', handlers.onOpen);
    this.ws.on('message', (data) => handlers.onMessage(String(data)));
    this.ws.on('error', handlers.onError);
    this.ws.on('close', (code, reason) => handlers.onClose(code, reason.toString()));
  }

  send(data: string): void {
    this.ws?.send(data);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

export const wsSocketFactory: SocketFactory = (url, handlers) => {
  const socket = new WsSocket();
  socket.connect(url, handlers);
  return socket;
};
