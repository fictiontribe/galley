/**
 * The two parts of the audit that look beyond the content: links to other
 * sites that no longer answer (off unless asked for — it makes requests to
 * those sites, so it goes slowly, a few at a time, with a cap), and what an
 * AI agent receives for one page.
 */
import { PRODUCT } from "../brand";
import type { SiteService } from "../types";
import { readContentPage } from "./content";
import { finding } from "./finding";
import { localizeFacts, parsePage } from "./html";
import { findRenderSource } from "./render";
import type { AgentView, Finding } from "./types";

export interface ExternalOptions {
  /** Most distinct addresses to try. Default 50. */
  limit?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** Test seam. */
  fetch?: typeof fetch;
}

/** Every distinct http(s) link to another site, with the pages it is on. */
async function externalLinks(site: SiteService): Promise<Map<string, Array<{ path: string; url: string | null; title?: string }>>> {
  const model = await site.model();
  const out = new Map<string, Array<{ path: string; url: string | null; title?: string }>>();
  const own = new Set([model.urls.production, model.urls.staging].filter((u): u is string => Boolean(u)).map((u) => new URL(u).host));

  for (const collection of model.collections) {
    const list = await site.listEntries(collection.id).catch(() => null);

    for (const item of list?.items ?? []) {
      const page = readContentPage(await site.readEntry(item.path), collection);

      for (const link of page.links) {
        if (!/^https?:\/\//i.test(link.href)) continue;
        let host: string;

        try {
          host = new URL(link.href).host;
        } catch {
          continue;
        }
        if (own.has(host) || /(^|\.)example\.(com|org|net)$/.test(host)) continue;
        const key = link.href.split("#")[0]!;
        const pages = out.get(key) ?? [];

        if (!pages.some((p) => p.path === page.path)) pages.push({ path: page.path, url: page.url, ...(page.title ? { title: page.title.value } : {}) });
        out.set(key, pages);
      }
    }
  }
  return out;
}

/** Links to other sites that answer 404/410 or not at all. HEAD first, GET when HEAD isn't allowed. */
export async function checkExternalLinks(site: SiteService, options: ExternalOptions = {}): Promise<{ checked: number; total: number; findings: Finding[] }> {
  const doFetch = options.fetch ?? fetch;
  const links = [...(await externalLinks(site)).entries()];
  const limit = options.limit ?? 50;
  const chosen = links.slice(0, limit);
  const findings: Finding[] = [];
  let next = 0;
  const headers = { "user-agent": `${PRODUCT.name}-link-check/1.0 (a site owner checking their own links)` };

  const one = async (url: string): Promise<{ status: number | null }> => {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 8_000);

    try {
      let response = await doFetch(url, { method: "HEAD", redirect: "follow", signal, headers });

      if (response.status === 405 || response.status === 501 || response.status === 403) response = await doFetch(url, { method: "GET", redirect: "follow", signal, headers });
      return { status: response.status };
    } catch {
      return { status: null };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 3, chosen.length) }, async () => {
      while (next < chosen.length) {
        const [url, pages] = chosen[next++]!;
        const { status } = await one(url);

        if (status !== null && status !== 404 && status !== 410) continue;
        for (const page of pages) {
          findings.push(
            finding("link-external-dead", {
              path: page.path,
              url: page.url,
              ...(page.title ? { pageTitle: page.title } : {}),
              key: url,
              evidence: { value: url, note: status === null ? "The other site didn't answer (it may be down, or gone)." : `The other site answered ${status === 404 ? "“not found”" : "“gone”"}.` },
            })
          );
        }
      }
    })
  );
  return { checked: chosen.length, total: links.length, findings };
}

const AGENT_TEXT_CHARS = 12_000;

/** What an agent reading the page receives: its markdown version when one is served, else its text with scripts off. */
export async function agentView(site: SiteService, urlPath: string): Promise<AgentView> {
  const model = await site.model();
  const source = await findRenderSource(site, model, 0);
  const finish = (kind: AgentView["kind"], from: string, text: string): AgentView => ({ url: urlPath, kind, from, text: text.length > AGENT_TEXT_CHARS ? `${text.slice(0, AGENT_TEXT_CHARS).trimEnd()}…` : text, truncated: text.length > AGENT_TEXT_CHARS });

  if (source) {
    const page = await source.get(urlPath);

    if (page && page.status < 400 && /html/.test(page.type)) {
      const facts = localizeFacts(parsePage(page.body), source.base);
      const twin = facts.links.find((link) => link.rel === "alternate" && link.type === "text/markdown");

      if (twin) {
        const href = new URL(twin.href, `http://local.invalid${urlPath}`).pathname;
        const markdown = await source.get(href);

        if (markdown && markdown.status === 200 && !/html/.test(markdown.type)) return finish("markdown", `${href}, from ${source.detail}`, markdown.body);
      }
      return finish("text", `the page's text with scripts off, from ${source.detail}`, facts.text);
    }
  }
  const entry = await site.entryForUrl(urlPath);

  if (!entry) return finish("content", "nothing: no page lives at this address", "");
  const collection = model.collections.find((c) => c.id === entry.collection);
  const page = collection ? readContentPage(await site.readEntry(entry.path), collection) : null;

  return finish("content", "the content files (start the preview or build the site to see what is actually sent)", [page?.title?.value, page?.description?.value, page?.text].filter(Boolean).join("\n\n"));
}
