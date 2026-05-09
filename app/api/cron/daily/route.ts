import { runDailyAlert } from "@/lib/daily-alert";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.SENDBLUE_ALERT_RECIPIENTS?.trim()) {
    return Response.json({ error: "No SENDBLUE_ALERT_RECIPIENTS configured" }, { status: 400 });
  }

  const results = await runDailyAlert({ dryRun: false });
  return Response.json({
    ok: true,
    sent: results.map((result) => ({ recipient: result.recipient, urls: result.urls.length })),
  });
}
