import { readFile } from "fs/promises";
import { generateText, stepCountIs, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getAuctionDetails } from "./bat-detail";
import { readFilterConfig, type AuctionFilterConfig } from "./filter-config";
import { createAuctionStore, type AuctionWithHistory } from "./upstash-store";

const CRITERIA_PATH = new URL("../../criteria.md", import.meta.url);

const auctionSchema = z.object({
  id: z.number().optional(),
  title: z.string(),
  url: z.string().optional(),
  currentBid: z.string().optional(),
  currentBidAmount: z.number().optional(),
  currency: z.string().optional(),
  location: z.string().optional(),
  countryCode: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  timeLeft: z.string().optional(),
  timestampEnd: z.number().optional(),
  year: z.string().optional(),
  era: z.string().optional(),
  categories: z.array(z.string()).default([]),
  thumbnailUrl: z.string().optional(),
  noReserve: z.boolean().optional(),
  premium: z.boolean().optional(),
  repeat: z.boolean().optional(),
  searchable: z.string().optional(),
  description: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

const alertMatchSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  currentBid: z.string().nullable(),
  location: z.string().nullable(),
  timeLeft: z.string().nullable(),
  alreadySeen: z.boolean(),
  changesSinceLastSeen: z.array(z.string()),
  reason: z.string(),
  concerns: z.array(z.string()),
});

const alertSchema = z.object({
  matches: z.array(
    alertMatchSchema,
  ),
  message: z.string(),
});

export type Auction = z.infer<typeof auctionSchema>;
export type AlertMatch = z.infer<typeof alertSchema>["matches"][number];
export type BatAlertResult = Awaited<ReturnType<typeof runBatAlert>>;

type RunBatAlertOptions = {
  contextId?: string;
};

export async function runBatAlert(options: RunBatAlertOptions = {}) {
  const contextId = options.contextId ?? "default";
  const [criteria, config] = await Promise.all([
    readFile(CRITERIA_PATH, "utf8"),
    readFilterConfig(),
  ]);
  const html = await fetchAuctionHtml(config.sourceUrl);
  const extractedAuctions = extractAuctionsFromHtml(html);
  const filteredAuctions = filterTargetAuctions(extractedAuctions, config);
  const store = createAuctionStore();
  const auctionsWithHistory = await store.annotateAndStoreAuctions(
    filteredAuctions.slice(0, config.maxCandidatesForGpt),
    config,
    contextId,
  );
  const chatHistory = await store.getRecentChatMessages(
    config.historyMessagesForContext,
    contextId,
  );
  const decision = await runAuctionAgent(auctionsWithHistory, criteria, chatHistory);
  await store.appendAlertMessage(decision.message, config, contextId);

  return {
    checkedAt: new Date().toISOString(),
    contextId,
    sourceUrl: config.sourceUrl,
    criteria,
    filter: config,
    extractedAuctionCount: extractedAuctions.length,
    auctionCount: filteredAuctions.length,
    matches: decision.matches,
    message: decision.message,
  };
}

async function fetchAuctionHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; auction-alert/1.0; +https://vercel.com)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Bring a Trailer returned ${response.status}`);
  }

  return response.text();
}

export function extractAuctionsFromHtml(html: string) {
  const jsonValues = extractJsonValues(html);
  const candidates = new Map<string, Auction>();

  for (const value of jsonValues) {
    for (const item of collectAuctionLikeObjects(value)) {
      const auction = normalizeAuction(item);
      if (!auction) continue;

      const key = auction.url || auction.title;
      candidates.set(key, auction);
    }
  }

  return [...candidates.values()];
}

