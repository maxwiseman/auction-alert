import { readFile } from "fs/promises";
import { join } from "path";
import { ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { getAuctionDetails, listFilteredAuctions } from "./lib/auction";

export type AgentRuntime = {
  threadId?: string;
  chat?: {
    send?: (adapter: string, threadId: string, message: string) => Promise<unknown>;
    getAdapter?: (name: string) => unknown;
  };
  canSendTyping?: boolean;
};

const model = process.env.AUCTION_ALERT_MODEL ?? "openai/gpt-5.5";

export function createAuctionAgent(runtime: AgentRuntime = {}) {
  return new ToolLoopAgent({
    model,
    instructions: [
      "You are Auction Alert, a concise Bring a Trailer iMessage assistant.",
      "Use the available tools to inspect live auctions and details before making recommendations.",
      "For daily briefs, choose only the cars worth alerting on. It is okay to say there are no good picks today.",
      "For chat replies, use the loaded conversation context. In group chats, pay attention to the sender label on each message.",
      "Never use markdown formatting. iMessage is plain text.",
      "Keep messages short, opinionated, and useful. Prefer concrete reasons over generic enthusiasm.",
      "When you recommend auctions, include the URL only if the caller asks for inline links. The daily sender will send URLs separately.",
      "Use tapbacks and typing indicators when they make the native iMessage experience better.",
    ].join("\n"),
    stopWhen: stepCountIs(8),
    tools: {
      listFilteredAuctions: tool({
        description: "Fetch live Bring a Trailer auctions and return the configurable objective-filtered shortlist.",
        inputSchema: z.object({}),
        execute: async () => listFilteredAuctions(),
      }),
      getAuctionDetails: tool({
        description: "Fetch a specific BaT auction page and extract listing details, comments, seller snippets, and bid history clues.",
        inputSchema: z.object({
          url: z.string().url().describe("Bring a Trailer auction listing URL"),
        }),
        execute: async ({ url }) => getAuctionDetails(url),
      }),
      readUserCriteria: tool({
        description: "Read the editable markdown file that describes the user's subjective car taste.",
        inputSchema: z.object({}),
        execute: async () => readUserCriteria(),
      }),
      tapback: tool({
        description: "Add an iMessage tapback reaction to the current conversation when a quick acknowledgement is better than text.",
        inputSchema: z.object({
          messageId: z.string().optional().describe("Message ID to react to. Omit to react to the current inbound message when supported."),
          reaction: z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]),
        }),
        execute: async ({ messageId, reaction }) => {
          if (!runtime.chat || !runtime.threadId) return { ok: false, reason: "No active SendBlue thread." };
          const adapter = runtime.chat.getAdapter?.("sendblue") as SendblueLike | undefined;
          if (!adapter?.addReaction) return { ok: false, reason: "SendBlue adapter does not expose addReaction." };
          await adapter.addReaction(runtime.threadId, messageId ?? runtime.threadId, reaction);
          return { ok: true };
        },
      }),
      startTyping: tool({
        description: "Send the native iMessage typing bubble. SendBlue only supports this in 1:1 conversations.",
        inputSchema: z.object({}),
        execute: async () => {
          if (!runtime.chat || !runtime.threadId || runtime.canSendTyping === false) {
            return { ok: false, reason: "Typing indicators are only available for active 1:1 SendBlue chats." };
          }
          const adapter = runtime.chat.getAdapter?.("sendblue") as SendblueLike | undefined;
          if (adapter?.startTyping) {
            await adapter.startTyping(runtime.threadId);
            return { ok: true };
          }
          return { ok: false, reason: "SendBlue adapter does not expose startTyping." };
        },
      }),
      sendRichLink: tool({
        description: "Send a URL as its own iMessage so Apple clients can render a rich link preview.",
        inputSchema: z.object({
          url: z.string().url(),
        }),
        execute: async ({ url }) => {
          if (!runtime.chat || !runtime.threadId) return { ok: false, reason: "No active SendBlue thread." };
          await runtime.chat.send?.("sendblue", runtime.threadId, url);
          return { ok: true };
        },
      }),
    },
  });
}

export const auctionAgent = createAuctionAgent();

export async function generateDailyBrief(recipientLabel: string) {
  const agent = createAuctionAgent();
  const result = await agent.generate({
    prompt: [
      `Generate today's BaT auction alert for ${recipientLabel}.`,
      "Call readUserCriteria and listFilteredAuctions. Use getAuctionDetails for the most promising candidates.",
      "Return one concise plain-text summary. Do not include markdown. Do not include auction URLs in the summary.",
    ].join("\n"),
  });

  const urls = extractBatUrlsFromSteps(result.steps);
  return { text: result.text.trim(), urls };
}

export async function respondToConversation(messages: ModelMessage[], runtime: AgentRuntime) {
  const agent = createAuctionAgent(runtime);
  const result = await agent.generate({ messages });
  return result.text.trim();
}

export async function readUserCriteria() {
  return readFile(join(process.cwd(), "config", "criteria.md"), "utf8");
}

function extractBatUrlsFromSteps(steps: unknown[]) {
  const seen = new Set<string>();
  const urls: string[] = [];
  JSON.stringify(steps).replace(/https:\/\/bringatrailer\.com\/listing\/[a-z0-9-_/]+/gi, (url) => {
    const clean = url.replace(/[),.]+$/, "");
    if (!seen.has(clean)) {
      seen.add(clean);
      urls.push(clean);
    }
    return url;
  });
  return urls.slice(0, 5);
}

type SendblueLike = {
  addReaction?: (threadId: string, messageId: string, reaction: string) => Promise<unknown>;
  startTyping?: (threadId: string) => Promise<unknown>;
};
