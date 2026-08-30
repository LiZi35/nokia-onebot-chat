import { z } from 'zod';

export const chatTypeSchema = z.enum(['private', 'group']);

export const peerIdSchema = z.coerce.number().int().positive();

export const sendMessageBodySchema = z.object({
  message: z.string(),
  _csrf: z.string().min(1),
});

export const loginBodySchema = z.object({
  username: z.string().max(256),
  password: z.string().max(256),
  _csrf: z.string().min(1),
});

export function parseChatType(value: unknown): 'private' | 'group' | null {
  const result = chatTypeSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parsePeerId(value: unknown): number | null {
  const result = peerIdSchema.safeParse(value);
  return result.success ? result.data : null;
}
