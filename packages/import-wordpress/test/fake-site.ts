/**
 * A bigger invented WordPress site, made from a few templates so its size is
 * a parameter: dozens of posts with featured and inline images, pages (some
 * built with Elementor), categories, tags, three authors and Yoast-style SEO
 * details. It answers the REST routes the importer calls, serves its images,
 * and writes the same content as an export file — so the app, the command
 * line and the tests can all be pointed at one realistic source on this
 * computer, and nothing ever goes to a real WordPress site.
 *
 * Every name, place and word in it is made up.
 */
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { png } from "./png";

type Json = Record<string, unknown>;

export interface FakeSiteOptions {
  posts?: number;
  pages?: number;
  /** How many of the pages were built with Elementor. */
  elementor?: number;
}

export interface FakeSite {
  title: string;
  posts: Json[];
  pages: Json[];
  media: Json[];
  categories: Json[];
  tags: Json[];
  users: Json[];
  /** Upload path ("/wp-content/uploads/…") → bytes. */
  files: Map<string, Uint8Array>;
}

const TITLE = "Fernhill Garden Studio";
const AUTHORS = [
  { id: 1, name: "Ines Calder", slug: "ines" },
  { id: 2, name: "Rowan Pike", slug: "rowan" },
  { id: 3, name: "Mae Tulloch", slug: "mae" },
];
const CATEGORIES = [
  { id: 11, name: "Planting", slug: "planting" },
  { id: 12, name: "Design notes", slug: "design-notes" },
  { id: 13, name: "Studio news", slug: "studio-news" },
  { id: 14, name: "Seasonal jobs", slug: "seasonal-jobs" },
  { id: 1, name: "Uncategorized", slug: "uncategorized" },
];
const TAGS = ["shade", "clay soil", "meadow", "hedges", "ponds", "small gardens", "pots", "trees", "winter", "wildlife"].map((name, i) => ({ id: 21 + i, name, slug: name.replace(/\s+/g, "-") }));
const SUBJECTS = ["a shady corner", "heavy clay", "a meadow lawn", "a native hedge", "a wildlife pond", "a narrow side return", "pots on a balcony", "a first tree", "winter structure", "a front garden", "a gravel garden", "a cutting patch"];
const FORMS = ["What to plant in", "Five mistakes with", "A year with", "Notes on", "Planning", "Looking after"];
const SITE = "{{SITE}}";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function slugOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The same content, generated the same way every time. */
export function buildFakeSite(options: FakeSiteOptions = {}): FakeSite {
  const postCount = options.posts ?? 60;
  const pageCount = options.pages ?? 12;
  const elementorCount = Math.min(options.elementor ?? 4, pageCount);
  const files = new Map<string, Uint8Array>();
  const media: Json[] = [];
  let mediaId = 500;
  const image = (folder: string, name: string, alt: string, parent: number) => {
    const id = (mediaId += 1);
    const file = `${folder}/${name}.png`;

    files.set(`/wp-content/uploads/${file}`, png(96, 64, id));
    media.push({
      id,
      date: `${folder.replace("/", "-")}-01T09:00:00`,
      date_gmt: `${folder.replace("/", "-")}-01T09:00:00`,
      slug: name,
      type: "attachment",
      link: `${SITE}/?attachment_id=${id}`,
      title: { rendered: name.replace(/-/g, " ") },
      alt_text: alt,
      caption: { rendered: "" },
      media_type: "image",
      mime_type: "image/png",
      media_details: { width: 96, height: 64, sizes: { medium: { source_url: `${SITE}/wp-content/uploads/${folder}/${name}-300x200.png` } } },
      post: parent,
      source_url: `${SITE}/wp-content/uploads/${file}`,
    });
    return media[media.length - 1]!;
  };
  const yoast = (title: string, description: string, link: string) => ({ title: `${title} – ${TITLE}`, description, canonical: link, robots: { index: "index", follow: "follow" }, og_title: title });

  const posts: Json[] = [];

  for (let i = 0; i < postCount; i += 1) {
    const id = 1000 + i;
    const subject = SUBJECTS[i % SUBJECTS.length]!;
    const form = FORMS[Math.floor(i / SUBJECTS.length) % FORMS.length]!;
    const title = `${form} ${subject}${i >= SUBJECTS.length * FORMS.length ? ` (${Math.floor(i / (SUBJECTS.length * FORMS.length)) + 1})` : ""}`;
    const slug = slugOf(title);
    const year = 2025 - Math.floor(i / 24);
    const month = 12 - (i % 12);
    const date = `${year}-${pad(month)}-${pad(1 + (i % 27))}T09:30:00`;
    const folder = `${year}/${pad(month)}`;
    const author = AUTHORS[i % AUTHORS.length]!;
    const category = CATEGORIES[i % 4]!;
    const tagIds = [TAGS[i % TAGS.length]!.id, TAGS[(i * 3 + 1) % TAGS.length]!.id].filter((value, at, all) => all.indexOf(value) === at);
    const featured = image(folder, `${slug}-cover`, `${subject[0]!.toUpperCase()}${subject.slice(1)}, planted`, id);
    const inline = i % 3 === 0 ? image(folder, `${slug}-detail`, `A closer look at ${subject}`, id) : null;
    const link = `${SITE}/${year}/${pad(month)}/${slug}/`;
    const description = `${form} ${subject}: what grows, what to avoid, and the jobs that keep it looking right through the year.`;
    // Like real sites, a few posts never got an SEO description or an excerpt.
    const bare = i % 7 === 3;
    const paragraphs = [
      `<p>Most people ask us about ${subject} in the spring, when the gaps are obvious. The answer usually starts with the soil and the light, not the plants.</p>`,
      `<h2>Start with what you have</h2>`,
      `<p>Spend a week noticing where the sun falls and where water sits after rain. Write it down; it decides more than any planting list.</p>`,
      inline ? `<figure class="wp-block-image size-large"><img src="${inline.source_url}" alt="${inline.alt_text}" class="wp-image-${inline.id}"/></figure>` : "",
      `<ul><li>Dig a test hole and fill it with water.</li><li>Check the pH with a cheap kit.</li><li>Note which weeds thrive — they tell you a lot.</li></ul>`,
      i % 5 === 0 && i > 0 ? `<p>We wrote about this before in <a href="${posts[i - 1]!.link as string}">${(posts[i - 1]!.title as { rendered: string }).rendered}</a>.</p>` : "",
      `<p>If you would like a second pair of eyes, our <a href="${SITE}/garden-design/">garden design</a> visits start in March.</p>`,
      // A plugin that has since been switched off leaves its shortcode in the text.
      i % 9 === 4 ? `<p>[seasonal_planner month="${month}"]</p>` : "",
    ].filter(Boolean);

    posts.push({
      id,
      date,
      date_gmt: date,
      modified: date,
      modified_gmt: date,
      slug,
      status: "publish",
      type: "post",
      link,
      title: { rendered: title },
      content: { rendered: paragraphs.join("\n"), protected: false },
      excerpt: { rendered: bare ? `<p>Most people ask us about ${subject} in the spring, when the gaps are obvious. [&hellip;]</p>\n` : `<p>${description}</p>\n`, protected: false },
      author: author.id,
      featured_media: featured.id,
      comment_status: "open",
      sticky: false,
      template: "",
      categories: [category.id],
      tags: tagIds,
      yoast_head_json: bare ? { title: `${title} – ${TITLE}`, robots: { index: "index", follow: "follow" } } : yoast(title, description, link),
      _embedded: {
        author: [{ id: author.id, name: author.name, slug: author.slug, link: `${SITE}/author/${author.slug}/` }],
        "wp:featuredmedia": [featured],
        "wp:term": [[{ ...category, taxonomy: "category", link: `${SITE}/category/${category.slug}/` }], tagIds.map((tag) => ({ ...TAGS.find((t) => t.id === tag)!, taxonomy: "post_tag", link: `${SITE}/tag/${TAGS.find((t) => t.id === tag)!.slug}/` }))],
      },
    });
  }

  const PAGE_NAMES = ["Garden design", "Planting plans", "Workshops", "Services", "Our approach", "Visit the studio", "Meet the team", "Questions", "Gift vouchers", "Accessibility", "Privacy policy", "Terms of booking", "Press", "Careers"];
  const pages: Json[] = [];

  for (let i = 0; i < pageCount; i += 1) {
    const id = 2000 + i;
    const title = PAGE_NAMES[i % PAGE_NAMES.length]!;
    const slug = slugOf(title);
    const date = `2024-${pad(1 + (i % 12))}-05T10:00:00`;
    const link = `${SITE}/${slug}/`;
    const built = i < elementorCount;
    const hero = built ? image(`2024/${pad(1 + (i % 12))}`, `${slug}-hero`, `${title} at the studio`, id) : null;
    const html = built ? elementorPage(title, hero!.source_url as string, i) : `<p>${title} at ${TITLE}.</p>\n<p>We're a small studio in the valley. Write to us any time and we'll answer within two working days.</p>`;

    pages.push({
      id,
      date,
      date_gmt: date,
      modified_gmt: date,
      slug,
      status: "publish",
      type: "page",
      link,
      title: { rendered: title },
      content: { rendered: html, protected: false },
      excerpt: { rendered: "", protected: false },
      author: 1,
      featured_media: 0,
      parent: 0,
      menu_order: i,
      template: built ? "elementor_header_footer" : "",
      yoast_head_json: yoast(title, `${title}: how ${TITLE} works, and how to get in touch.`, link),
      _embedded: { author: [{ id: 1, name: AUTHORS[0]!.name, slug: AUTHORS[0]!.slug }] },
    });
  }

  return {
    title: TITLE,
    posts,
    pages,
    media,
    categories: CATEGORIES.map((category) => ({ ...category, parent: 0, taxonomy: "category", link: `${SITE}/category/${category.slug}/` })),
    tags: TAGS.map((tag) => ({ ...tag, taxonomy: "post_tag", link: `${SITE}/tag/${tag.slug}/` })),
    users: AUTHORS,
    files,
  };
}