export function filterTargetAuctions(
  auctions: Auction[],
  config: AuctionFilterConfig,
  now = new Date(),
) {
  const latestEndSeconds =
    config.endingWithinHours === null
      ? Number.POSITIVE_INFINITY
      : Math.floor(now.getTime() / 1000) + config.endingWithinHours * 60 * 60;

  return auctions.filter((auction) => {
    const currentBid = auction.currentBidAmount;
    const isAllowedCountry =
      config.countries.length === 0 ||
      (auction.location !== undefined && config.countries.includes(auction.location));
    const isAllowedCurrency =
      config.currencies.length === 0 ||
      (auction.currency !== undefined && config.currencies.includes(auction.currency));
    const hasBid = typeof currentBid === "number" && currentBid > 0;
    const allowsNoBid = config.includeNoBidAuctions && currentBid === 0;
    const isAtOrAboveMin =
      config.minCurrentBid === null ||
      (typeof currentBid === "number" && currentBid >= config.minCurrentBid);
    const isAtOrBelowMax =
      config.maxCurrentBid === null ||
      (typeof currentBid === "number" && currentBid <= config.maxCurrentBid);
    const endsBeforeLimit =
      typeof auction.timestampEnd === "number" &&
      auction.timestampEnd <= latestEndSeconds;
    const matchesIncludedCategories =
      config.includeCategories.length === 0 ||
      auction.categories.some((category) => config.includeCategories.includes(category));
    const avoidsExcludedCategories = !auction.categories.some((category) =>
      config.excludeCategories.includes(category),
    );
    const premiumAllowed = config.includePremium || !auction.premium;
    const repeatAllowed = config.includeRepeatListings || !auction.repeat;

    return (
      isAllowedCountry &&
      isAllowedCurrency &&
      (hasBid || allowsNoBid) &&
      isAtOrAboveMin &&
      isAtOrBelowMax &&
      endsBeforeLimit &&
      matchesIncludedCategories &&
      avoidsExcludedCategories &&
      premiumAllowed &&
      repeatAllowed
    );
  });
}

function extractJsonValues(html: string) {
  const values: unknown[] = [];
  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html))) {
    const script = match[1].trim();
    if (!script) continue;

    const direct = parseJson(script);
    if (direct) {
      values.push(direct);
      continue;
    }

    for (const jsonText of findBalancedJson(script)) {
      const parsed = parseJson(jsonText);
      if (parsed) values.push(parsed);
    }
  }

  return values;
}

function findBalancedJson(source: string) {
  const chunks: string[] = [];
  const starts = [...source.matchAll(/[=:]\s*({|\[)/g)];

  for (const start of starts) {
    const open = start[1];
    const close = open === "{" ? "}" : "]";
    const index = start.index === undefined ? 0 : start.index + start[0].lastIndexOf(open);
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = index; i < source.length; i += 1) {
      const char = source[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth === 0) {
        chunks.push(source.slice(index, i + 1));
        break;
      }
    }
  }

  return chunks;
}

function collectAuctionLikeObjects(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  function visit(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const object = node as Record<string, unknown>;
    const keys = Object.keys(object).map((key) => key.toLowerCase());
    const hasTitle = keys.some((key) => /title|name|post_title/.test(key));
    const hasUrl = keys.some((key) => /url|link|permalink/.test(key));
    const hasAuctionSignal = keys.some((key) =>
      /bid|auction|ending|ends|time|location|reserve/.test(key),
    );

    if (hasTitle && (hasUrl || hasAuctionSignal)) {
      found.push(object);
    }

    for (const child of Object.values(object)) visit(child);
  }

  visit(value);
  return found;
}

function normalizeAuction(item: Record<string, unknown>) {
  const title = firstString(item, [
    "title",
    "name",
    "post_title",
    "auction_title",
    "listing_title",
  ]);
  const url = firstString(item, ["url", "link", "permalink", "href", "auction_url"]);

  if (!title || !looksLikeCarAuction(title, url)) return null;

  return auctionSchema.parse({
    id: firstNumber(item, ["id", "ID"]),
    title: stripTags(title),
    url,
    currentBid:
      firstString(item, ["current_bid_formatted", "currentBidFormatted"]) ??
      firstString(item, [
        "current_bid",
        "currentBid",
        "bid",
        "bid_amount",
        "high_bid",
        "price",
      ]),
    currentBidAmount: firstNumber(item, [
      "current_bid",
      "currentBid",
      "bid",
      "bid_amount",
      "high_bid",
      "price",
    ]),
    currency: firstString(item, ["currency"]),
    location: firstString(item, ["location", "loc", "seller_location", "country"]),
    countryCode: firstString(item, ["country_code", "countryCode"]),
    latitude: firstString(item, ["lat", "latitude"]),
    longitude: firstString(item, ["lon", "lng", "longitude"]),
    timeLeft:
      firstString(item, ["time_left", "timeLeft", "ending", "ends", "ends_at"]) ??
      formatTimestampEnd(firstNumber(item, ["timestamp_end", "timestampEnd"])),
    timestampEnd: firstNumber(item, ["timestamp_end", "timestampEnd"]),
    year: firstString(item, ["year"]),
    era: firstString(item, ["era"]),
    categories: firstStringArray(item, ["categories"]),
    thumbnailUrl: firstString(item, ["thumbnail_url", "thumbnailUrl"]),
    noReserve: firstBoolean(item, ["noreserve", "noReserve"]),
    premium: firstBoolean(item, ["premium"]),
    repeat: firstBoolean(item, ["repeat"]),
    searchable: firstString(item, ["searchable"]),
    description: firstString(item, ["description", "excerpt", "content", "subtitle"]),
    raw: item,
  });
}

function firstString(
  item: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return decodeHtmlEntities(value.trim());
    if (typeof value === "number") return String(value);
  }

  return undefined;
}

