/**
 * Stand-ins for the preview proxy and the baseline proxy: two loopback HTTP
 * servers per site that render its pages from the working copy ("proposed")
 * or the last published version ("live"). Pages are deliberately plain —
 * they are somebody else's site — and report navigation to the host the way
 * the overlay script does, so the preview pane can follow links.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import YAML from "yaml";
import type { JsonValue } from "@galley/core/types";
import { mimeOf, type MockSite } from "./site.ts";

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const inline = (text: string) => esc(text).replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((block) => (block.startsWith("## ") ? `<h2>${inline(block.slice(3))}</h2>` : block.startsWith("> ") ? `<blockquote>${inline(block.slice(2))}</blockquote>` : `<p>${inline(block)}</p>`))
    .join("");

type Obj = { [key: string]: JsonValue };
const isObj = (v: JsonValue | undefined): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined) => (typeof v === "string" ? v : "");

function link(v: JsonValue | undefined, cls: string): string {
  return isObj(v) ? `<a class="${cls}" href="${esc(str(v.href))}">${esc(str(v.label))}</a>` : "";
}

function section(s: Obj): string {
  const tone = str(s.tone) || "default";
  const head = `${s.eyebrow ? `<p class="eyebrow">${esc(str(s.eyebrow))}</p>` : ""}${s.heading ? `<h2>${inline(str(s.heading))}</h2>` : ""}${s.text && s.type !== "rich-text" ? `<p class="lede">${inline(str(s.text))}</p>` : ""}`;
  const items = Array.isArray(s.items) ? s.items : [];
  let body = "";
  switch (s.type) {
    case "hero":
      return `<section class="hero tone-${tone}"><div class="wrap"><div>${s.eyebrow ? `<p class="eyebrow">${esc(str(s.eyebrow))}</p>` : ""}<h1>${inline(str(s.heading))}</h1>${s.text ? `<p class="lede">${inline(str(s.text))}</p>` : ""}<p>${link(s.cta, "btn")} ${link(s.secondaryCta, "btn ghost")}</p></div>${s.image ? `<img src="${esc(str(s.image))}" alt="${esc(str(s.imageAlt))}">` : ""}</div></section>`;
    case "logos":
      body = `<div class="logos">${items.map((i) => (isObj(i) ? `<img src="${esc(str(i.image))}" alt="${esc(str(i.name))}">` : "")).join("")}</div>`;
      break;
    case "split":
      return `<section class="split tone-${tone}"><div class="wrap"><div>${head}${Array.isArray(s.items) ? `<ul>${items.map((i) => `<li>${inline(str(i))}</li>`).join("")}</ul>` : ""}<p>${link(s.cta, "btn")}</p></div><img src="${esc(str(s.image))}" alt="${esc(str(s.imageAlt))}"></div></section>`;
    case "rich-text":
      body = paragraphs(str(s.text));
      break;
    case "testimonial":
      body = `<blockquote>${inline(str(s.quote))}<cite>${esc(str(s.name))}${s.role ? `, ${esc(str(s.role))}` : ""}</cite></blockquote>`;
      break;
    case "cta":
      body = `<p>${link(s.cta, "btn")} ${link(s.secondaryCta, "btn ghost")}</p>`;
      break;
    default:
      body = items.length
        ? `<div class="grid">${items
            .map((i) =>
              isObj(i)
                ? `<div class="card">${i.value ? `<p class="stat">${esc(str(i.value))}</p>` : ""}${i.image ? `<img src="${esc(str(i.image))}" alt="${esc(str(i.imageAlt))}">` : ""}<h3>${esc(str(i.heading) || str(i.name) || str(i.label) || str(i.question))}</h3>${i.price ? `<p class="stat">${esc(str(i.price))}</p>` : ""}<p>${inline(str(i.text) || str(i.answer) || str(i.quote) || str(i.caption))}</p></div>`
                : "",
            )
            .join("")}</div>`
        : "";
  }
  return `<section class="tone-${tone}"><div class="wrap block">${head}${body}</div></section>`;
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;font:16px/1.55 ui-sans-serif,system-ui,sans-serif;color:#1d2420;background:#fbfaf7}
a{color:inherit}.wrap{max-width:1080px;margin:0 auto;padding:0 28px}
header{border-bottom:1px solid #e6e2d8;background:#fff}header .wrap{display:flex;justify-content:space-between;align-items:center;height:64px}
header b{letter-spacing:.12em;font-size:13px;text-transform:uppercase}nav a{margin-left:20px;text-decoration:none;font-size:14px;color:#46524b}
h1,h2,h3{font-family:Georgia,serif;font-weight:500;line-height:1.1;margin:0 0 .5em}h1{font-size:46px;max-width:14ch}h2{font-size:30px}h3{font-size:19px}
em{font-style:italic;color:#2f5d50}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#5d6b63;margin:0 0 12px}.lede{font-size:18px;color:#46524b;max-width:56ch}
section{padding:64px 0}.hero .wrap,.split .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}.hero img,.split img{width:100%;border-radius:4px}
.tone-muted{background:#f1eee6}.tone-inverse{background:#1d2420;color:#f4f1ea}.tone-inverse .lede,.tone-inverse .eyebrow{color:#c9cfc8}.tone-accent{background:#2f5d50;color:#fff}
.btn{display:inline-block;padding:11px 18px;border-radius:3px;background:#1d2420;color:#fff;text-decoration:none;font-weight:600;font-size:14px;margin-right:8px}.btn.ghost{background:transparent;color:inherit;box-shadow:inset 0 0 0 1px currentColor}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;margin-top:28px}.card{padding:20px;border-radius:4px;background:rgba(255,255,255,.6);box-shadow:0 0 0 1px rgba(0,0,0,.06)}.card img{width:100%}
.stat{font-family:Georgia,serif;font-size:34px;margin:0}.logos{display:flex;gap:32px;flex-wrap:wrap;align-items:center;margin-top:20px}.logos img{height:34px}
blockquote{font-family:Georgia,serif;font-size:22px;margin:24px 0}cite{display:block;font:14px ui-sans-serif,system-ui;margin-top:12px;color:#5d6b63}
article{max-width:720px;margin:0 auto;padding:56px 28px}article img{width:100%;border-radius:4px;margin:24px 0}footer{padding:40px 0;border-top:1px solid #e6e2d8;font-size:14px;color:#5d6b63}
@media (max-width:760px){.hero .wrap,.split .wrap{grid-template-columns:1fr}h1{font-size:34px}nav a{margin-left:12px;font-size:13px}section{padding:40px 0}}
`;

/**
 * The first section that names a picture but leaves it blank — the case that
 * stops a real site's page from drawing (its image component throws) — so
 * the mock can answer the way a dev server does, with an error page.
 */
