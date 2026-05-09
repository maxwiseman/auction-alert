import { initializeChat } from "@/lib/chat";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, route: "/api/sendblue/webhook" });
}

export async function POST(request: Request) {
  const cloned = request.clone();
  const body = await safeJson(cloned);

  console.log("[auction-alert] sendblue webhook received", {
    method: request.method,
    hasSigningSecret: request.headers.has("sb-signing-secret"),
    contentType: request.headers.get("content-type"),
    keys: body && Object.keys(body),
  });

  const bot = await initializeChat();
  return bot.webhooks.sendblue(request);
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
