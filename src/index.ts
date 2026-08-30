import 'dotenv/config';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { createApp } from './web/app.js';
import { OneBotWebSocketClient } from './onebot/client.js';
import { wsSocketFactory } from './onebot/ws-socket.js';
import { MessageStore } from './domain/message-store.js';
import { ChatService } from './domain/chat-service.js';
import { openDatabase } from './db/database.js';
import { SqliteSessionStore } from './db/session-store.js';
import { SqliteMessageRepository } from './db/message-repository.js';

const result = loadConfig();
if (!result.ok || !result.config) {
  console.error(`配置错误：\n${(result.errors ?? []).join('\n')}`);
  process.exit(1);
}
const config = result.config;

if (config.authUsername.length > 0 && config.authPassword.length > 0) {
  logger.info('登录鉴权已启用');
} else {
  logger.warn('未配置 AUTH_USERNAME / AUTH_PASSWORD，登录鉴权已禁用');
}

const db = openDatabase(config.dbPath);
const sessionStore = new SqliteSessionStore(db);
const messageRepository = new SqliteMessageRepository(db);

const client = new OneBotWebSocketClient({
  wsUrl: config.onebotWsUrl,
  socketFactory: wsSocketFactory,
  logger,
  apiTimeoutMs: config.apiTimeoutMs,
  connectTimeoutMs: config.connectTimeoutMs,
  reconnectMinDelayMs: config.reconnectMinDelayMs,
  reconnectMaxDelayMs: config.reconnectMaxDelayMs,
  maxReconnectAttempts: config.maxReconnectAttempts,
});

const store = new MessageStore(
  {
    maxSessions: config.maxSessions,
    messagesPerSession: config.messagesPerSession,
  },
  messageRepository,
);

const chatService = new ChatService({
  client,
  store,
  logger,
  messageMaxLength: config.messageMaxLength,
});
chatService.start();

const app = createApp({ config, logger, chatService, sessionStore });

const server = app.listen(config.port, () => {
  logger.info('Web 服务已启动', { port: config.port, dbPath: config.dbPath });
});

function shutdown(): void {
  logger.info('正在关闭…');
  chatService.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