function undrawable(sections: JsonValue[]): { index: number; type: string } | null {
  for (const [index, s] of sections.entries()) {
    if (isObj(s) && Object.hasOwn(s, "image") && str(s.image).trim() === "") return { index, type: str(s.type) || "section" };
  }
  return null;
}

/**
 * The dev server's error page, as Astro sends it (a title and a script), with
 * what the overlay would say about it: the page wasn't drawn, and the
 * framework's first line about why.
 */
function errorPage(message: string): string {
  const say = (data: object) => `parent.postMessage(${JSON.stringify({ galley: 1, ...data })},"*");`;
  return `<title>Error</title><script>${say({ type: "ready", path: "__PATH__", title: "Error" }).replace('"__PATH__"', "location.pathname")}${say({ type: "page-state", state: "failed", status: 500, message })}addEventListener("message",(e)=>{if(e.source===parent&&e.data&&e.data.galley===1&&e.data.type==="reload")location.reload()});</script><pre style="font:13px ui-monospace,monospace;padding:24px;color:#b3261e;white-space:pre-wrap">${esc(message)}</pre>`;
}

function page(site: MockSite, urlPath: string, rev: "base" | undefined): { status: number; html: string } {
  const readJson = (path: string) => {
    const bytes = site.read(path, rev);
    try {
      return bytes ? (JSON.parse(bytes.toString("utf8")) as Obj) : null;
    } catch {
      return null;
    }
  };
  const nav = readJson("src/data/navigation.json");
  const settings = readJson("src/data/site.json") ?? readJson("src/_data/settings.json");
  const siteName = str(settings?.name) || str(settings?.title) || site.name;
  const header = `<header><div class="wrap"><a href="/" style="text-decoration:none"><b>${esc(siteName)}</b></a><nav>${(Array.isArray(nav?.header) ? nav.header : []).map((l) => (isObj(l) ? `<a href="${esc(str(l.href))}">${esc(str(l.label))}</a>` : "")).join("")}</nav></div></header>`;
  const footer = `<footer><div class="wrap">${esc(str(settings?.footerText) || str(settings?.footer) || siteName)}</div></footer>`;

  const entry = site.entryForUrl(urlPath);
  let main = "";
  let title = siteName;
  if (entry) {
    const raw = site.read(entry.path, rev)?.toString("utf8");
    if (raw) {
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
      const data = (match ? YAML.parse(match[1] ?? "") : {}) as Obj;
      const body = match?.[2] ?? "";
      title = str(data.title) || entry.title;
      if (Array.isArray(data.sections)) {
        const broken = undrawable(data.sections);
        if (broken) {
          return { status: 500, html: errorPage(`Image's and getImage's src parameter must be an imported image or an URL, it cannot be undefined. (sections.${broken.index}, a ${broken.type} section)`) };
        }
        main = data.sections.map((s) => (isObj(s) ? section(s) : "")).join("");
      }
      else main = `<article>${data.date ? `<p class="eyebrow">${esc(str(data.date))}</p>` : ""}<h1>${inline(title)}</h1>${data.description || data.summary ? `<p class="lede">${inline(str(data.description) || str(data.summary))}</p>` : ""}${data.image ? `<img src="${esc(str(data.image))}" alt="${esc(str(data.imageAlt))}">` : ""}${paragraphs(body.trim())}</article>`;
    }
  }
  const status = main ? 200 : 404;
  if (!main) main = `<article><p class="eyebrow">404</p><h1>Page not found</h1><p class="lede">${rev === "base" ? "This page isn’t on the live site yet." : "Nothing lives at this address."}</p></article>`;
  // As the overlay would: where the page is, and that it was drawn.
  const report = `<script>parent.postMessage({galley:1,type:"navigate",path:location.pathname,title:document.title},"*");parent.postMessage({galley:1,type:"page-state",state:"${status === 404 ? "missing" : "drawn"}",status:${status},message:null},"*")</script>`;
  return { status, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${header}<main>${main}</main>${footer}${report}</body></html>` };
}

function serve(site: MockSite, rev: "base" | undefined): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const mediaRoot = site.model().media;
    if (url.pathname.startsWith(`${mediaRoot.publicPath}/`)) {
      const path = `${mediaRoot.dir}/${url.pathname.slice(mediaRoot.publicPath.length + 1)}`;
      const bytes = site.read(decodeURIComponent(path), rev);
      if (bytes) {
        res.writeHead(200, { "content-type": mimeOf(path), "cache-control": "no-store" });
        res.end(bytes);
        return;
      }
    }
    const { status, html } = page(site, url.pathname, rev);
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

export interface PreviewServers {
  url: string;
  baselineUrl: string;
  close: () => void;
}

export async function startPreviewServers(site: MockSite): Promise<PreviewServers> {
  const proposed = await serve(site, undefined);
  const live = await serve(site, "base");
  return {
    url: proposed.origin,
    baselineUrl: live.origin,
    close: () => {
      proposed.server.close();
      live.server.close();
    },
  };
}
