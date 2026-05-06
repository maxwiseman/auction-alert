import { IMessageSDK } from "@photon-ai/imessage-kit";
import { readEnvAlias } from "../server/lib/env";

const recipient = readEnvAlias("AUCTION_ALERT_TEST_TO", "AUCTION_ALERT_ONLY_PHONE_NUMBERS") ??
  firstRecipient(readEnvAlias("AUCTION_ALERT_PHONE_NUMBERS", "CHAT_SDK_DELIVERY_PHONE_NUMBERS")) ??
  "+18655675180";
const message =
  process.argv[2] ??
  `Native local iMessage delivery test at ${new Date().toISOString()}`;

const sdk = new IMessageSDK({
  debug: true,
});

try {
  const result = await sdk.send(recipient, message);
  console.log(
    JSON.stringify(
      {
        delivered: true,
        sdk: "@photon-ai/imessage-kit",
        recipient,
        sentAt: result.sentAt,
        messageGuid: result.message?.guid,
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
        sdk: "@photon-ai/imessage-kit",
        recipient,
        reason: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      },
      null,
      2,
    ),
  );
} finally {
  await sdk.close();
}

function firstRecipient(value?: string) {
  return value
    ?.split(/[\n,;]/)
    .map((item) => item.trim())
    .find(Boolean);
}
