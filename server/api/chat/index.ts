import { defineHandler } from "nitro";
import { convertToModelMessages, streamText } from "ai";
import type { UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { runBatAlert } from "../../lib/bat-alert";
import { readFilterConfig } from "../../lib/filter-config";
import { createAuctionStore } from "../../lib/upstash-store";

export default defineHandler(async (event) => {
  const body = await readRequestBody(event);
  const messages = Array.isArray(body?.messages) ? (body.messages as UIMessage[]) : [];
  const contextId =
    typeof body?.contextId === "string"
      ? body.contextId
      : typeof body?.threadId === "string"
        ? body.threadId
        : "default";
  const config = await readFilterConfig();
  const store = createAuctionStore();
  await store.appendChatMessages(
    messages.slice(-config.historyMessagesForContext),
    config,
    contextId,
  );
  const alert = await runBatAlert({ contextId });

  const result = streamText({
    model: openai("gpt-5.5"),
    system:
      "You are an auction alert assistant. Answer using the latest Bring a Trailer alert results supplied by the server.",
    messages: [
      {
        role: "user",
        content: [
          "Latest daily Bring a Trailer alert result:",
          JSON.stringify(alert),
        ].join("\n"),
      },
      ...(await convertToModelMessages(messages)),
    ],
  });

  return result.toUIMessageStreamResponse();
});

async function readRequestBody(event: unknown) {
  const request = event as { node?: { req?: AsyncIterable<Uint8Array> } };
  const req = request.node?.req;
  if (!req) return undefined;

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk);

  if (chunks.length === 0) return undefined;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
