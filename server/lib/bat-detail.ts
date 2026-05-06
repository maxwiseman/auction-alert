const MAX_TEXT_LENGTH = 700;

export type AuctionDetail = {
  url: string;
  title: string | null;
  description: string | null;
  currentBid: string | null;
  currentBidAmount: number | null;
  currency: string | null;
  image: string | null;
  seller: string | null;
  location: string | null;
  essentials: string[];
  commentCount: number;
  comments: DetailComment[];
  sellerComments: DetailComment[];
  bidHistory: DetailBid[];
};

type DetailComment = {
  author: string | null;
  content: string;
  timestamp: string | null;
  likes: number | null;
};

type DetailBid = {
  amount: number | null;
  content: string;
  timestamp: string | null;
};

export async function getAuctionDetails(url: string): Promise<AuctionDetail> {
  const parsedUrl = new URL(url);
  if (!parsedUrl.hostname.endsWith("bringatrailer.com")) {
    throw new Error("Only bringatrailer.com listing URLs are supported.");
  }

  const html = await fetchAuctionDetailHtml(parsedUrl.toString());
  return extractAuctionDetailsFromHtml(html, parsedUrl.toString());
}

export async function fetchAuctionDetailHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; auction-alert/1.0; +https://vercel.com)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Bring a Trailer listing returned ${response.status}`);
  }

  return response.text();
}

export function extractAuctionDetailsFromHtml(html: string, url: string): AuctionDetail {
  const jsonValues = extractJsonValues(html);
  const product = findProductJsonLd(jsonValues);
  const commentsJson = findCommentsJson(jsonValues);
  const comments = Array.isArray(commentsJson?.comments)
    ? commentsJson.comments.filter(isRecord)
    : [];
  const productOffer = isRecord(product?.offers) ? product.offers : undefined;
  const essentials = extractEssentials(html);
  const commentDetails = comments
    .filter((comment) => comment.type !== "bat-bid" && readNumber(comment, "bidAmount") <= 0)
    .map(toDetailComment)
    .filter((comment) => comment.content)
    .slice(-16);
  const sellerComments = commentDetails
    .filter((comment) => comment.author?.toLowerCase().includes("seller"))
    .slice(-8);
  const bidHistory = comments
    .filter((comment) => comment.type === "bat-bid" || readNumber(comment, "bidAmount") > 0)
    .map(toDetailBid)
    .filter((bid) => bid.content || bid.amount !== null)
    .slice(-16);

  return {
    url,
    title: readString(product, "name") ?? extractMeta(html, "og:title"),
    description: truncate(readString(product, "description") ?? extractMeta(html, "description")),
    currentBid: formatMoney(readNumber(productOffer, "price"), readString(productOffer, "priceCurrency")),
    currentBidAmount: readNullableNumber(productOffer, "price"),
    currency: readString(productOffer, "priceCurrency"),
    image: readString(product, "image") ?? extractMeta(html, "og:image"),
    seller: extractEssentialValue(html, "Seller") ?? extractMeta(html, "parsely-author"),
    location: extractEssentialValue(html, "Location"),
    essentials,
    commentCount: commentDetails.length,
    comments: commentDetails,
    sellerComments,
    bidHistory,
  };
}

function extractJsonValues(html: string) {
  const values: unknown[] = [];
  const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html))) {
    const script = match[1].trim();
    if (!script) continue;

    const direct = parseJson(script);
    if (direct) values.push(direct);

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

function findProductJsonLd(values: unknown[]) {
  return collectRecords(values).find(
    (record) => readString(record, "@type") === "Product" && readString(record, "name"),
  );
}

function findCommentsJson(values: unknown[]) {
  return collectRecords(values).find((record) => Array.isArray(record.comments));
}

function collectRecords(values: unknown[]) {
  const records: Record<string, unknown>[] = [];

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (!isRecord(value)) return;
    records.push(value);
    for (const child of Object.values(value)) visit(child);
  }

  for (const value of values) visit(value);
  return records;
}

function extractEssentials(html: string) {
  const essentialsMatch = html.match(/<div class="essentials">([\s\S]*?)<div data-pusher=/i);
  if (!essentialsMatch) return [];

  const essentialsHtml = essentialsMatch[1];
  const lines = [
    extractEssentialValue(html, "Seller") ? `Seller: ${extractEssentialValue(html, "Seller")}` : null,
    extractEssentialValue(html, "Location") ? `Location: ${extractEssentialValue(html, "Location")}` : null,
  ].filter((line): line is string => Boolean(line));

  for (const item of essentialsHtml.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const text = stripTags(item[1]);
    if (text) lines.push(text);
  }

  for (const item of essentialsHtml.matchAll(/<div class="item additional"><strong>([\s\S]*?)<\/strong>:\s*([\s\S]*?)<\/div>/gi)) {
    const label = stripTags(item[1]);
    const value = stripTags(item[2]);
    if (label && value) lines.push(`${label}: ${value}`);
  }

  const lot = essentialsHtml.match(/<div class="item"><strong>Lot<\/strong>\s*([\s\S]*?)<\/div>/i);
  if (lot) lines.push(`Lot ${stripTags(lot[1])}`);

  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .slice(0, 30);
}

function extractEssentialValue(html: string, label: string) {
  const pattern = new RegExp(`<strong>${escapeRegex(label)}</strong>:\\s*([\\s\\S]*?)(?:<div|</div|<strong>)`, "i");
  const match = html.match(pattern);
  if (!match) return null;
  return stripTags(match[1]);
}

function extractMeta(html: string, name: string) {
  const escaped = escapeRegex(name);
  const match =
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"));

  return match ? decodeHtmlEntities(match[1]) : null;
}

function toDetailComment(comment: Record<string, unknown>): DetailComment {
  return {
    author: readString(comment, "authorName"),
    content: truncate(stripTags(readString(comment, "content") ?? readString(comment, "markup") ?? "")) ?? "",
    timestamp: formatTimestamp(readNumber(comment, "timestamp")),
    likes: readNullableNumber(comment, "likes"),
  };
}

function toDetailBid(comment: Record<string, unknown>): DetailBid {
  return {
    amount: readNullableNumber(comment, "bidAmount"),
    content: truncate(stripTags(readString(comment, "content") ?? readString(comment, "markup") ?? "")) ?? "",
    timestamp: formatTimestamp(readNumber(comment, "timestamp")),
  };
}

function readString(item: Record<string, unknown> | undefined, key: string) {
  const value = item?.[key];
  if (typeof value === "string" && value.trim()) return decodeHtmlEntities(value.trim());
  if (typeof value === "number") return String(value);
  return null;
}

function readNumber(item: Record<string, unknown> | undefined, key: string) {
  const value = item?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const number = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(number)) return number;
  }

  return 0;
}

function readNullableNumber(item: Record<string, unknown> | undefined, key: string) {
  const number = readNumber(item, key);
  return number === 0 ? null : number;
}

function formatMoney(amount: number, currency: string | null) {
  if (!amount) return null;
  return `${currency ?? "USD"} $${amount.toLocaleString("en-US")}`;
}

function formatTimestamp(timestamp: number) {
  if (!timestamp) return null;
  return new Date(timestamp * 1000).toISOString();
}

function stripTags(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string | null) {
  if (!value) return null;
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 1)}...` : value;
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
    .replace(/&apos;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, "...");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
