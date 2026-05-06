import { readFile } from "node:fs/promises";
import {
  extractAuctionsFromHtml,
  filterTargetAuctions,
} from "../server/lib/bat-alert";
import { readFilterConfig } from "../server/lib/filter-config";

const htmlPath = process.argv[2];

if (!htmlPath) {
  throw new Error("Usage: bun run scripts/test-extraction.ts <path-to-html>");
}

const html = await readFile(htmlPath, "utf8");
const config = await readFilterConfig();
const auctions = extractAuctionsFromHtml(html);
const targetAuctions = filterTargetAuctions(auctions, config);

console.log(
  JSON.stringify(
    {
      auctionCount: auctions.length,
      targetAuctionCount: targetAuctions.length,
      filter: config,
      sample: targetAuctions.slice(0, 10).map((auction) => ({
        title: auction.title,
        currentBid: auction.currentBid,
        currentBidAmount: auction.currentBidAmount,
        location: auction.location,
        timeLeft: auction.timeLeft,
        timestampEnd: auction.timestampEnd,
        url: auction.url,
      })),
    },
    null,
    2,
  ),
);
