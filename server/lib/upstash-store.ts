import { Redis } from "@upstash/redis";
import type { UIMessage } from "ai";
import type { Auction } from "./bat-alert";
import type { AuctionFilterConfig } from "./filter-config";
import { readEnv, readEnvAlias } from "./env";

type StoredAuctionSnapshot = {
  auction: Auction;
  seenAt: string;
  lastSeenAt: string;
};

type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AuctionWithHistory = Auction & {
  alreadySeen: boolean;
  firstSeenAt?: string;
  lastSeenAt?: string;
  changesSinceLastSeen: string[];
};

const HISTORY_KEY = "auction-alert:chat-history";
const ALERT_HISTORY_KEY = "auction-alert:alert-history";

export function createAuctionStore() {
  const url = readEnv("UPSTASH_REDIS_REST_URL");
  const token = readEnv("UPSTASH_REDIS_REST_TOKEN");

  if (!url || !token) {
    return new NoopAuctionStore();
  }

  return new UpstashAuctionStore(
    new Redis({ url, token }),
    readEnvAlias("AUCTION_ALERT_NAMESPACE") ?? "default",
  );
}

class NoopAuctionStore {
  async annotateAndStoreAuctions(auctions: Auction[]) {
    return auctions.map((auction) => ({
      ...auction,
      alreadySeen: false,
      changesSinceLastSeen: [],
    }));
  }

  async getRecentChatMessages() {
    return [];
  }

  async appendChatMessages() {}

  async appendAlertMessage() {}

  async appendChatHistoryEntry() {}
}

class UpstashAuctionStore {
  constructor(
    private redis: Redis,
    private namespace: string,
  ) {}

  async annotateAndStoreAuctions(
    auctions: Auction[],
    config: AuctionFilterConfig,
    contextId = "default",
  ) {
    const now = new Date().toISOString();
    const ttlSeconds = config.auctionSnapshotTtlDays * 24 * 60 * 60;

    return Promise.all(
      auctions.map(async (auction) => {
        const key = this.auctionKey(auction, contextId);
        const previous = await this.redis.get<StoredAuctionSnapshot>(key);
        const changesSinceLastSeen = previous
          ? describeAuctionChanges(previous.auction, auction)
          : [];

        const snapshot: StoredAuctionSnapshot = {
          auction,
          seenAt: previous?.seenAt ?? now,
          lastSeenAt: now,
        };

        await this.redis.set(key, snapshot, { ex: ttlSeconds });

        return {
          ...auction,
          alreadySeen: Boolean(previous),
          firstSeenAt: previous?.seenAt,
          lastSeenAt: previous?.lastSeenAt,
          changesSinceLastSeen,
        };
      }),
    );
  }

  async getRecentChatMessages(limit: number, contextId = "default") {
    if (limit === 0) return [];
    return this.redis.lrange<UIMessage | ChatHistoryEntry>(
      this.contextKey(HISTORY_KEY, contextId),
      0,
      limit - 1,
    );
  }

  async appendChatMessages(
    messages: UIMessage[],
    config: AuctionFilterConfig,
    contextId = "default",
  ) {
    if (messages.length === 0) return;

    const key = this.contextKey(HISTORY_KEY, contextId);
    await this.redis.lpush(key, ...messages);
    await this.redis.ltrim(key, 0, 49);
    await this.redis.expire(key, config.chatHistoryTtlDays * 24 * 60 * 60);
  }

  async appendAlertMessage(
    message: string,
    config: AuctionFilterConfig,
    contextId = "default",
  ) {
    const key = this.contextKey(ALERT_HISTORY_KEY, contextId);
    await this.redis.lpush(key, {
      role: "assistant",
      content: message,
      createdAt: new Date().toISOString(),
    });
    await this.redis.ltrim(key, 0, 49);
    await this.redis.expire(key, config.chatHistoryTtlDays * 24 * 60 * 60);
  }

  async appendChatHistoryEntry(
    entry: Omit<ChatHistoryEntry, "createdAt">,
    config: AuctionFilterConfig,
    contextId = "default",
  ) {
    const key = this.contextKey(HISTORY_KEY, contextId);
    await this.redis.lpush(key, {
      ...entry,
      createdAt: new Date().toISOString(),
    });
    await this.redis.ltrim(key, 0, 49);
    await this.redis.expire(key, config.chatHistoryTtlDays * 24 * 60 * 60);
  }

  private auctionKey(auction: Auction, contextId: string) {
    return this.contextKey(
      `auction:${auction.id ?? auction.url ?? auction.title}`,
      contextId,
    );
  }

  private contextKey(value: string, contextId: string) {
    return this.key(`context:${encodeURIComponent(contextId)}:${value}`);
  }

  private key(value: string) {
    return `auction-alert:${this.namespace}:${value}`;
  }
}

function describeAuctionChanges(previous: Auction, current: Auction) {
  const changes: string[] = [];

  if (previous.currentBidAmount !== current.currentBidAmount) {
    changes.push(
      `Bid changed from ${previous.currentBid ?? "unknown"} to ${
        current.currentBid ?? "unknown"
      }.`,
    );
  }
  if (previous.timestampEnd !== current.timestampEnd) {
    changes.push(
      `End time changed from ${previous.timeLeft ?? "unknown"} to ${
        current.timeLeft ?? "unknown"
      }.`,
    );
  }
  if (previous.title !== current.title) {
    changes.push(`Title changed from "${previous.title}" to "${current.title}".`);
  }
  if (previous.description !== current.description) {
    changes.push("Listing excerpt changed.");
  }

  return changes;
}
