import { runDailyAlert } from "../../../../lib/daily-alert";
import { createError, defineEventHandler, getHeader } from "h3";

export default defineEventHandler(async (event) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = getHeader(event, "authorization");
    if (auth !== `Bearer ${secret}`) {
      throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
    }
  }

  if (!process.env.SENDBLUE_ALERT_RECIPIENTS?.trim()) {
    throw createError({ statusCode: 400, statusMessage: "No SENDBLUE_ALERT_RECIPIENTS configured" });
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
