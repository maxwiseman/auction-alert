import { readFile } from "node:fs/promises";
import { z } from "zod";

const CHAT_CONFIG_PATH = new URL("../../chat-config.json", import.meta.url);

const chatConfigSchema = z.object({
  userName: z.string().default("auction-alert"),
  delivery: z
    .object({
      enabled: z.boolean().default(false),
      threadId: z.string().nullable().default(null),
    })
    .default({ enabled: false, threadId: null }),
  imessageGateway: z
    .object({
      enabled: z.boolean().default(true),
      listenerDurationMs: z.number().int().positive().default(600_000),
    })
    .default({ enabled: true, listenerDurationMs: 600_000 }),
});

export type ChatConfig = z.infer<typeof chatConfigSchema>;

export async function readChatConfig() {
  const raw = await readFile(CHAT_CONFIG_PATH, "utf8");
  return chatConfigSchema.parse(JSON.parse(raw));
}
