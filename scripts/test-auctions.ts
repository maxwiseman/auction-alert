import { readFile } from "node:fs/promises";
import { listFilteredAuctions, parseAuctionsHtml } from "../lib/auction";

const htmlPath = valueAfter("--html");
const limit = Number(valueAfter("--limit") ?? 20);

const auctions = htmlPath
  ? parseAuctionsHtml(await readFile(htmlPath, "utf8"))
  : await listFilteredAuctions();

console.log(`Found ${auctions.length} auction${auctions.length === 1 ? "" : "s"}`);

for (const auction of auctions.slice(0, limit)) {
  console.log(
    [
      auction.currentBidFormatted ?? (auction.currentBidUsd == null ? "No bid" : `$${auction.currentBidUsd}`),
      auction.hoursRemaining == null ? "unknown time" : `${auction.hoursRemaining}h left`,
      auction.title,
      auction.url,
    ].join(" | "),
  );
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
