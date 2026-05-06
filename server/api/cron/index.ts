import { defineHandler } from "nitro";
import { runAndSendAlertsThroughChatSdk } from "../../lib/chat-bot";

export default defineHandler(async () => {
  return runAndSendAlertsThroughChatSdk();
});
