import { Chat, type Adapter } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { createiMessageAdapter } from "chat-adapter-imessage";
import { Spectrum, group, richlink, type SpectrumInstance } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { readChatConfig } from "./chat-config";
import { runBatAlert, type BatAlertResult } from "./bat-alert";
import { readEnv, readEnvAlias } from "./env";
import { readFilterConfig } from "./filter-config";
import { createAuctionStore } from "./upstash-store";

type iMessageAdapterWithChannel = ReturnType<typeof createiMessageAdapter> &
  Adapter & {
    startGatewayListener: ReturnType<typeof createiMessageAdapter>["startGatewayListener"];
  };

type AuctionChatBot = Chat<{ imessage: iMessageAdapterWithChannel }>;
type DiagnosticSpace = {
  // Diagnostic-only helper around Spectrum's overloaded send signature.
  send: (...content: any[]) => Promise<any>;
};

let botPromise: Promise<AuctionChatBot> | undefined;
let spectrumPromise: Promise<SpectrumInstance<[ReturnType<typeof imessage.config>]>> | undefined;

export async function getChatBot() {
  if (!botPromise) {
    botPromise = createChatBot();
  }

  return botPromise;
}

export async function sendAlertThroughChatSdk(message: string) {
  const config = await readChatConfig();
  const configuredThreadId = getConfiguredRecipients(config)[0]?.threadId;

  if (!configuredThreadId) {
    return {
      delivered: false,
      reason:
        "Chat SDK delivery is disabled. Set chat-config.json delivery.enabled=true and delivery.threadId, or set CHAT_SDK_DELIVERY_THREAD_ID.",
    };
  }

  try {
    const bot = await getChatBot();
    const thread = bot.thread(configuredThreadId);
    const sent = await thread.post(message);

    return {
      delivered: true,
      threadId: configuredThreadId,
      messageId: sent.id,
    };
  } catch (error) {
    return {
      delivered: false,
      threadId: configuredThreadId,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runAndSendAlertsThroughChatSdk() {
  const config = await readChatConfig();
  const recipients = getConfiguredRecipients(config);

  if (recipients.length === 0) {
    const alert = await runBatAlert();

    return {
      ...alert,
      deliveries: [
        {
          delivered: false,
          reason:
            "Chat SDK delivery is disabled or no recipients are configured. Set AUCTION_ALERT_PHONE_NUMBERS or chat-config.json delivery.threadId.",
        },
      ],
    };
  }

  const results = [];

  for (const recipient of recipients) {
    const alert = await runBatAlert({ contextId: recipient.threadId });
    const delivery = await sendAlertToThread(alert, recipient.threadId);
    results.push({
      recipient,
      alert,
      delivery,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    recipientCount: recipients.length,
    results,
  };
}

export async function sendTestDeliveryMessage(options: {
  message: string;
  links?: string[];
}) {
  const config = await readChatConfig();
  const recipients = getConfiguredRecipients(config);

  if (recipients.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      recipientCount: 0,
      results: [
        {
          delivery: {
            delivered: false,
            reason:
              "No recipients are configured. Set AUCTION_ALERT_PHONE_NUMBERS or chat-config.json delivery.threadId.",
          },
        },
      ],
    };
  }

  const results = [];

  for (const recipient of recipients) {
    const delivery = await sendMessageToThread({
      threadId: recipient.threadId,
      message: options.message,
      links: options.links ?? [],
      remember: false,
    });
    results.push({
      recipient,
      delivery,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    recipientCount: recipients.length,
    results,
  };
}

export async function sendSpectrumLinkPreviewDiagnostics(options: {
  targetUrl: string;
  comparisonUrl?: string;
}) {
  const config = await readChatConfig();
  const recipient = getConfiguredRecipients(config)[0];

  if (!recipient) {
    return {
      delivered: false,
      reason:
        "No recipients are configured. Set AUCTION_ALERT_PHONE_NUMBERS or chat-config.json delivery.threadId.",
    };
  }

  if (!shouldUseSpectrumDelivery()) {
    return {
      delivered: false,
      reason: "Link diagnostics require Spectrum delivery.",
      threadId: recipient.threadId,
    };
  }

  const spectrum = await getSpectrum();
  const to = iMessageThreadIdToRecipient(recipient.threadId);
  const space = await imessage(spectrum).space(to);
  const cases = buildLinkDiagnosticCases(options.targetUrl, options.comparisonUrl);
  const sent = [];

  await space.send(
    [
      "Link preview diagnostics.",
      "Each case sends a label followed by the URL payload being tested.",
    ].join(" "),
  );

  for (const item of cases) {
    const label = await space.send(`Case ${item.index}: ${item.label}`);
    const message = await item.send(space as unknown as DiagnosticSpace);
    sent.push({
      index: item.index,
      label: item.label,
      url: item.url,
      labelMessageId: label?.id,
      messageId: Array.isArray(message) ? message.map((part) => part?.id) : message?.id,
    });
  }

  return {
    delivered: true,
    transport: "spectrum",
    threadId: recipient.threadId,
    recipient: to,
    cases: sent,
  };
}

async function createChatBot() {
  const config = await readChatConfig();
  const imessage = createiMessageAdapter(resolveiMessageConfig()) as iMessageAdapterWithChannel;
  imessage.channelIdFromThreadId = (threadId: string) =>
    imessage.decodeThreadId(threadId).chatGuid;

  const bot = new Chat({
    userName: config.userName,
    adapters: {
      imessage,
    },
    state: readEnv("REDIS_URL")
      ? createRedisState({
          url: readEnv("REDIS_URL"),
          keyPrefix: `auction-alert:${readEnv("AUCTION_ALERT_NAMESPACE") ?? "default"}:chat-sdk`,
        })
      : createMemoryState(),
  });

  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await rememberChatMessage(thread.id, "user", message.text);

    if (isAlertRequest(message.text)) {
      await thread.post("Checking Bring a Trailer now...");
      const alert = await runBatAlert({ contextId: thread.id });
      await thread.post(alert.message);
      await rememberChatMessage(thread.id, "assistant", alert.message);
      return;
    }

    const reply = "Send \"check auctions\" and I will run the BaT alert.";
    await thread.post(reply);
    await rememberChatMessage(thread.id, "assistant", reply);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await rememberChatMessage(thread.id, "user", message.text);
    if (!isAlertRequest(message.text)) return;

    await thread.post("Checking Bring a Trailer now...");
    const alert = await runBatAlert({ contextId: thread.id });
    await thread.post(alert.message);
    await rememberChatMessage(thread.id, "assistant", alert.message);
  });

  await bot.initialize();
  return bot;
}

function isAlertRequest(text?: string) {
  return /\b(check|scan|run|auction|auctions|bat|bring a trailer)\b/i.test(text ?? "");
}

async function sendAlertToThread(alert: BatAlertResult, threadId: string) {
  return sendMessageToThread({
    threadId,
    message: alert.message,
    links: alert.matches
      .map((match) => match.url)
      .filter((url): url is string => Boolean(url)),
    remember: true,
  });
}

async function sendMessageToThread(options: {
  threadId: string;
  message: string;
  links: string[];
  remember: boolean;
}) {
  if (shouldUseSpectrumDelivery()) {
    return sendMessageThroughSpectrum(options);
  }

  try {
    const bot = await getChatBot();
    const thread = bot.thread(options.threadId);
    const sent = await thread.post(options.message);
    const linkMessages = uniqueLinks(options.links);
    const linkResults = [];

    for (const url of linkMessages) {
      const linkSent = await thread.post(url);
      linkResults.push({
        url,
        messageId: linkSent.id,
      });
    }

    if (options.remember) {
      await rememberChatMessage(
        options.threadId,
        "assistant",
        [options.message, ...linkMessages].join("\n"),
      );
    }

    return {
      delivered: true,
      transport: "chat-sdk",
      threadId: options.threadId,
      messageId: sent.id,
      linkCount: linkResults.length,
      links: linkResults,
    };
  } catch (error) {
    return {
      delivered: false,
      transport: "chat-sdk",
      threadId: options.threadId,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendMessageThroughSpectrum(options: {
  threadId: string;
  message: string;
  links: string[];
  remember: boolean;
}) {
  const recipient = iMessageThreadIdToRecipient(options.threadId);

  try {
    const spectrum = await getSpectrum();
    const space = await imessage(spectrum).space(recipient);
    const main = await space.send(options.message);
    const links = uniqueLinks(options.links);
    const linkResults = [];

    for (const url of links) {
      const sent = await space.send(richlink(url));
      linkResults.push({
        url,
        messageId: sent?.id,
      });
    }

    if (options.remember) {
      await rememberChatMessage(
        options.threadId,
        "assistant",
        [options.message, ...links].join("\n"),
      );
    }

    return {
      delivered: true,
      transport: "spectrum",
      threadId: options.threadId,
      recipient,
      messageId: main?.id,
      linkCount: linkResults.length,
      links: linkResults,
    };
  } catch (error) {
    return {
      delivered: false,
      transport: "spectrum",
      threadId: options.threadId,
      recipient,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getSpectrum() {
  if (!spectrumPromise) {
    const projectId = readEnv("PHOTON_PROJECT_ID");
    const projectSecret = readEnvAlias("PHOTON_PROJECT_SECRET", "PHOTON_API_KEY");

    if (!projectId || !projectSecret) {
      throw new Error(
        "PHOTON_PROJECT_ID and PHOTON_API_KEY are required for Spectrum delivery.",
      );
    }

    spectrumPromise = Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config()],
    });
  }

  return spectrumPromise;
}

function shouldUseSpectrumDelivery() {
  const transport = readEnv("AUCTION_ALERT_DELIVERY_TRANSPORT");
  if (transport === "spectrum") return true;
  if (transport === "chat-sdk") return false;
  if (readEnv("IMESSAGE_LOCAL") === "true") return false;

  return Boolean(readEnv("PHOTON_PROJECT_ID") && readEnvAlias("PHOTON_PROJECT_SECRET", "PHOTON_API_KEY"));
}

function iMessageThreadIdToRecipient(threadId: string) {
  if (threadId.startsWith("imessage:iMessage;-;")) {
    return threadId.slice("imessage:iMessage;-;".length);
  }
  if (threadId.startsWith("iMessage;-;")) {
    return threadId.slice("iMessage;-;".length);
  }
  if (threadId.startsWith("+")) {
    return threadId;
  }

  return threadId;
}

function uniqueLinks(urls: string[]) {
  return [...new Set(urls)];
}

function getConfiguredRecipients(config: Awaited<ReturnType<typeof readChatConfig>>) {
  const onlyPhoneValue = readEnvAlias("AUCTION_ALERT_ONLY_PHONE_NUMBERS");
  const onlyThreadIdValue = readEnvAlias("AUCTION_ALERT_ONLY_THREAD_IDS");
  const useOnlyRecipients =
    onlyPhoneValue !== undefined || onlyThreadIdValue !== undefined;
  const phoneValue =
    useOnlyRecipients
      ? onlyPhoneValue
      : readEnvAlias(
          "AUCTION_ALERT_PHONE_NUMBERS",
          "CHAT_SDK_DELIVERY_PHONE_NUMBERS",
        );
  const threadIdValue =
    useOnlyRecipients
      ? onlyThreadIdValue
      : readEnvAlias(
          "AUCTION_ALERT_THREAD_IDS",
          "CHAT_SDK_DELIVERY_THREAD_IDS",
        );
  const phoneRecipients = parseRecipientPhones(phoneValue);
  const explicitThreadIds = parseRecipientThreadIds(threadIdValue);
  const legacyThreadId = readEnv("CHAT_SDK_DELIVERY_THREAD_ID") ?? config.delivery.threadId;
  const includeConfigDelivery =
    readEnv("AUCTION_ALERT_IGNORE_CONFIG_DELIVERY") !== "true" &&
    !useOnlyRecipients;
  const recipients = [
    ...phoneRecipients,
    ...explicitThreadIds,
    ...(includeConfigDelivery && config.delivery.enabled && legacyThreadId
      ? [{ label: legacyThreadId, threadId: legacyThreadId }]
      : []),
  ];
  const seen = new Set<string>();

  return recipients.filter((recipient) => {
    if (seen.has(recipient.threadId)) return false;
    seen.add(recipient.threadId);
    return true;
  });
}

function parseRecipientPhones(value?: string) {
  if (!value) return [];

  return splitRecipientEnv(value, true).map((phone) => ({
    label: phone,
    threadId: phoneToiMessageThreadId(phone),
  }));
}

function parseRecipientThreadIds(value?: string) {
  if (!value) return [];

  return splitRecipientEnv(value, false).map((threadId) => ({
    label: threadId,
    threadId,
  }));
}

function splitRecipientEnv(value: string, allowSemicolonSeparator: boolean) {
  const separator = allowSemicolonSeparator ? /[\n,;]/ : /[\n,]/;
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function phoneToiMessageThreadId(phone: string) {
  if (phone.startsWith("imessage:")) return phone;
  if (phone.startsWith("iMessage;")) return `imessage:${phone}`;

  const normalized = normalizePhone(phone);

  return `imessage:iMessage;-;${normalized}`;
}

function normalizePhone(phone: string) {
  return phone.startsWith("+")
    ? `+${phone.slice(1).replace(/\D/g, "")}`
    : `+${phone.replace(/\D/g, "")}`;
}

function buildLinkDiagnosticCases(targetUrl: string, comparisonUrl?: string) {
  const target = new URL(targetUrl).toString();
  const comparison = comparisonUrl ? new URL(comparisonUrl).toString() : "https://photon.codes/";
  const cases = [
    {
      label: "Spectrum richlink target URL",
      url: target,
      send: (space: DiagnosticSpace) =>
        space.send(richlink(targetUrl)),
    },
    {
      label: "Plain text target URL",
      url: target,
      send: (space: DiagnosticSpace) =>
        space.send(target),
    },
    {
      label: "Text and richlink in one variadic send",
      url: target,
      send: (space: DiagnosticSpace) =>
        space.send("Target richlink follows:", richlink(target)),
    },
    // {
    //   label: "Grouped text and richlink",
    //   url: target,
    //   send: (space: DiagnosticSpace) =>
    //     space.send(group("Target grouped richlink:", richlink(target))),
    // },
    {
      label: "Spectrum richlink comparison URL",
      url: comparison,
      send: (space: DiagnosticSpace) =>
        space.send(richlink(comparison)),
    },
    {
      label: "Plain text comparison URL",
      url: comparison,
      send: (space: DiagnosticSpace) =>
        space.send(comparison),
    },
  ];

  return cases.map((item, index) => ({ ...item, index: index + 1 }));
}

async function rememberChatMessage(
  contextId: string,
  role: "user" | "assistant",
  content?: string,
) {
  if (!content) return;

  const [config, store] = await Promise.all([
    readFilterConfig(),
    Promise.resolve(createAuctionStore()),
  ]);
  await store.appendChatHistoryEntry({ role, content }, config, contextId);
}

function resolveiMessageConfig() {
  const localSetting = readEnv("IMESSAGE_LOCAL");
  const local = localSetting === "true";

  if (local) {
    return { local: true as const };
  }

  const serverUrl = readEnv("IMESSAGE_SERVER_URL");
  const apiKey = readEnvAlias("IMESSAGE_API_KEY", "PHOTON_API_KEY");

  if (!serverUrl) {
    const projectId = readEnv("PHOTON_PROJECT_ID");
    throw new Error(
      projectId
        ? "IMESSAGE_SERVER_URL is required for chat-adapter-imessage remote mode. PHOTON_PROJECT_ID/PHOTON_API_KEY are Spectrum-style credentials and do not provide the iMessage server URL this adapter needs."
        : "IMESSAGE_SERVER_URL is required for Chat SDK iMessage delivery. Set IMESSAGE_LOCAL=true only for explicit local macOS mode.",
    );
  }

  if (!apiKey) {
    throw new Error(
      "IMESSAGE_API_KEY is required when IMESSAGE_LOCAL=false. PHOTON_API_KEY is also accepted as an alias.",
    );
  }

  return {
    local: false as const,
    serverUrl,
    apiKey,
  };
}
