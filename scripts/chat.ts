import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ModelMessage } from "ai";
import { respondToConversation } from "../agent";

const args = process.argv.slice(2);
const conversationId = valueAfter("--conversation") ?? "cli";
const prompt = positionalPrompt();

if (prompt) {
  const response = await send([{ role: "user", content: `CLI: ${prompt}` }]);
  console.log(response || "(no response)");
  process.exit(0);
}

const rl = createInterface({ input, output });
const messages: ModelMessage[] = [
  {
    role: "system",
    content: [
      "This is a local CLI test conversation, not a SendBlue thread.",
      "The sender label is CLI. Respond normally unless the user asks you to stay silent.",
    ].join(" "),
  },
];

console.log("Auction Alert CLI");
console.log(`conversation: ${conversationId}`);
console.log(`model: ${process.env.AUCTION_ALERT_MODEL ?? "gpt-5.5"}`);
console.log("Type /exit to quit.\n");

while (true) {
  const text = (await rl.question("> ")).trim();
  if (!text || text === "/exit" || text === "/quit") break;

  messages.push({ role: "user", content: `CLI: ${text}` });

  try {
    const response = await send(messages);
    console.log(response || "(no response)");
    console.log();

    if (response) messages.push({ role: "assistant", content: response });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error();
  }
}

rl.close();

async function send(messages: ModelMessage[]) {
  return respondToConversation(messages, { conversationId });
}

function positionalPrompt() {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--conversation") {
      index += 1;
      continue;
    }
    values.push(arg);
  }
  return values.join(" ").trim();
}

function valueAfter(flag: string) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
