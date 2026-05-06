import filters from "../config/filters.json" with { type: "json" };

export type Auction = {
  id: string;
  title: string;
  url: string;
  countryCode?: string;
  location?: string;
  currentBidUsd?: number;
  currentBidFormatted?: string;
  endsAt?: string;
  hoursRemaining?: number;
  imageUrl?: string;
  excerpt?: string;
  noReserve?: boolean;
  premium?: boolean;
  year?: string;
  origin?: string;
};

export type AuctionSummary = {
  title: string;
  url: string;
  currentBidUsd?: number;
  currentBidFormatted?: string;
  endsAt?: string;
  hoursRemaining?: number;
};

export type AuctionDetails = {
  url: string;
  title: string;
  currentBid?: string;
  currentBidUsd?: number;
  timeRemaining?: string;
  hoursRemaining?: number;
  endsAt?: string;
  bids?: string;
  description: string;
  essentials: string[];
  sellerComments: string[];
  recentComments: string[];
  bidHistory: string[];
};

export type AuctionFilters = typeof filters;
export type AuctionFilterOptions = Partial<Omit<AuctionFilters, "sourceUrl">> & {
  minYear?: number;
  maxYear?: number;
  origins?: string[];
};

const moneyPattern = /\$([\d,]+)/;
const auctionsInitialDataPattern =
  /<script[^>]+id=['"]bat-theme-auctions-current-initial-data['"][^>]*>[\s\S]*?var\s+auctionsCurrentInitialData\s*=\s*(\{[\s\S]*?\});\s*\/\*\s*\]\]>\s*\*\/\s*<\/script>/i;
const originValues = [
  "American",
  "Brazilian",
  "British",
  "Canadian",
  "Czech",
  "Dutch",
  "French",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Prewar",
  "Spanish",
  "Swedish",
];

export async function fetchLiveAuctions(config: Pick<AuctionFilters, "sourceUrl"> = filters): Promise<Auction[]> {
  const response = await fetch(config.sourceUrl, {
    headers: {
      "user-agent": "auction-alert/0.1 (+https://vercel.com)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`BaT returned ${response.status} for ${config.sourceUrl}`);
  }

  const html = await response.text();
  return parseAuctionsHtml(html);
}

export async function listFilteredAuctions(options: AuctionFilterOptions = {}): Promise<AuctionSummary[]> {
  const config = { ...filters, ...options };
  const auctions = await fetchLiveAuctions({ sourceUrl: filters.sourceUrl });
  return auctions.filter((auction) => matchesFilters(auction, config)).slice(0, config.limit).map(toAuctionSummary);
}

export async function getAuctionDetails(url: string): Promise<AuctionDetails> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "auction-alert/0.1 (+https://vercel.com)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`BaT returned ${response.status} for ${url}`);
  }

  const html = await response.text();
  return parseAuctionDetailsHtml(html, url);
}

export function parseAuctionDetailsHtml(html: string, url: string): AuctionDetails {
  const title = cleanText(textBetween(html, /<h1[^>]*>/i, /<\/h1>/i) ?? findTitle(html) ?? "Bring a Trailer auction");
  const stats = extractListingStats(html);
  const viewModel = extractBatViewModel(html);
  const comments = viewModel?.comments ?? [];
  const description = cleanText(
    postExcerpt(html) ??
      firstJsonLdDescription(html) ??
      metaContent(html, "description") ??
      "",
  );

  const commentRows = comments.filter((comment) => comment.type === "comment" && comment.text);
  const sellerComments = commentRows
    .filter((comment) => /\(the seller\)/i.test(comment.author))
    .slice(-6)
    .map(formatComment);
  const recentComments = commentRows.slice(-8).map(formatComment);
  const bidHistory = comments
    .filter((comment) => /^bat-bid/.test(comment.type) || /\bbid\b/i.test(comment.text))
    .slice(-12)
    .map(formatBidEvent);

  return {
    url,
    title,
    currentBid: stats.currentBid,
    currentBidUsd: moneyValue(stats.currentBid),
    timeRemaining: stats.timeRemaining,
    hoursRemaining: hoursRemaining(stats.endsAt),
    endsAt: stats.endsAt,
    bids: stats.bids,
    description: description.slice(0, 2400),
    essentials: extractEssentials(html).slice(0, 20),
    sellerComments,
    recentComments,
    bidHistory,
  };
}

function matchesFilters(auction: Auction, config: AuctionFilters) {
  const location = auction.location?.toLowerCase() ?? "";
  const looksUsBased =
    !auction.location ||
    location.includes("united states") ||
    /\b(a[lkzr]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkrr]|pa|ri|s[cd]|t[nx]|ut|v[ait]|w[aivy])\b/i.test(
      auction.location,
    );

  return (
    looksUsBased &&
    auction.countryCode === config.country &&
    auction.currentBidUsd != null &&
    auction.currentBidUsd <= config.maxBidUsd &&
    (auction.hoursRemaining == null || auction.hoursRemaining <= config.maxHoursRemaining) &&
    matchesYearRange(auction, config) &&
    matchesOrigin(auction, config)
  );
}

