import { runAndSendAlertsThroughChatSdk } from "../server/lib/chat-bot";

const result = await runAndSendAlertsThroughChatSdk();

console.log(
  JSON.stringify(result, null, 2),
);
