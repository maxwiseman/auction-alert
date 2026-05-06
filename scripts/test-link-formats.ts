import { sendTestDeliveryMessage } from "../server/lib/chat-bot";

const baseUrl = process.argv[2] ?? "https://bringatrailer.com/";
const variants = buildLinkVariants(baseUrl);

const result = await sendTestDeliveryMessage({
  message: [
    "Link preview format test.",
    "I am going to send several URL variants as separate messages.",
    "The JSON output labels them in order.",
  ].join(" "),
  links: variants.map((variant) => variant.url),
});

console.log(
  JSON.stringify(
    {
      baseUrl,
      variants,
      result,
    },
    null,
    2,
  ),
);

function buildLinkVariants(input: string) {
  const url = new URL(input);
  const withoutTrailingSlash = stripTrailingSlash(url.toString());
  const withTrailingSlash = ensureTrailingSlash(url.toString());
  const variants = [
    {
      label: "as-provided",
      url: url.toString(),
    },
    {
      label: "no-trailing-slash",
      url: withoutTrailingSlash,
    },
    {
      label: "with-trailing-slash",
      url: withTrailingSlash,
    },
    {
      label: "cache-busting-query",
      url: withQuery(url, "previewTest", String(Date.now())),
    },
    {
      label: "www-host",
      url: withHostPrefix(url, "www."),
    },
    {
      label: "no-www-host",
      url: withoutHostPrefix(url, "www."),
    },
    {
      label: "http-scheme",
      url: withProtocol(url, "http:"),
    },
  ];

  return dedupeVariants(variants);
}

function stripTrailingSlash(value: string) {
  return value.length > "https://x.y/".length ? value.replace(/\/+$/, "") : value;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function withQuery(url: URL, key: string, value: string) {
  const next = new URL(url);
  next.searchParams.set(key, value);
  return next.toString();
}

function withHostPrefix(url: URL, prefix: string) {
  const next = new URL(url);
  if (!next.hostname.startsWith(prefix)) {
    next.hostname = `${prefix}${next.hostname}`;
  }
  return next.toString();
}

function withoutHostPrefix(url: URL, prefix: string) {
  const next = new URL(url);
  if (next.hostname.startsWith(prefix)) {
    next.hostname = next.hostname.slice(prefix.length);
  }
  return next.toString();
}

function withProtocol(url: URL, protocol: "http:" | "https:") {
  const next = new URL(url);
  next.protocol = protocol;
  return next.toString();
}

function dedupeVariants(variants: Array<{ label: string; url: string }>) {
  const seen = new Set<string>();

  return variants.filter((variant) => {
    if (seen.has(variant.url)) return false;
    seen.add(variant.url);
    return true;
  });
}
