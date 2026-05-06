import { Chat, type Message, type Thread } from "chat";
import { createSendblueAdapter, type SendblueMessagePayload } from "chat-adapter-sendblue";
import { respondToConversation } from "../agent";
import { createMemoryState } from "./memory-state";

export const chat = new Chat({
  userName: "auction-alert",
  adapters: {
    sendblue: createSendblueAdapter({
      allowedServices: ["iMessage", "SMS", "RCS"],
      webhookSecretHeader: "sb-signing-secret",
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
    log("handlers registered");
  }

  await chat.initialize();
  log("chat initialized");
  return chat;
}

function registerHandlers() {
  chat.onNewMention(async (thread, message) => {
    log("onNewMention", messageSummary(thread, message));
    await answerThread(thread, message);
  });

  chat.onDirectMessage(async (thread, message) => {
    log("onDirectMessage", messageSummary(thread, message));
    await answerThread(thread, message);
  });

  chat.onSubscribedMessage(async (thread, message) => {
    log("onSubscribedMessage", messageSummary(thread, message));
    await answerThread(thread, message);
  });
}

async function answerThread(thread: Thread, message: Message) {
  log("answerThread start", messageSummary(thread, message));
  await thread.subscribe?.();
  log("thread subscribed", { threadId: thread.id });

  if (!isGroupThread(thread.id)) {
    await thread.startTyping?.();
    log("typing indicator sent or attempted", { threadId: thread.id });
  }

  const history = await loadSendBlueHistory(thread.id);
  log("history loaded", { threadId: thread.id, messages: history.length });

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
  log("agent response generated", { threadId: thread.id, length: response.length, preview: response.slice(0, 160) });

  if (response) {
    await thread.post(response);
    log("response posted", { threadId: thread.id });
  } else {
    log("empty response skipped", { threadId: thread.id });
  }
}

async function loadSendBlueHistory(threadId: string) {
  const adapter = chat.getAdapter("sendblue");
  const messages = await adapter.fetchMessages?.(threadId, { limit: 20 });
  const items = (messages?.messages ?? []) as Message<SendblueMessagePayload>[];
  log("sendblue fetchMessages result", { threadId, messages: items.length, nextCursor: messages?.nextCursor });

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

function messageSummary(thread: Thread, message: Message) {
  const raw = message.raw as Partial<SendblueMessagePayload> | undefined;
  return {
    threadId: thread.id,
    messageId: message.id,
    isMention: message.isMention,
    text: message.text?.slice(0, 160),
    author: message.author?.userId,
    service: raw?.service,
    status: raw?.status,
    isOutbound: raw?.is_outbound,
    messageType: raw?.message_type,
    groupId: raw?.group_id,
    from: raw?.from_number,
    to: raw?.to_number,
  };
}

function log(message: string, data?: Record<string, unknown>) {
  console.log(`[auction-alert] ${message}`, data ?? "");
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
