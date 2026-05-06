import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Redis } from "@upstash/redis";

export type ConversationSettings = {
  criteria: string;
  criteriaUpdatedAt?: string;
};

const keyPrefix = "auction-alert:conversation";
let redis: Redis | undefined;

export async function getConversationCriteria(conversationId?: string) {
  if (!conversationId) return readDefaultCriteria();

  const stored = await getConversationSettings(conversationId);
  return stored.criteria;
}

export async function updateConversationCriteria(conversationId: string | undefined, criteria: string) {
  if (!conversationId) {
    throw new Error("No active conversation. Criteria can only be updated from a SendBlue conversation.");
  }

  const settings: ConversationSettings = {
    criteria: criteria.trim(),
    criteriaUpdatedAt: new Date().toISOString(),
  };

  await getRedis().set(settingsKey(conversationId), settings);
  return settings;
}

export async function getConversationSettings(conversationId: string): Promise<ConversationSettings> {
  if (!hasRedisEnv()) return { criteria: await readDefaultCriteria() };

  const stored = await getRedis().get<ConversationSettings>(settingsKey(conversationId));
  if (stored?.criteria) return stored;
  return { criteria: await readDefaultCriteria() };
}

export async function readDefaultCriteria() {
  return readFile(join(process.cwd(), "config", "criteria.md"), "utf8");
}

function getRedis() {
  if (redis) return redis;

  if (!hasRedisEnv()) {
    throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to persist per-conversation criteria.");
  }

  redis = Redis.fromEnv();
  return redis;
}

function settingsKey(conversationId: string) {
  return `${keyPrefix}:${conversationId}`;
}

function hasRedisEnv() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
