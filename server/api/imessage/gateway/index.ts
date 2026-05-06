import { defineHandler } from "nitro";
import { getHeader } from "h3";
import { getChatBot } from "../../../lib/chat-bot";
import { readChatConfig } from "../../../lib/chat-config";

export default defineHandler(async (event) => {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = getHeader(event, "authorization");

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const config = await readChatConfig();

  if (!config.imessageGateway.enabled) {
    return { status: "disabled" };
  }

  const bot = await getChatBot();
  const imessage = bot.getAdapter("imessage");

  return imessage.startGatewayListener(
    {
      waitUntil: (task: Promise<unknown>) => event.waitUntil(task),
    },
    config.imessageGateway.listenerDurationMs,
  );
});
