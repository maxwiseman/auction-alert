import { sendSpectrumLinkPreviewDiagnostics } from "../server/lib/chat-bot";

const targetUrl = process.argv[2] ?? "https://bringatrailer.com/";
const comparisonUrl = process.argv[3] ?? "https://photon.codes/";

const result = await sendSpectrumLinkPreviewDiagnostics({
  targetUrl,
  comparisonUrl,
});

console.log(JSON.stringify(result, null, 2));
