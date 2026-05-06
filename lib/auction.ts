import filters from "../config/filters.json" with { type: "json" };

export type Auction = {
  id: string;
  title: string;
  url: string;
  location?: string;
  currentBidUsd?: number;
  endsAt?: string;
  hoursRemaining?: number;
  imageUrl?: string;
  excerpt?: string;
};

export type AuctionFilters = typeof filters;

const moneyPattern = /\$([\d,]+)/;

export async function fetchLiveAuctions(config: AuctionFilters = filters): Promise<Auction[]> {
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
  return normalizeAuctions(extractJsonValues(html));
}

export async function listFilteredAuctions(config: AuctionFilters = filters): Promise<Auction[]> {
  const auctions = await fetchLiveAuctions(config);
  return auctions.filter((auction) => matchesFilters(auction, config)).slice(0, config.limit);
}

export async function getAuctionDetails(url: string) {
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
  const title = textBetween(html, /<h1[^>]*>/i, /<\/h1>/i) ?? findTitle(html);
  const description =
    firstJsonLdDescription(html) ??
    metaContent(html, "description") ??
    "";

  return {
    url,
    title: cleanText(title),
    description: cleanText(description).slice(0, 2000),
    sellerComments: snippets(html, /seller/i, 6),
    bidHistory: snippets(html, /bid|high bid|reserve/i, 10),
    comments: snippets(html, /comment/i, 10),
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
    (auction.currentBidUsd == null || auction.currentBidUsd <= config.maxBidUsd) &&
    (auction.hoursRemaining == null || auction.hoursRemaining <= config.maxHoursRemaining)
  );
}

function extractJsonValues(html: string): unknown[] {
  const values: unknown[] = [];

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
      location: cleanText(locationValue(record) ?? existing?.location ?? ""),
      currentBidUsd: bid ?? existing?.currentBidUsd,
      endsAt: endsAt ?? existing?.endsAt,
      hoursRemaining: hoursRemaining(endsAt) ?? existing?.hoursRemaining,
      imageUrl: imageValue(record) ?? existing?.imageUrl,
      excerpt: cleanText(stringValue(record.description) ?? existing?.excerpt ?? "").slice(0, 500),
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

function metaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"));
  return match?.[1];
}

function snippets(html: string, pattern: RegExp, limit: number) {
  return stripTags(html)
    .split(/\n+/)
    .map(cleanText)
    .filter((line) => line.length > 30 && pattern.test(line))
    .slice(0, limit);
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
    .replace(/\s+/g, " ")
    .trim();
}
