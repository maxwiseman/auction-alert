# Auction Alert Rebuild Brief

Build a small daily Bring a Trailer auction alert script from scratch.

## Goal

Once per day, fetch live Bring a Trailer auctions, filter them down to plausible candidates, ask an OpenAI model to choose the best cars based on editable criteria, and send the result by iMessage using SendBlue through the Chat SDK.

## Target Auction Source

Start with this Bring a Trailer URL:

https://bringatrailer.com/auctions

The script should extract the embedded structured JSON from the HTML and normalize the auction list. The initial objective filters are:

- US location
- Current bid under $25,000
- Less than 24 hours remaining

Keep these objective filters configurable in a simple file.

## User Criteria

The subjective car criteria should live in a markdown file so it is easy to edit without touching code.

Current spirit of the criteria:

- Classic or emerging-classic Sunday car
- Fun to drive
- Lightweight or compact
- Manual transmission strongly preferred
- Likely to end under $25,000
- Driver quality, not a museum piece
- Avoid major rust, salvage titles, vague listings, heavy luxury cars, large SUVs, or obvious projects

## AI Behavior

Use one model call/agent to both:

- decide which filtered cars are worth alerting on
- write the final plain-text message

The model should not use markdown formatting because iMessage delivery is plain text.

Nice-to-have: give the model a tool that can fetch a specific auction detail page and extract useful listing details, comments, seller comments, and bid history.

## Message Delivery

Use SendBlue for iMessage delivery, ideally through its Chat SDK integration.

Expected delivery behavior:

- Send one concise plain-text summary message
- Send each auction URL as its own message afterward
- Support multiple recipients configured by environment variable
- Keep conversation/alert history separate per recipient

## Memory

Use Upstash Redis or another simple persistent store to remember:

- auctions already seen per recipient
- previous auction snapshots so the model can see what changed
- recent outbound/inbound chat messages for context

## Deployment

The deployed version should work on Vercel Hobby.

Important constraint:

- Only one Vercel Cron job should be used.

That cron should run the daily outbound alert. Avoid long-running listener cron jobs. If inbound messages are supported, prefer a webhook-style integration that can use `waitUntil`.

## Non-Goals For The Rebuild

- Do not keep the old Photon/Spectrum debugging code.
- Do not keep the previous experimental link-preview scripts.
- Do not depend on the old project structure unless it is useful.
- Keep the first implementation small and understandable.
