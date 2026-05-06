import type { Lock, QueueEntry, StateAdapter } from "chat";

export function createMemoryState(): StateAdapter {
  const values = new Map<string, { value: unknown; expiresAt?: number }>();
  const lists = new Map<string, unknown[]>();
  const locks = new Map<string, Lock>();
  const subscriptions = new Set<string>();
  const queues = new Map<string, QueueEntry[]>();

  const alive = (key: string) => {
    const entry = values.get(key);
    if (entry?.expiresAt && entry.expiresAt <= Date.now()) {
      values.delete(key);
      return null;
    }
    return entry ?? null;
  };

  return {
    async connect() {},
    async disconnect() {},
    async acquireLock(threadId, ttlMs) {
      const existing = locks.get(threadId);
      if (existing && existing.expiresAt > Date.now()) return null;
      const lock = { threadId, token: crypto.randomUUID(), expiresAt: Date.now() + ttlMs };
      locks.set(threadId, lock);
      return lock;
    },
    async releaseLock(lock) {
      if (locks.get(lock.threadId)?.token === lock.token) locks.delete(lock.threadId);
    },
    async extendLock(lock, ttlMs) {
      if (locks.get(lock.threadId)?.token !== lock.token) return false;
      locks.set(lock.threadId, { ...lock, expiresAt: Date.now() + ttlMs });
      return true;
    },
    async forceReleaseLock(threadId) {
      locks.delete(threadId);
    },
    async get(key) {
      return (alive(key)?.value as never) ?? null;
    },
    async set(key, value, ttlMs) {
      values.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined });
    },
    async setIfNotExists(key, value, ttlMs) {
      if (alive(key)) return false;
      values.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined });
      return true;
    },
    async delete(key) {
      values.delete(key);
      lists.delete(key);
    },
    async appendToList(key, value, options) {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, options?.maxLength ? list.slice(-options.maxLength) : list);
    },
    async getList(key) {
      return (lists.get(key) as never[]) ?? [];
    },
    async subscribe(threadId) {
      subscriptions.add(threadId);
    },
    async unsubscribe(threadId) {
      subscriptions.delete(threadId);
    },
    async isSubscribed(threadId) {
      return subscriptions.has(threadId);
    },
    async enqueue(threadId, entry, maxSize) {
      const queue = queues.get(threadId) ?? [];
      queue.push(entry);
      queues.set(threadId, queue.slice(-maxSize));
      return queues.get(threadId)?.length ?? 0;
    },
    async dequeue(threadId) {
      return queues.get(threadId)?.shift() ?? null;
    },
    async queueDepth(threadId) {
      return queues.get(threadId)?.length ?? 0;
    },
  };
}
