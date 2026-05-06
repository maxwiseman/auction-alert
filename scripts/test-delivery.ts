import { sendTestDeliveryMessage } from "../server/lib/chat-bot";

const message =
  process.argv[2] ??
  `Auction alert delivery test at ${new Date().toISOString()}`;
const link = process.argv[3];

const result = await sendTestDeliveryMessage({
  message,
  links: link ? [link] : [],
});

console.log(JSON.stringify(result, null, 2));
