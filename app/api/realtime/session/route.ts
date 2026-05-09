export const runtime = "nodejs";

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }

  const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2";

  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice: "verse",
      instructions: "You are Auction Alert voice assistant. Help users with vehicle auction searches and criteria updates.",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json({ error: "Failed to create session", details: data }, { status: response.status });
  }

  return Response.json({
    model,
    expires_at: data.expires_at,
    client_secret: data.client_secret,
    session_id: data.id,
  });
}
