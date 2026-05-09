"use client";

import { useState } from "react";

export default function HomePage() {
  const [status, setStatus] = useState("Idle");
  const [transcript, setTranscript] = useState("");

  async function startRealtimeSession() {
    setStatus("Requesting ephemeral key...");
    const response = await fetch("/api/realtime/session", { method: "POST" });
    if (!response.ok) {
      setStatus("Failed to create realtime session");
      return;
    }
    const data = await response.json();
    setStatus(`Realtime session ready for model: ${data.model}`);
    setTranscript(JSON.stringify(data, null, 2));
  }

  return (
    <main>
      <h1>Auction Alert Control Center</h1>
      <p>
        This app now runs on Next.js and keeps existing Sendblue iMessage webhook endpoints. Use the button below to create
        a Realtime API session token for <code>gpt-realtime-2</code>.
      </p>
      <div className="card">
        <button onClick={startRealtimeSession}>Create Realtime Session</button>
        <p>Status: {status}</p>
        <pre>{transcript}</pre>
      </div>
    </main>
  );
}