const widget = (type: string, inner: string) =>
  `<div class="elementor-element elementor-widget elementor-widget-${type.split(".")[0]}" data-element_type="widget" data-widget_type="${type}"><div class="elementor-widget-container">${inner}</div></div>`;
const column = (width: number, inner: string) => `<div class="elementor-column elementor-col-${width} elementor-top-column elementor-element" data-element_type="column"><div class="elementor-widget-wrap elementor-element-populated">${inner}</div></div>`;
const section = (inner: string, id?: string) =>
  `<section class="elementor-section elementor-top-section elementor-element elementor-section-boxed" data-element_type="section"${id ? ` id="${id}"` : ""}><div class="elementor-container elementor-column-gap-default">${inner}</div></section>`;

/** What Elementor renders for a page: a hero, three icon boxes, a quote and questions with answers. */
function elementorPage(title: string, heroImage: string, seed: number): string {
  const boxes = [
    ["Survey", "We measure the garden, test the soil and photograph it through a day."],
    ["Plan", "A scaled plan with a planting list you can follow season by season."],
    ["Plant", "Our team plants it with you, or hands over a schedule to do it yourself."],
  ];

  return [
    `<div data-elementor-type="wp-page" data-elementor-id="${2000 + seed}" class="elementor elementor-${2000 + seed}">`,
    section(
      column(
        100,
        widget("heading.default", `<h1 class="elementor-heading-title">${title} for gardens that look after themselves</h1>`) +
          widget("text-editor.default", `<p>From a single border to a whole plot, we design gardens around the soil and light you already have.</p>`) +
          widget("image.default", `<img src="${heroImage}" alt="${title} at the studio">`) +
          widget("button.default", `<div class="elementor-button-wrapper"><a class="elementor-button" href="{{SITE}}/visit-the-studio/"><span class="elementor-button-text">Book a visit</span></a></div>`)
      ),
      "intro"
    ),
    section(
      boxes
        .map(([heading, text]) =>
          column(33, widget("icon-box.default", `<div class="elementor-icon-box-wrapper"><div class="elementor-icon-box-icon"><span class="elementor-icon"><i class="fas fa-leaf"></i></span></div><div class="elementor-icon-box-content"><h3 class="elementor-icon-box-title"><span>${heading}</span></h3><p class="elementor-icon-box-description">${text}</p></div></div>`))
        )
        .join("")
    ),
    section(
      column(
        100,
        widget(
          "testimonial.default",
          `<div class="elementor-testimonial-wrapper"><div class="elementor-testimonial-content">They turned a muddy rectangle into the place we eat every summer evening.</div><div class="elementor-testimonial-meta"><div class="elementor-testimonial-details"><div class="elementor-testimonial-name">Priya Lomas</div><div class="elementor-testimonial-job">Garden in the valley, 2024</div></div></div></div>`
        )
      )
    ),
    section(
      column(
        100,
        widget("heading.default", `<h2 class="elementor-heading-title">Questions people ask</h2>`) +
          widget(
            "accordion.default",
            `<div class="elementor-accordion"><div class="elementor-accordion-item"><div class="elementor-tab-title"><a class="elementor-accordion-title" href="">How long does a design take?</a></div><div class="elementor-tab-content"><p>Four to six weeks from the first visit.</p></div></div><div class="elementor-accordion-item"><div class="elementor-tab-title"><a class="elementor-accordion-title" href="">Do you work outside the valley?</a></div><div class="elementor-tab-content"><p>Within an hour's drive of the studio.</p></div></div></div>`
          )
      )
    ),
    "</div>",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────── the REST server

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Wait this long before answering each image request: slows an import down enough to stop it part-way. */
  mediaDelayMs?: number;
  /** Answer the REST API only to this "user:password" (an application password), as a locked-down site does. */
  credentials?: string;
}

export interface RunningFakeSite {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

export async function serveFakeSite(site: FakeSite, options: ServeOptions = {}): Promise<RunningFakeSite> {
  let origin = "";
  const requests: string[] = [];
  const fill = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll(SITE, origin)) as unknown;
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=UTF-8", ...headers });
    res.end(JSON.stringify(fill(body)));
  };
  const list = (res: ServerResponse, items: unknown[], query: URLSearchParams) => {
    const perPage = Math.min(Number(query.get("per_page") ?? 10), 100);
    const page = Number(query.get("page") ?? 1);
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));

    if (page > totalPages) return json(res, 400, { code: "rest_post_invalid_page_number" });
    json(res, 200, items.slice((page - 1) * perPage, page * perPage), { "X-WP-Total": String(items.length), "X-WP-TotalPages": String(totalPages) });
  };
  const included = (items: Json[], query: URLSearchParams) => {
    const ids = (query.get("include") ?? "").split(",").filter(Boolean).map(Number);

    return ids.length ? items.filter((item) => ids.includes(item.id as number)) : items;
  };

  function rest(route: string, query: URLSearchParams, req: IncomingMessage, res: ServerResponse) {
    if (options.credentials && route !== "/" && route !== "") {
      const signedIn = req.headers.authorization === `Basic ${Buffer.from(options.credentials).toString("base64")}`;

      if (req.headers.authorization && !signedIn) return json(res, 401, { code: "incorrect_password", message: "The provided password is an invalid application password." });
      if (!signedIn) return json(res, 401, { code: "rest_not_logged_in", message: "You are not currently logged in." });
    }
    switch (route) {
      case "/":
      case "":
        return json(res, 200, { name: site.title, description: "Garden design and planting in the valley", url: SITE, home: SITE, namespaces: ["oembed/1.0", "wp/v2", "yoast/v1", "elementor/v1"], routes: {} });
      case "/wp/v2/posts":
        return list(res, site.posts, query);
      case "/wp/v2/pages":
        return list(res, site.pages, query);
      case "/wp/v2/types":
        return json(res, 200, { post: { name: "Posts", slug: "post", rest_base: "posts" }, page: { name: "Pages", slug: "page", rest_base: "pages" }, attachment: { name: "Media", slug: "attachment", rest_base: "media" } });
      case "/wp/v2/media":
        return query.has("include") ? json(res, 200, included(site.media, query)) : list(res, site.media, query);
      case "/wp/v2/categories":
        return json(res, 200, included(site.categories, query));
      case "/wp/v2/tags":
        return json(res, 200, included(site.tags, query));
      case "/wp/v2/users":
        return json(res, 200, included(site.users, query));
      case "/wp/v2/comments":
        return json(res, 200, [], { "X-WP-Total": "37", "X-WP-TotalPages": "37" });
      default:
        return json(res, 404, { code: "rest_no_route", message: "No route was found matching the URL and request method." });
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);

    requests.push(`${url.pathname}${url.search}`);
    if (url.pathname.startsWith("/wp-content/uploads/")) {
      const file = site.files.get(url.pathname);
      const answer = () => {
        if (!file) {
          res.writeHead(404, { "content-type": "text/html" });
          return res.end("<h1>Not found</h1>");
        }
        res.writeHead(200, { "content-type": "image/png", "content-length": String(file.length) });
        res.end(file);
      };

      if (options.mediaDelayMs) setTimeout(answer, options.mediaDelayMs);
      else answer();
      return;
    }
    if (url.searchParams.has("rest_route")) return rest(url.searchParams.get("rest_route")!.replace(/\/+$/, "") || "/", url.searchParams, req, res);
    if (url.pathname.startsWith("/wp-json")) return rest(url.pathname.slice("/wp-json".length).replace(/\/+$/, "") || "/", url.searchParams, req, res);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=UTF-8", link: `<${origin}/wp-json/>; rel="https://api.w.org/"` });
      return res.end(`<!doctype html><html><head><title>${site.title}</title><link rel="https://api.w.org/" href="${origin}/wp-json/" /><link rel="stylesheet" href="${origin}/wp-content/themes/leaf/style.css"></head><body><h1>${site.title}</h1></body></html>`);
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>Not found</h1>");
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
  origin = `http://${options.host ?? "127.0.0.1"}:${(server.address() as AddressInfo).port}`;
  return { url: origin, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// ─────────────────────────────────────────────────────────── the export file

const cdata = (text: string) => `<![CDATA[${text.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
const meta = (key: string, value: string) => `\t\t<wp:postmeta><wp:meta_key>${cdata(key)}</wp:meta_key><wp:meta_value>${cdata(value)}</wp:meta_value></wp:postmeta>`;

/** The same site as WordPress's Tools › Export › All content would write it, addressed at `origin`. */
export function fakeSiteWxr(site: FakeSite, origin: string): string {
  const fill = (text: string) => text.replaceAll(SITE, origin);
  const when = (iso: string) => iso.replace("T", " ");
  const login = (id: number) => site.users.find((user) => user.id === id)?.slug as string;
  const item = (raw: Json, extra: string[], categories: string[] = []) => {
    const title = (raw.title as { rendered: string }).rendered;
    const content = fill((raw.content as { rendered: string } | undefined)?.rendered ?? "");

    return [
      "\t<item>",
      `\t\t<title>${cdata(title)}</title>`,
      `\t\t<link>${fill(String(raw.link))}</link>`,
      `\t\t<dc:creator>${cdata(login(Number(raw.author ?? 1)) ?? "ines")}</dc:creator>`,
      `\t\t<guid isPermaLink="false">${origin}/?p=${raw.id}</guid>`,
      `\t\t<content:encoded>${cdata(content)}</content:encoded>`,
      `\t\t<excerpt:encoded>${cdata("")}</excerpt:encoded>`,
      `\t\t<wp:post_id>${raw.id}</wp:post_id>`,
      `\t\t<wp:post_date>${cdata(when(String(raw.date)))}</wp:post_date>`,
      `\t\t<wp:post_date_gmt>${cdata(when(String(raw.date_gmt ?? raw.date)))}</wp:post_date_gmt>`,
      `\t\t<wp:post_name>${cdata(String(raw.slug))}</wp:post_name>`,
      `\t\t<wp:status>${cdata(String(raw.status ?? "publish"))}</wp:status>`,
      `\t\t<wp:post_parent>${Number(raw.parent ?? raw.post ?? 0)}</wp:post_parent>`,
      `\t\t<wp:menu_order>${Number(raw.menu_order ?? 0)}</wp:menu_order>`,
      `\t\t<wp:post_type>${cdata(String(raw.type))}</wp:post_type>`,
      `\t\t<wp:post_password>${cdata("")}</wp:post_password>`,
      ...categories,
      ...extra,
      "\t</item>",
    ].join("\n");
  };
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8" ?>`,
    `<!-- An invented WordPress export. Every name, place and word in it is made up. -->`,
    `<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">`,
    "<channel>",
    `\t<title>${site.title}</title>`,
    `\t<link>${origin}</link>`,
    `\t<description>Garden design and planting in the valley</description>`,
    `\t<language>en-GB</language>`,
    `\t<wp:wxr_version>1.2</wp:wxr_version>`,
    `\t<wp:base_site_url>${origin}</wp:base_site_url>`,
    `\t<wp:base_blog_url>${origin}</wp:base_blog_url>`,
    ...site.users.map((user) => `\t<wp:author><wp:author_id>${user.id}</wp:author_id><wp:author_login>${cdata(String(user.slug))}</wp:author_login><wp:author_display_name>${cdata(String(user.name))}</wp:author_display_name></wp:author>`),
    ...site.categories.map((category) => `\t<wp:category><wp:term_id>${category.id}</wp:term_id><wp:category_nicename>${cdata(String(category.slug))}</wp:category_nicename><wp:category_parent>${cdata("")}</wp:category_parent><wp:cat_name>${cdata(String(category.name))}</wp:cat_name></wp:category>`),
    ...site.tags.map((tag) => `\t<wp:tag><wp:term_id>${tag.id}</wp:term_id><wp:tag_slug>${cdata(String(tag.slug))}</wp:tag_slug><wp:tag_name>${cdata(String(tag.name))}</wp:tag_name></wp:tag>`),
  ];

  for (const media of site.media) {
    out.push(item({ ...media, status: "inherit", type: "attachment" }, [`\t\t<wp:attachment_url>${cdata(fill(String(media.source_url)))}</wp:attachment_url>`, meta("_wp_attachment_image_alt", String(media.alt_text))]));
  }
  for (const post of site.posts) {
    const seo = post.yoast_head_json as { title: string; description?: string };
    const categories = [
      ...(post.categories as number[]).map((id) => site.categories.find((c) => c.id === id)!).map((c) => `\t\t<category domain="category" nicename="${c.slug}">${cdata(String(c.name))}</category>`),
      ...(post.tags as number[]).map((id) => site.tags.find((t) => t.id === id)!).map((t) => `\t\t<category domain="post_tag" nicename="${t.slug}">${cdata(String(t.name))}</category>`),
    ];

    out.push(item(post, [meta("_thumbnail_id", String(post.featured_media)), meta("_yoast_wpseo_title", seo.title), ...(seo.description ? [meta("_yoast_wpseo_metadesc", seo.description)] : [])], categories));
  }
  for (const page of site.pages) {
    const seo = page.yoast_head_json as { title: string; description: string };
    const built = page.template === "elementor_header_footer";

    out.push(item(page, [meta("_yoast_wpseo_title", seo.title), meta("_yoast_wpseo_metadesc", seo.description), ...(built ? [meta("_elementor_edit_mode", "builder"), meta("_wp_page_template", "elementor_header_footer")] : [])]));
  }
  out.push("</channel>", "</rss>", "");
  return out.join("\n");
}

export function writeFakeSiteWxr(site: FakeSite, origin: string, path: string): void {
  writeFileSync(path, fakeSiteWxr(site, origin));
}