function matchesYearRange(auction: Auction, config: AuctionFilterOptions) {
  const year = auction.year ? Number.parseInt(auction.year, 10) : undefined;
  if (year == null || !Number.isFinite(year)) return config.minYear == null && config.maxYear == null;
  return (config.minYear == null || year >= config.minYear) && (config.maxYear == null || year <= config.maxYear);
}

function matchesOrigin(auction: Auction, config: AuctionFilterOptions) {
  if (!config.origins?.length) return true;
  const requested = new Set(config.origins.map(normalizeOrigin).filter(Boolean));
  return requested.size === 0 || requested.has(normalizeOrigin(auction.origin));
}

function toAuctionSummary(auction: Auction): AuctionSummary {
  return {
    title: auction.title,
    url: auction.url,
    currentBidUsd: auction.currentBidUsd,
    currentBidFormatted:
      auction.currentBidFormatted || (auction.currentBidUsd == null ? undefined : `$${auction.currentBidUsd.toLocaleString("en-US")}`),
    endsAt: auction.endsAt,
    hoursRemaining: auction.hoursRemaining,
  };
}

export function parseAuctionsHtml(html: string): Auction[] {
  const currentData = extractAuctionsCurrentInitialData(html);
  if (currentData) {
    return currentData.items.map(auctionFromBatListing);
  }

  return normalizeAuctions(extractJsonValues(html));
}

function extractAuctionsCurrentInitialData(html: string) {
  const match = auctionsInitialDataPattern.exec(html);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) return undefined;
    return { items: parsed.items.filter(isRecord) as BatListing[] };
  } catch {
    return undefined;
  }
}

function auctionFromBatListing(listing: BatListing): Auction {
  const timestampEnd = numberValue(listing.timestamp_end);
  const endsAt = timestampEnd ? new Date(timestampEnd * 1000).toISOString() : undefined;
  const url = stringValue(listing.url) ?? "";

  return {
    id: String(listing.id ?? url.split("/").filter(Boolean).at(-1) ?? url),
    title: cleanText(stringValue(listing.title) ?? "Bring a Trailer auction"),
    url,
    countryCode: stringValue(listing.country_code),
    location: cleanText(stringValue(listing.country) ?? stringValue(listing.searchable)?.match(/Located in ([^]+?)(?: [A-Z0-9]{6,}|$)/)?.[1] ?? ""),
    currentBidUsd: stringValue(listing.currency) === "USD" ? numberValue(listing.current_bid) : undefined,
    currentBidFormatted: cleanText(stringValue(listing.current_bid_formatted) ?? ""),
    endsAt,
    hoursRemaining: hoursRemaining(endsAt),
    imageUrl: stringValue(listing.thumbnail_url),
    excerpt: cleanText(stringValue(listing.excerpt) ?? "").slice(0, 500),
    noReserve: Boolean(listing.noreserve),
    premium: Boolean(listing.premium),
    year: stringValue(listing.year),
    origin: originValue(listing),
  };
}

function extractJsonValues(html: string): unknown[] {
  const values: unknown[] = [];

  const currentData = extractAuctionsCurrentInitialData(html);
  if (currentData) values.push(currentData);

  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    parseJson(match[1], values);
  }

  for (const match of html.matchAll(/<script[^>]*>\s*(?:window\.__NEXT_DATA__|self\.__next_f)\s*=\s*([\s\S]*?)<\/script>/gi)) {
    parseJson(match[1], values);
  }

  for (const match of html.matchAll(/href=["'](https:\/\/bringatrailer\.com\/listing\/[^"']+)["'][\s\S]{0,1600}?<\/a>/gi)) {
    values.push({ url: match[1], title: stripTags(match[0]) });
  }

  return values;
}

function parseJson(source: string, values: unknown[]) {
  try {
    values.push(JSON.parse(source.trim()));
  } catch {
    // Embedded app state changes frequently; URL fallback still gives the agent useful candidates.
  }
}

