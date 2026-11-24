/**
 * The sample site's own data for the screens beyond editing, put in place
 * through the mock's own routes when the demo starts (so the mock's
 * behaviour stays its own): a few invented messages in the inbox from the
 * contact form, and the redirects a label like this would keep. Every name
 * and address is invented; every domain is `.example`.
 */
import type { FormSubmission } from "@galley/core/kit";
import type { Redirect } from "@galley/core/redirects-info";
import type { MockServer } from "../mock/server.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const PAGE = { url: "https://www.caddow.example/contact/", title: "Write to the workroom — Caddow" };

/** Ids sort in the order they arrived, as the real inbox's do. */
export function sampleSubmissions(siteId: string): FormSubmission[] {
  const base = { siteId, form: "contact", page: PAGE };
  return [
    {
      ...base,
      id: "01KCADDOW00000000000000001",
      at: ago(60 * 52),
      read: true,
      values: { name: "Marit Ellery", email: "marit@ellery.example", topic: "size", height: "5 ft 9, the field coat in oat", message: "I’m between two sizes in the field coat. Could you hold the 10 against me if I come by the workroom on Thursday?", consent: "yes" },
    },
    {
      ...base,
      id: "01KCADDOW00000000000000002",
      at: ago(60 * 5),
      read: false,
      values: { name: "Joss Penhale", email: "joss@penhale.example", topic: "repair", message: "My gansey from three winters ago has gone at the left elbow. Do you darn your own, and how long does it take?", consent: "yes" },
    },
    {
      ...base,
      id: "01KCADDOW00000000000000003",
      at: ago(40),
      read: false,
      values: { name: "Ines Varga", email: "ines@varga.example", topic: "stock", message: "Is the blanket scarf with the blue stripe still being made? The shop I go to says it has sold out.", consent: "yes" },
    },
    {
      ...base,
      id: "01KCADDOW00000000000000004",
      at: ago(12),
      read: false,
      spam: true,
      spamReason: "honeypot",
      values: { name: "Follower Boost", email: "offers@boost.example", topic: "press", message: "Grow your account by 10,000 followers this week." },
    },
  ];
}

export const SAMPLE_REDIRECTS: Redirect[] = [
  { from: "/about/", to: "/atelier/", status: 301, note: "The old about page" },
  { from: "/shop/", to: "/stockists/", status: 301, note: "There is no shop on the site: the stockists sell the clothes" },
  { from: "/lookbook/", to: "/collections/", status: 301 },
  { from: "/lookbook/autumn-winter-2026/", to: "/collections/aw26-the-long-afternoon/", status: 301, note: "Printed on the autumn postcards" },
  { from: "/journal/why-forty/", to: "/journal/why-we-make-forty/", status: 301 },
];

async function call(server: MockServer, method: string, url: string, body?: unknown): Promise<number> {
  const answer = await server.handle({ method, url, headers: body ? { "content-type": "application/json" } : {}, body: body ? Buffer.from(JSON.stringify(body)) : undefined });
  return answer.status;
}

/** Replace the mock's own sample inbox and redirects with the sample site's. */
export async function applySampleData(server: MockServer, siteId: string): Promise<void> {
  const inbox = `/api/sites/${encodeURIComponent(siteId)}/inbox/contact`;
  const listing = await server.handle({ method: "GET", url: `${inbox}?filter=all&limit=100`, headers: {} });
  const items = listing.body ? ((JSON.parse(String(listing.body)) as { items?: FormSubmission[] }).items ?? []) : [];
  if (items.length) await call(server, "POST", `${inbox}/delete`, { ids: items.map((item) => item.id) });
  await call(server, "POST", `${inbox}/restore`, { submissions: sampleSubmissions(siteId) });
  await call(server, "PUT", `/api/sites/${encodeURIComponent(siteId)}/redirects`, { redirects: SAMPLE_REDIRECTS });
}
