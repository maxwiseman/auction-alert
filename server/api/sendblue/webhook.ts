import { defineHandler } from "nitro";
import { initializeChat } from "../../../lib/chat";

export default defineHandler(async (event) => {
  if (event.req.method === "GET") {
    return { ok: true, route: "/api/sendblue/webhook" };
  }

  const clonedRequest = event.req.clone();
  const body = await safeJson(clonedRequest);
  console.log("[auction-alert] sendblue webhook received", {
    method: event.req.method,
    hasSigningSecret: event.req.headers.has("sb-signing-secret"),
    contentType: event.req.headers.get("content-type"),
    keys: body && Object.keys(body),
    status: body?.status,
    isOutbound: body?.is_outbound,
    service: body?.service,
    messageType: body?.message_type,
    groupId: body?.group_id,
    from: body?.from_number,
    to: body?.to_number,
    contentPreview: typeof body?.content === "string" ? body.content.slice(0, 160) : undefined,
  });

  const bot = await initializeChat();
  return bot.webhooks.sendblue(event.req);
});

async function safeJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.log("[auction-alert] sendblue webhook body parse failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