function normalizeAuctions(values: unknown[]): Auction[] {
  const records = flatten(values).filter(isRecord);
  const byUrl = new Map<string, Auction>();

  for (const record of records) {
    const url = asUrl(record.url) ?? asUrl(record["@id"]) ?? asUrl(record.permalink);
    if (!url || !url.includes("bringatrailer.com/listing/")) continue;

    const title = stringValue(record.name) ?? stringValue(record.title) ?? stringValue(record.headline);
    const bid = numberValue(record.currentBid) ?? moneyValue(record.price) ?? moneyValue(record.bid) ?? moneyValue(record.title);
    const endsAt = stringValue(record.endDate) ?? stringValue(record.endsAt) ?? stringValue(record.auctionEnd);
    const existing = byUrl.get(url);
    const auction: Auction = {
      id: url.split("/").filter(Boolean).at(-1) ?? url,
      title: cleanText(title ?? existing?.title ?? "Bring a Trailer auction"),
      url,
      countryCode: stringValue(record.country_code) ?? stringValue(record.countryCode) ?? existing?.countryCode,
      location: cleanText(locationValue(record) ?? existing?.location ?? ""),
      currentBidUsd: bid ?? existing?.currentBidUsd,
      currentBidFormatted: stringValue(record.current_bid_formatted) ?? existing?.currentBidFormatted,
      endsAt: endsAt ?? existing?.endsAt,
      hoursRemaining: hoursRemaining(endsAt) ?? existing?.hoursRemaining,
      imageUrl: stringValue(record.thumbnail_url) ?? imageValue(record) ?? existing?.imageUrl,
      excerpt: cleanText(stringValue(record.description) ?? existing?.excerpt ?? "").slice(0, 500),
      noReserve: Boolean(record.noreserve ?? existing?.noReserve),
      premium: Boolean(record.premium ?? existing?.premium),
      year: stringValue(record.year) ?? existing?.year,
      origin: originValue(record) ?? existing?.origin,
    };
    byUrl.set(url, auction);
  }

  return [...byUrl.values()];
}

function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!isRecord(value)) return [value];
  return [value, ...Object.values(value).flatMap(flatten)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : moneyValue(value);
}

function moneyValue(value: unknown) {
  const text = stringValue(value);
  const match = text?.match(moneyPattern);
  return match ? Number(match[1].replaceAll(",", "")) : undefined;
}

function asUrl(value: unknown) {
  const text = stringValue(value);
  return text?.startsWith("https://") ? text : undefined;
}

function locationValue(record: Record<string, unknown>) {
  const location = record.location;
  if (typeof location === "string") return location;
  if (isRecord(location)) {
    return [location.addressLocality, location.addressRegion, location.addressCountry]
      .map(stringValue)
      .filter(Boolean)
      .join(", ");
  }
  return undefined;
}

function imageValue(record: Record<string, unknown>) {
  const image = record.image;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return image.map(stringValue).find(Boolean);
  if (isRecord(image)) return stringValue(image.url);
  return undefined;
}

function originValue(record: Record<string, unknown>) {
  const direct = stringValue(record.origin);
  if (direct) return direct;

  const searchable = stringValue(record.searchable);
  if (!searchable) return undefined;

  return originValues.find((origin) => new RegExp(`^${escapeRegex(origin)}\\b`, "i").test(searchable));
}

function normalizeOrigin(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "";
  return originValues.find((origin) => origin.toLowerCase() === normalized)?.toLowerCase() ?? normalized;
}

function hoursRemaining(endsAt?: string) {
  if (!endsAt) return undefined;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return undefined;
  return Math.max(0, Math.round((end - Date.now()) / 36_000) / 100);
}

function firstJsonLdDescription(html: string) {
  for (const value of extractJsonValues(html)) {
    const record = flatten(value).find(isRecord);
    const description = record && stringValue(record.description);
    if (description) return description;
  }
  return undefined;
}

function findTitle(html: string) {
  return textBetween(html, /<title[^>]*>/i, /<\/title>/i);
}

