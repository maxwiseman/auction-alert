import { defineEventHandler, toWebRequest } from "h3";
import { initializeChat } from "../../../../lib/chat";

export default defineEventHandler(async (event) => {
  const bot = await initializeChat();
  return bot.webhooks.sendblue(toWebRequest(event));
});
