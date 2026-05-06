import { Chat, type Message, type Thread } from "chat";
import { createSendblueAdapter, type SendblueMessagePayload } from "chat-adapter-sendblue";
import { respondToConversation } from "../agent";
import { createMemoryState } from "./memory-state";

export const chat = new Chat({
  userName: "auction-alert",
  adapters: {
    sendblue: createSendblueAdapter({
      allowedServices: ["iMessage", "SMS", "RCS"],
    }),
  },
  state: createMemoryState(),
  concurrency: "queue",
});

let handlersRegistered = false;

export async function initializeChat() {
  if (!handlersRegistered) {
    registerHandlers();
    handlersRegistered = true;
  }

  await chat.initialize();
  return chat;
}

function registerHandlers() {
  chat.onDirectMessage(async (thread, message) => {
    await answerThread(thread, message);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    await answerThread(thread, message);
  });
}

async function answerThread(thread: Thread, message: Message) {
  await thread.subscribe?.();
  if (!isGroupThread(thread.id)) {
    await thread.startTyping?.();
  }

  const history = await loadSendBlueHistory(thread.id);
  const messages = [
    {
      role: "system" as const,
      content:
        "Conversation history is loaded from SendBlue. Each user message is prefixed with its sender so group chats are understandable.",
    },
    ...history,
    {
      role: "user" as const,
      content: `${senderLabel(message as Message<SendblueMessagePayload>)}: ${message.text ?? ""}`,
    },
  ];

  const response = await respondToConversation(messages, {
    conversationId: thread.id,
    threadId: thread.id,
    chat: {
      getAdapter: (name) => (name === "sendblue" ? chat.getAdapter("sendblue") : undefined),
      send: async (adapterName, threadId, text) => {
        if (adapterName !== "sendblue") throw new Error(`Unsupported adapter: ${adapterName}`);
        return chat.getAdapter("sendblue").postMessage(threadId, text);
      },
    },
    canSendTyping: !isGroupThread(thread.id),
  });

  if (response) {
    await thread.post(response);
  }
}

async function loadSendBlueHistory(threadId: string) {
  const adapter = chat.getAdapter("sendblue");
  const messages = await adapter.fetchMessages?.(threadId, { limit: 20 });
  const items = (messages?.messages ?? []) as Message<SendblueMessagePayload>[];

  return items.map((item) => ({
    role: item.author.isMe ? ("assistant" as const) : ("user" as const),
    content: item.author.isMe ? item.text ?? "" : `${senderLabel(item)}: ${item.text ?? ""}`,
  }));
}

function senderLabel(message: Partial<ChatMessage>) {
  return (
    message.author?.fullName ??
    message.author?.userName ??
    message.author?.userId ??
    message.raw?.from_number ??
    message.raw?.number ??
    "Unknown sender"
  );
}

export function isGroupThread(threadId: string) {
  return threadId.includes(":g:");
}

type ChatMessage = {
  id?: string;
  text?: string;
  fromBot?: boolean;
  author?: {
    userId?: string;
    userName?: string;
    fullName?: string;
  };
  raw?: Partial<SendblueMessagePayload>;
};
