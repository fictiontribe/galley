/**
 * What "Keep pictures in Cloudflare Images" tells the person — the steps with
 * Cloudflare's own names, the fields, what the token allows — and the
 * settings checks. Data and pure functions with type-only imports, so the web
 * app's fixture backend loads it on its own. From Cloudflare's docs as read on
 * 24 November 2026 (docs/media-storage.md lists the pages).
 */
import type { MediaImagesConfig } from "../types";
import type { MediaStoreInfo } from "./contract";
import type { SettingsProblem } from "./info";

/** https:// only (http:// for this computer); the same rule as info.ts, kept here so this file has type-only imports (the web app's mock loads it in Node). */
function addressProblem(value: string, what: string, hosted = false): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return `The ${what} should be a full address starting with https://.`;
  }
  if (url.protocol === "http:" && (hosted || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) return `The ${what} has to start with https://, so visitors' browsers load it.`;
  if (url.protocol !== "https:" && url.protocol !== "http:") return `The ${what} has to start with https://.`;
  if (url.username || url.password || url.search || url.hash) return `The ${what} can't carry a name, a password, or a ? or # part.`;
  return null;
}

export const IMAGES_INFO: MediaStoreInfo = {
  id: "cloudflare-images",
  name: "Cloudflare Images",
  blurb: "Pictures only, resized and sent as WebP or AVIF by Cloudflare. Other files go to the bucket or the repository.",
  why: "Cloudflare turns each picture into the size and format each visitor's browser does best with, so pages load faster without anyone making smaller copies.",
  recommended: false,
  steps: [
    {
      title: "Turn on Images storage",
      text: [
        "In the Cloudflare dashboard, open Images › Hosted Images. Keeping pictures there needs the Images Paid plan: if Cloudflare offers it, take it (it charges per picture stored and per picture delivered).",
      ],
      url: "https://dash.cloudflare.com/?to=/:account/images/hosted",
      linkLabel: "Open Hosted Images",
    },
    {
      title: "Copy the account hash and the account ID",
      text: [
        "On the Hosted Images page, under “Developer Resources”, copy the account hash: it is the part after imagedelivery.net/ in the example address.",
        "The account ID is 32 letters and digits, in the dashboard's address right after dash.cloudflare.com/ and on the account's home page.",
      ],
    },
    {
      title: "Make a token for Images only",
      text: [
        "Open My Profile › API Tokens and select “Create Token”, then “Get started” next to “Create Custom Token”.",
        "Under “Permissions”, choose Account › Cloudflare Images › Edit. Under “Account Resources”, choose Include and this account.",
        "Select “Continue to summary”, then “Create Token”, and copy the token now: it is shown only once.",
        "If the site already has a Cloudflare key for putting it online, you can add Account › Cloudflare Images › Edit to that token instead, and choose to use it below.",
      ],
      url: "https://dash.cloudflare.com/profile/api-tokens",
      linkLabel: "Open API Tokens",
    },
  ],
  fields: [
    { id: "account", label: "Account ID", help: "32 letters and digits, in the dashboard's address after dash.cloudflare.com/.", placeholder: "4f0c…", required: true },
    { id: "accountHash", label: "Account hash", help: "Hosted Images › Developer Resources: the part after imagedelivery.net/.", placeholder: "ZWd9g1K7eljCn_KDTu_MWA", required: true },
    { id: "variant", label: "Variant", help: "The size pages ask for. “public” exists on every account; one you made on the Delivery tab works too.", placeholder: "public", required: false },
    {
      id: "deliveryUrl",
      label: "Deliver from your domain",
      help: "A domain proxied by Cloudflare in the same account (https://www.example.com): pictures are served from its /cdn-cgi/imagedelivery/ path. Empty: imagedelivery.net.",
      placeholder: "https://www.example.com",
      required: false,
    },
    { id: "token", label: "API token", help: "With Account › Cloudflare Images › Edit. Kept in this site's key store, never in the site's files, and never shown again.", required: true, secret: true },
  ],
  keyGrants:
    "Cloudflare Images › Edit lets the token upload, list, read and delete pictures in Images for the account you include — nothing else: not your domains, DNS, Workers or R2. Galley only deletes pictures no page uses.",
  publicNote: "Each picture is public at its delivery address as soon as it is uploaded. Pages store the address with the variant, so the site needs no build step to show it.",
  pricingUrl: "https://developers.cloudflare.com/images/pricing/",
  docsUrl: "https://developers.cloudflare.com/images/",
};

const ACCOUNT = /^[0-9a-f]{32}$/;
const HASH = /^[A-Za-z0-9_-]{8,64}$/;
const VARIANT = /^[A-Za-z0-9_-]{1,99}$/;

export function normalizeImagesConfig(config: MediaImagesConfig): MediaImagesConfig {
  const out: MediaImagesConfig = { connector: "cloudflare-images", account: config.account.trim().toLowerCase(), accountHash: config.accountHash.trim() };
  const variant = config.variant?.trim();
  const delivery = config.deliveryUrl?.trim().replace(/\/+$/, "");

  if (variant && variant !== "public") out.variant = variant;
  if (delivery && delivery !== "https://imagedelivery.net") out.deliveryUrl = delivery;
  return out;
}

export function imagesSettingsProblems(config: MediaImagesConfig, options: { hosted?: boolean } = {}): SettingsProblem[] {
  const problems: SettingsProblem[] = [];

  if (!ACCOUNT.test(config.account ?? "")) problems.push({ field: "account", message: "The account ID is 32 letters and digits, in the dashboard's address after dash.cloudflare.com/." });
  if (!HASH.test(config.accountHash ?? "")) problems.push({ field: "accountHash", message: "The account hash is one word from Hosted Images › Developer Resources: the part after imagedelivery.net/." });
  if (config.variant && !VARIANT.test(config.variant)) problems.push({ field: "variant", message: "A variant's name is letters, digits, dashes and underscores, like “public”." });
  if (config.deliveryUrl) {
    const problem = addressProblem(config.deliveryUrl, "domain to deliver from", Boolean(options.hosted));

    if (problem) problems.push({ field: "deliveryUrl", message: problem });
    else if (new URL(config.deliveryUrl).pathname.replace(/\/+$/, "") !== "") problems.push({ field: "deliveryUrl", message: "Give just the domain (https://www.example.com): Galley adds /cdn-cgi/imagedelivery/." });
  }
  return problems;
}
