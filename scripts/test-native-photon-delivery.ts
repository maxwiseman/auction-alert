import { chatGuid, createClient, directChat } from "@photon-ai/advanced-imessage";
import { cloud } from "spectrum-ts";
import { readEnv, readEnvAlias } from "../server/lib/env";

const recipient = readEnvAlias("AUCTION_ALERT_TEST_TO", "AUCTION_ALERT_ONLY_PHONE_NUMBERS") ??
  firstRecipient(readEnvAlias("AUCTION_ALERT_PHONE_NUMBERS", "CHAT_SDK_DELIVERY_PHONE_NUMBERS")) ??
  "+18655675180";
const message =
  process.argv[2] ??
  `Native Photon iMessage delivery test at ${new Date().toISOString()}`;
const richLink = process.argv[3];
const projectId = readEnv("PHOTON_PROJECT_ID");
const projectSecret = readEnvAlias("PHOTON_PROJECT_SECRET", "PHOTON_API_KEY");

if (!projectId || !projectSecret) {
  throw new Error("PHOTON_PROJECT_ID and PHOTON_API_KEY are required.");
}

const tokenData = await cloud.issueImessageTokens(projectId, projectSecret);
const clientConfig = selectClientConfig(tokenData);
const client = createClient({
  ...clientConfig,
  tls: true,
});
const chat = toChatGuid(recipient);

try {
  const main = await client.messages.send(chat, message);
  const link = richLink
    ? await client.messages.send(chat, richLink, { richLink: true })
    : undefined;

  console.log(
    JSON.stringify(
      {
        delivered: true,
        sdk: "@photon-ai/advanced-imessage",
        tokenType: tokenData.type,
        recipient,
        chatGuid: chat,
        senderPhone: clientConfig.phone,
        messageGuid: main.guid,
        linkMessageGuid: link?.guid,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        delivered: false,
        sdk: "@photon-ai/advanced-imessage",
        tokenType: tokenData.type,
        recipient,
        chatGuid: chat,
        senderPhone: clientConfig.phone,
        reason: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

function selectClientConfig(tokenData: Awaited<ReturnType<typeof cloud.issueImessageTokens>>) {
  if (tokenData.type === "shared") {
    return {
      address: readEnv("SPECTRUM_IMESSAGE_ADDRESS") ?? "imessage.spectrum.photon.codes:443",
      token: tokenData.token,
      phone: "shared",
    };
  }

  const preferredPhone = readEnvAlias(
    "PHOTON_IMESSAGE_PHONE",
    "SPECTRUM_IMESSAGE_PHONE",
    "AUCTION_ALERT_ASSIGNED_PHONE_NUMBER",
  );
  const instanceId =
    (preferredPhone
      ? Object.entries(tokenData.numbers).find(
          ([, phone]) => phone === normalizePhone(preferredPhone),
        )?.[0]
      : undefined) ?? Object.keys(tokenData.auth)[0];

  if (!instanceId) {
    throw new Error("Photon returned a dedicated token with no iMessage instances.");
  }

  return {
    address: `${instanceId}.imsg.photon.codes:443`,
    token: tokenData.auth[instanceId] ?? "",
    phone: tokenData.numbers[instanceId] ?? null,
  };
}

function toChatGuid(value: string) {
  if (/^(any|iMessage|SMS);[+-];/.test(value)) return chatGuid(value);
  return directChat(normalizeRecipient(value));
}

function normalizeRecipient(value: string) {
  if (value.includes("@")) return value.trim();
  return normalizePhone(value);
}

function normalizePhone(phone: string) {
  return phone.startsWith("+")
    ? `+${phone.slice(1).replace(/\D/g, "")}`
    : `+${phone.replace(/\D/g, "")}`;
}

function firstRecipient(value?: string) {
  return value
    ?.split(/[\n,;]/)
    .map((item) => item.trim())
    .find(Boolean);
}
