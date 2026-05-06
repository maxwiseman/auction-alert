import { generateDailyBrief } from "../agent";
import { initializeChat } from "./chat";

export type DailyAlertOptions = {
  dryRun?: boolean;
  recipients?: string[];
};

export type DailyAlertResult = {
  recipient: string;
  text: string;
  urls: string[];
  sent: boolean;
};

export async function runDailyAlert(options: DailyAlertOptions = {}) {
  const recipients = options.recipients ?? parseRecipients(process.env.SENDBLUE_ALERT_RECIPIENTS);
  if (recipients.length === 0) {
    throw new Error("No recipients configured. Set SENDBLUE_ALERT_RECIPIENTS or pass --to.");
  }

  const bot = options.dryRun ? null : await initializeChat();
  const adapter = bot?.getAdapter("sendblue");
  const results: DailyAlertResult[] = [];

  for (const recipient of recipients) {
    const brief = await generateDailyBrief(recipient);
    const text = brief.text || "No strong BaT picks today.";

    if (adapter) {
      const threadId = adapter.encodeThreadId({
        fromNumber: process.env.SENDBLUE_FROM_NUMBER ?? "",
        contactNumber: recipient,
      });
      await adapter.postMessage(threadId, text);

      for (const url of brief.urls) {
        await adapter.postMessage(threadId, url);
      }
    }

    results.push({ recipient, text, urls: brief.urls, sent: Boolean(adapter) });
  }

  return results;
}

export function parseRecipients(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
