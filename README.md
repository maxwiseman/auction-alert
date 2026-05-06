# Auction alert

Daily Bring a Trailer auction scout powered by the Vercel AI SDK and Chat SDK.

## Getting started

```bash
bun install
bun run dev
```

Set these environment variables locally and in Vercel:

- `OPENAI_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `AUCTION_ALERT_NAMESPACE` optional, defaults to `default`
- `IMESSAGE_LOCAL=false` for Photon remote mode on Vercel
- `PHOTON_PROJECT_ID` and `PHOTON_API_KEY` for Photon Spectrum delivery
- `AUCTION_ALERT_DELIVERY_TRANSPORT` optional: `spectrum`, `chat-sdk`, or unset for auto. Auto uses local Chat SDK when `IMESSAGE_LOCAL=true`, otherwise Spectrum when Photon credentials are present.
- `IMESSAGE_SERVER_URL` and `IMESSAGE_API_KEY` optional, only for the older `chat-adapter-imessage` remote server path
- `REDIS_URL` optional but recommended for Chat SDK state
- `AUCTION_ALERT_PHONE_NUMBERS` comma-separated iMessage recipients, for example `+15555550101,+15555550102`
- `AUCTION_ALERT_THREAD_IDS` optional comma-separated Chat SDK thread IDs for group chats or precomputed iMessage chat GUIDs
- `CHAT_SDK_DELIVERY_THREAD_ID` optional override for `chat-config.json`

The alert criteria live in `criteria.md`. Edit that file to change what GPT-5.5 should look for.

The objective auction filters live in `auction-filter.json`. Edit that file to change source URL, countries, max bid, ending window, currencies, category exclusions, GPT candidate count, and Upstash retention windows.

The simplest way to send alerts to one or more people is `AUCTION_ALERT_PHONE_NUMBERS`:

```bash
AUCTION_ALERT_PHONE_NUMBERS=+15555550101,+15555550102
```

The app converts each number into an iMessage Chat SDK thread ID and stores each recipient's auction memory and conversation history separately.

The older single-recipient Chat SDK delivery settings also live in `chat-config.json`. To send one iMessage alert through config instead of env, set:

```json
{
  "delivery": {
    "enabled": true,
    "threadId": "imessage:iMessage;-;+15555551212"
  }
}
```

Use your own E.164 phone number in the thread ID. For group chats, use `AUCTION_ALERT_THREAD_IDS` or the iMessage chat GUID from Photon instead.

## Running the alert locally

```bash
bun run alert
```

The script fetches:

https://bringatrailer.com/auctions/?location=US&ending=24&bidTo=25000

It extracts embedded JSON auction data from the HTML, filters it using `auction-filter.json`, stores filtered auction snapshots in Upstash, asks GPT-5.5 to evaluate candidates against `criteria.md`, sends the alert through Vercel Chat SDK, and prints the alert message plus structured JSON.

The iMessage alert body is plain text. Auction URLs are sent afterward as individual rich-link messages so iMessage can render native previews.

## Testing extraction without API keys

```bash
curl -L 'https://bringatrailer.com/auctions/?location=US&ending=24&bidTo=25000' -o /tmp/bat-auctions.html
bun run test:extract /tmp/bat-auctions.html
```

This verifies the BaT JSON extraction and local filtering without calling OpenAI or Upstash.

## Testing delivery only

Use this when debugging Photon, iMessage, or Chat SDK delivery without running the BaT scrape or GPT selection:

```bash
bun run test:delivery
```

You can override the message and add one link:

```bash
bun run test:delivery "Auction alert delivery smoke test" "https://bringatrailer.com/"
```

The output includes the selected transport, recipient phone, and any delivery error returned by the provider.

To compare iMessage link preview behavior across URL formats:

```bash
bun run test:links
```

You can pass a base URL to generate variants:

```bash
bun run test:links "https://bringatrailer.com/listing/example/"
```

When using Spectrum, link messages are sent with `richlink(...)` from `spectrum-ts`.

## Upstash memory

For each filtered auction, the app stores the latest normalized snapshot by auction ID or URL. On the next run, previously seen auctions are marked with `alreadySeen` and include a short `changesSinceLastSeen` list for GPT.

The chat route also stores recent AI SDK UI messages, and scheduled alert messages are stored as assistant history. The next run sends the configured recent history count to GPT for context. For multiple recipients, the iMessage thread ID is used as the per-user context key.

## iMessage setup

This project sends alerts with Photon Spectrum when `PHOTON_PROJECT_ID` and `PHOTON_API_KEY` are configured. Local testing can still use the Vercel Chat SDK `chat-adapter-imessage` adapter with `IMESSAGE_LOCAL=true`.

For Vercel production, use Photon Spectrum credentials:

```bash
PHOTON_PROJECT_ID=...
PHOTON_API_KEY=...
```

If Spectrum returns `Target not allowed for this project`, the project authenticated successfully but Photon rejected that recipient. Photon may send the recipient an approval email before outbound messages are allowed. Accept that approval, then rerun `bun run test:delivery`.

Use `AUCTION_ALERT_PHONE_NUMBERS` for the recipient's real phone number. Do not put the Photon assigned number there.

For local macOS development with the Chat SDK adapter, set `IMESSAGE_LOCAL=true`. Local mode requires iMessage signed in on the Mac and Full Disk Access for the terminal/app.

The Chat SDK state adapter uses `REDIS_URL` when present, otherwise it falls back to in-memory state. In-memory state is fine for a local smoke test, but use Redis for deployed inbound message handling.

## API routes

- `GET /api/cron` runs the daily alert, sends it through Chat SDK, and returns the structured result.
- `POST /api/chat` accepts AI SDK UI messages and streams a response with the latest alert result.
- `GET /api/imessage/gateway` keeps the iMessage adapter listening for inbound messages.

`vercel.json` schedules `/api/cron` once per day at `14:00 UTC`, and `/api/imessage/gateway` every 9 minutes so the iMessage listener stays warm.

## Deploying

```bash
bun run build
```

Deploy to Vercel with the environment variables above configured.
