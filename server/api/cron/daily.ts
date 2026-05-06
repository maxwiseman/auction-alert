import { defineHandler, HTTPError } from "nitro";
import { runDailyAlert } from "../../../lib/daily-alert";

export default defineHandler(async (event) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = event.req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      throw new HTTPError("Unauthorized", { status: 401 });
    }
  }

  if (!process.env.SENDBLUE_ALERT_RECIPIENTS?.trim()) {
    throw new HTTPError("No SENDBLUE_ALERT_RECIPIENTS configured", { status: 400 });
  }

  const results = await runDailyAlert({ dryRun: false });
  return {
    ok: true,
    sent: results.map((result) => ({
      recipient: result.recipient,
      urls: result.urls.length,
    })),
  };
});
