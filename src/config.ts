import { z } from 'zod';

const boolFromEnv = z
  .string()
  .default('false')
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const intFromEnv = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const ConfigSchema = z.object({
  onebotWsUrl: z
    .string()
    .url()
    .default('ws://127.0.0.1:3001')
    .describe('OneBot v11 WebSocket 服务地址'),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  dbPath: z.string().min(1).default('./data/chat.db'),
  sessionKeys: z
    .string()
    .min(1)
    .default('nokia-onebot-chat-dev-secret')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  cookieSecure: boolFromEnv,
  trustProxy: boolFromEnv,
  authUsername: z.string().default(''),
  authPassword: z.string().default(''),
  messageMaxLength: intFromEnv(4000, 1, 100000),
  maxSessions: intFromEnv(100, 1, 100000),
  messagesPerSession: intFromEnv(100, 1, 10000),
  apiTimeoutMs: intFromEnv(10000, 100, 300000),
  connectTimeoutMs: intFromEnv(10000, 100, 300000),
  reconnectMinDelayMs: intFromEnv(1000, 100, 60000),
  reconnectMaxDelayMs: intFromEnv(30000, 100, 600000),
  maxReconnectAttempts: intFromEnv(10, 1, 1000),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export interface ConfigParseResult {
  ok: boolean;
  config?: AppConfig;
  errors?: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigParseResult {
  const parsed = ConfigSchema.safeParse({
    onebotWsUrl: env.ONEBOT_WS_URL,
    port: env.PORT,
    dbPath: env.DB_PATH,
    sessionKeys: env.SESSION_KEYS,
    cookieSecure: env.COOKIE_SECURE,
    trustProxy: env.TRUST_PROXY,
    authUsername: env.AUTH_USERNAME,
    authPassword: env.AUTH_PASSWORD,
    messageMaxLength: env.MESSAGE_MAX_LENGTH,
    maxSessions: env.MAX_SESSIONS,
    messagesPerSession: env.MESSAGES_PER_SESSION,
    apiTimeoutMs: env.ONEBOT_API_TIMEOUT_MS,
    connectTimeoutMs: env.ONEBOT_CONNECT_TIMEOUT_MS,
    reconnectMinDelayMs: env.ONEBOT_RECONNECT_MIN_DELAY_MS,
    reconnectMaxDelayMs: env.ONEBOT_RECONNECT_MAX_DELAY_MS,
    maxReconnectAttempts: env.ONEBOT_MAX_RECONNECT_ATTEMPTS,
  });

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  if (parsed.data.reconnectMinDelayMs > parsed.data.reconnectMaxDelayMs) {
    return {
      ok: false,
      errors: ['ONEBOT_RECONNECT_MIN_DELAY_MS 不能大于 ONEBOT_RECONNECT_MAX_DELAY_MS'],
    };
  }

  return { ok: true, config: parsed.data };
}