function firstNumber(
  item: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const number = Number(value.replace(/[^\d.]/g, ""));
      if (Number.isFinite(number)) return number;
    }
  }

  return undefined;
}

function firstBoolean(
  item: Record<string, unknown>,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "boolean") return value;
  }

  return undefined;
}

function firstStringArray(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (Array.isArray(value)) {
      return value
        .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
        .map(String);
    }
  }

  return [];
}

function formatTimestampEnd(timestamp?: number) {
  if (!timestamp) return undefined;
  return new Date(timestamp * 1000).toISOString();
}

function looksLikeCarAuction(title: string, url?: string) {
  const combined = `${title} ${url ?? ""}`.toLowerCase();
  return (
    /bringatrailer\.com|\/listing\/|\/auction\//.test(combined) ||
    /\b(19|20)\d{2}\b/.test(combined)
  );
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

async function runAuctionAgent(
  auctions: AuctionWithHistory[],
  criteria: string,
  chatHistory: unknown[],
) {
  if (auctions.length === 0) {
    return {
      matches: [],
      message: "No BaT auctions matched the configured filters today.",
    };
  }

  const { text } = await generateText({
    model: openai("gpt-5.5"),
    system: [
      "You are a selective car auction scout and iMessage alert writer.",
      "Use the user's criteria to decide which auctions are worth alerting on. Prefer precision over recall.",
      "You have a getAuctionDetails tool for fetching a Bring a Trailer listing page summary with description, essentials, comments, seller comments, and bid history.",
      "Use the tool for cars you are seriously considering or when list-page data is not enough to judge transmission, condition, title, seller answers, or price risk.",
      "Write the final message yourself in the same response. Plain text only. Do not use Markdown, bullets, numbered lists, tables, bold, italics, or inline links.",
      "Do not include URLs in the message; matching auction links are sent as separate messages.",
      "Return exactly one JSON object with keys matches and message. No code fence, no commentary outside JSON.",
      "Each match needs: title, url, currentBid, location, timeLeft, alreadySeen, changesSinceLastSeen, reason, concerns.",
    ].join("\n"),
    prompt: [
      "Criteria markdown:",
      criteria,
      "",
      "Recent prior chat/alert history JSON:",
      JSON.stringify(chatHistory),
      "",
      "Candidate auctions JSON. If alreadySeen is true, consider changesSinceLastSeen and tell the user it has already been seen:",
      JSON.stringify(auctions),
      "",
      "Pick only the auctions that clearly match the criteria, then write the message to send to the user.",
      "The message should be conversational and concise. If nothing is worth alerting on, say that plainly.",
      "Return JSON matching this TypeScript shape:",
      JSON.stringify({
        matches: [
          {
            title: "string",
            url: "string | null",
            currentBid: "string | null",
            location: "string | null",
            timeLeft: "string | null",
            alreadySeen: false,
            changesSinceLastSeen: ["string"],
            reason: "string",
            concerns: ["string"],
          },
        ],
        message: "string",
      }),
    ].join("\n"),
    tools: {
      getAuctionDetails: tool({
        description:
          "Fetch a public Bring a Trailer listing page and return compact listing details, BaT Essentials, recent comments, seller comments, and bid history.",
        inputSchema: z.object({
          url: z.string().url().describe("The Bring a Trailer listing URL to inspect."),
        }),
        execute: async ({ url }) => getAuctionDetails(url),
      }),
    },
    stopWhen: stepCountIs(8),
  });

  return alertSchema.parse(parseJsonObjectFromText(text));
}

function parseJsonObjectFromText(text: string) {
  const trimmed = text.trim();
  const direct = parseJson(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsedFence = parseJson(fenced[1].trim());
    if (parsedFence) return parsedFence;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const parsedSlice = parseJson(trimmed.slice(start, end + 1));
    if (parsedSlice) return parsedSlice;
  }

  throw new Error("Model did not return parseable alert JSON.");
}
