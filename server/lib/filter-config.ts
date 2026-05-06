import { readFile } from "node:fs/promises";
import { z } from "zod";

const FILTER_CONFIG_PATH = new URL("../../auction-filter.json", import.meta.url);

export const filterConfigSchema = z.object({
  sourceUrl: z
    .string()
    .url()
    .default("https://bringatrailer.com/auctions/?location=US&ending=24&bidTo=25000"),
  maxCurrentBid: z.number().nonnegative().nullable().default(25_000),
  minCurrentBid: z.number().nonnegative().nullable().default(null),
  countries: z.array(z.string()).default(["United States"]),
  endingWithinHours: z.number().positive().nullable().default(24),
  currencies: z.array(z.string()).default(["USD"]),
  includeNoBidAuctions: z.boolean().default(true),
  includeCategories: z.array(z.string()).default([]),
  excludeCategories: z.array(z.string()).default([]),
  includePremium: z.boolean().default(true),
  includeRepeatListings: z.boolean().default(true),
  maxCandidatesForGpt: z.number().int().positive().default(200),
  historyMessagesForContext: z.number().int().nonnegative().default(8),
  auctionSnapshotTtlDays: z.number().int().positive().default(30),
  chatHistoryTtlDays: z.number().int().positive().default(60),
});

export type AuctionFilterConfig = z.infer<typeof filterConfigSchema>;

export async function readFilterConfig() {
  const raw = await readFile(FILTER_CONFIG_PATH, "utf8");
  return filterConfigSchema.parse(JSON.parse(raw));
}
