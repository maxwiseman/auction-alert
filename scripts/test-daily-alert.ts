import { runDailyAlert } from "../lib/daily-alert";

const args = new Set(process.argv.slice(2));
const send = args.has("--send");
const to = valueAfter("--to");

const results = await runDailyAlert({
  dryRun: !send,
  recipients: to ? to.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
});

for (const result of results) {
  console.log("=".repeat(72));
  console.log(`${result.sent ? "Sent" : "Dry run"} for ${result.recipient}`);
  console.log("-".repeat(72));
  console.log(result.text);

  if (result.urls.length > 0) {
    console.log("-".repeat(72));
    for (const url of result.urls) {
      console.log(url);
    }
  }
}

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
