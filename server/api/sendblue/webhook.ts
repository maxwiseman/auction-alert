import { defineHandler } from "nitro";
import { initializeChat } from "../../../lib/chat";

export default defineHandler(async (event) => {
  if (event.req.method === "GET") {
    return { ok: true, route: "/api/sendblue/webhook" };
  }

  const bot = await initializeChat();
  return bot.webhooks.sendblue(event.req);
});