function extractListingStats(html: string) {
  const currentBid =
    cleanText(
      textBetween(html, /<span[^>]+data-listing-currently=["'][^"']+["'][^>]*>[\s\S]*?<strong[^>]*>/i, /<\/strong>/i),
    ) || undefined;
  const statsTable = html.match(/<table[^>]+id=["']listing-bid["'][^>]*>([\s\S]*?)<\/table>/i)?.[1] ?? "";

  return {
    currentBid: currentBid ?? tableValue(statsTable, "Current Bid"),
    timeRemaining:
      cleanText(textBetween(statsTable, /<span[^>]+class=["'][^"']*listing-end-time[^"']*["'][^>]*>/i, /<\/span>/i)) ||
      tableValue(statsTable, "Time Left"),
    endsAt: timestampToIso(html.match(/<span[^>]+class=["'][^"']*listing-end-time[^"']*["'][^>]+data-timestamp=["'](\d+)["']/i)?.[1]),
    bids: tableValue(statsTable, "Bids"),
  };
}

function tableValue(tableHtml: string, label: string) {
  const pattern = new RegExp(
    `<tr[^>]*>[\\s\\S]*?<t[hd][^>]*>\\s*${escapeRegex(label)}\\s*<\\/t[hd]>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
    "i",
  );
  return cleanText(pattern.exec(tableHtml)?.[1]) || undefined;
}

function timestampToIso(value?: string) {
  if (!value) return undefined;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : undefined;
}

function postExcerpt(html: string) {
  const start = /<div[^>]+class=["'][^"']*post-excerpt[^"']*["'][^>]*>/i.exec(html);
  if (!start) return undefined;
  const rest = html.slice(start.index + start[0].length);
  const end = /<div[^>]+id=["']listing-bid-container["']/i.exec(rest);
  return stripTags(end ? rest.slice(0, end.index) : rest);
}

function extractEssentials(html: string) {
  const essentialsHtml = html.match(/<div[^>]+class=["'][^"']*essentials[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]+class=["'][^"']*listing-actions-stats|<div[^>]+data-pusher=["']post;stats;|<\/aside>)/i)?.[1];
  if (!essentialsHtml) return [];

  const items = [...essentialsHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => cleanText(stripTags(match[1])))
    .filter((item) => item.length > 2);

  if (items.length) return items;
  return stripTags(essentialsHtml)
    .split(/\n+/)
    .map(cleanText)
    .filter((item) => item.length > 2);
}

function extractBatViewModel(html: string) {
  const json = extractJsonAssignment(html, "BAT_VMS");
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.comments)) return undefined;
    return {
      comments: parsed.comments.filter(isRecord).map((comment) => ({
        author: cleanText(stringValue(comment.authorName) ?? ""),
        text: cleanText(stripTags(stringValue(comment.content) ?? stringValue(comment.markup) ?? "")),
        type: cleanText(stringValue(comment.type) ?? ""),
        bidAmount: stringValue(comment.bidAmount) ?? numberValue(comment.bidAmount)?.toLocaleString("en-US"),
        timestamp: timestampToIso(String(numberValue(comment.timestamp) ?? "")),
      })),
    };
  } catch {
    return undefined;
  }
}

function extractJsonAssignment(html: string, variableName: string) {
  const assignment = new RegExp(`var\\s+${escapeRegex(variableName)}\\s*=\\s*`, "i").exec(html);
  if (!assignment) return undefined;

  const start = html.indexOf("{", assignment.index + assignment[0].length);
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }

  return undefined;
}

function formatComment(comment: { author: string; text: string; timestamp?: string }) {
  const date = comment.timestamp ? ` (${new Date(comment.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : "";
  return `${comment.author || "Comment"}${date}: ${comment.text}`.slice(0, 700);
}

function formatBidEvent(comment: { author: string; text: string; bidAmount?: string; timestamp?: string }) {
  const date = comment.timestamp ? ` (${new Date(comment.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : "";
  const text = comment.text || comment.author;
  const amount = comment.bidAmount && !text.includes(`$${comment.bidAmount}`) ? `$${comment.bidAmount.replace(/^\$/, "")}` : "";
  return cleanText([amount, text].filter(Boolean).join(" ")).slice(0, 220) + date;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"));
  return match?.[1];
}

function textBetween(html: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(html);
  if (!startMatch) return undefined;
  const rest = html.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  return endMatch ? stripTags(rest.slice(0, endMatch.index)) : undefined;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "\n");
}

function cleanText(value?: string) {
  return (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&hellip;|&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type BatListing = Record<string, unknown> & {
  id?: number | string;
  title?: string;
  url?: string;
  country?: string;
  country_code?: string;
  currency?: string;
  current_bid?: number | string;
  current_bid_formatted?: string;
  timestamp_end?: number | string;
  thumbnail_url?: string;
  excerpt?: string;
  searchable?: string;
  noreserve?: boolean;
  premium?: boolean;
  year?: string;
};
