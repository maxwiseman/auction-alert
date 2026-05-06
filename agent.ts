import { ToolLoopAgent, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { getAuctionDetails, listFilteredAuctions } from "./lib/auction";
import { openai } from "@ai-sdk/openai";
import { getConversationCriteria, readDefaultCriteria, updateConversationCriteria } from "./lib/conversation-settings";

export type AgentRuntime = {
  conversationId?: string;
  threadId?: string;
  chat?: {
    send?: (adapter: string, threadId: string, message: string) => Promise<unknown>;
    getAdapter?: (name: string) => unknown;
  };
  canSendTyping?: boolean;
};

const model = openai(process.env.AUCTION_ALERT_MODEL ?? "gpt-5.5");

export function createAuctionAgent(runtime: AgentRuntime = {}) {
  return new ToolLoopAgent({
    model,
    instructions: [
      "You are Auction Alert, a concise Bring a Trailer iMessage assistant.",
      "Use the available tools to inspect live auctions and details before making recommendations.",
      "For daily briefs, choose only the cars worth alerting on. It is okay to say there are no good picks today.",
      "For chat replies, use the loaded conversation context. In group chats, pay attention to the sender label on each message.",
      "In group chats, do not respond unless the latest message is clearly directed at Auction Alert, asks about auctions/cars, or asks to change alert criteria. Use doNotRespond when people are just talking to each other.",
      "Criteria are stored per conversation. Use readUserCriteria before making recommendations.",
      "When a user asks to change what kinds of cars to prefer or avoid, call updateUserCriteria with the full revised criteria.",
      "When a user asks for different objective auction filters, pass those options to listFilteredAuctions instead of updating criteria.",
      "Never use markdown formatting. iMessage is plain text.",
      "Keep iMessage replies short and concise. Default to 1-3 short sentences unless the user asks for detail.",
      "Write informally, like a helpful car friend texting. Abbreviations are fine. Perfect grammar is not required.",
      "Be opinionated and useful. Prefer concrete reasons over generic enthusiasm.",
      "When you recommend auctions, include the URL only if the caller asks for inline links. The daily sender will send URLs separately.",
      "Use tapbacks and typing indicators when they make the native iMessage experience better.",
    ].join("\n"),
    stopWhen: stepCountIs(8),
    tools: {
      listFilteredAuctions: tool({
        description:
          "Fetch live Bring a Trailer auctions and return an objective-filtered shortlist. Override filters for user requests like under $40k, Canada, or ending within 6 hours. The source URL is fixed by app config.",
        inputSchema: z.object({
          country: z.string().length(2).optional().describe("ISO 3166-1 alpha-2 country code, e.g. US or CA. Defaults to app config."),
          maxBidUsd: z.number().int().positive().optional().describe("Maximum current bid in USD. Defaults to app config."),
          maxHoursRemaining: z.number().positive().optional().describe("Maximum hours remaining. Defaults to app config."),
          limit: z.number().int().positive().max(100).optional().describe("Maximum number of auctions to return. Defaults to app config."),
        }),
        execute: async (options) => listFilteredAuctions(options),
      }),
      getAuctionDetails: tool({
        description: "Fetch a specific BaT auction page and extract listing details, comments, seller snippets, and bid history clues.",
        inputSchema: z.object({
          url: z.string().url().describe("Bring a Trailer auction listing URL"),
        }),
        execute: async ({ url }) => getAuctionDetails(url),
      }),
      readUserCriteria: tool({
        description: "Read this conversation's subjective car criteria from Upstash, falling back to the default markdown criteria.",
        inputSchema: z.object({}),
        execute: async () => readUserCriteria(runtime.conversationId),
      }),
      updateUserCriteria: tool({
        description:
          "Persist revised subjective car criteria for this SendBlue conversation. Use when the user asks to prefer, avoid, remember, or change taste criteria.",
        inputSchema: z.object({
          criteria: z
            .string()
            .min(20)
            .describe("The complete revised criteria text to save for this conversation. Include previous criteria that should remain."),
        }),
        execute: async ({ criteria }) => {
          const settings = await updateConversationCriteria(runtime.conversationId, criteria);
          return {
            ok: true,
            criteria: settings.criteria,
            criteriaUpdatedAt: settings.criteriaUpdatedAt,
          };
        },
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
      doNotRespond: tool({
        description: "Use in group chats when the latest message is not directed at the AI and does not need an Auction Alert response.",
        inputSchema: z.object({
          reason: z.string().describe("Brief reason for staying silent. This is logged only and is not sent to the chat."),
        }),
        execute: async ({ reason }) => ({ ok: true, respond: false, reason }),
      }),
    },
  });
}

export const auctionAgent = createAuctionAgent();

export async function generateDailyBrief(recipientLabel: string, runtime: AgentRuntime = {}) {
  const agent = createAuctionAgent(runtime);
  const result = await agent.generate({
    prompt: [
      `Generate today's BaT auction alert for ${recipientLabel}.`,
      "Call readUserCriteria and listFilteredAuctions. Use getAuctionDetails for the most promising candidates.",
      "Use the default objective filters unless the conversation criteria clearly imply a stricter objective preference.",
      "Return one concise plain-text summary. Do not include markdown. Do not include auction URLs in the summary.",
    ].join("\n"),
  });

  const urls = extractBatUrlsFromSteps(result.steps);
  return { text: result.text.trim(), urls };
}

export async function respondToConversation(messages: ModelMessage[], runtime: AgentRuntime) {
  const agent = createAuctionAgent(runtime);
  const result = await agent.generate({ messages });
  const silence = JSON.stringify(result.steps).includes('"respond":false');
  return silence ? "" : result.text.trim();
}

export async function readUserCriteria(conversationId?: string) {
  return conversationId ? getConversationCriteria(conversationId) : readDefaultCriteria();
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
