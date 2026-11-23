/**
 * Two small sites for the visibility tests, written to real temporary git
 * repositories: a clean one that must produce no findings at all (false
 * positives are the real enemy), and the same site with problems planted.
 * Each comes with rendered pages in dist/, written by hand the way a static
 * build would, so the rendered checks run without a framework install.
 */
import { pngHeader, sh, tempDir, writeTree } from "../workspace/helpers";

export const SITE_URL = "https://harbour-bakery.test";
const NAME = "Harbour Bakery";

const CONFIG = `import { defineConfig } from "astro/config";

export default defineConfig({ site: "${SITE_URL}", trailingSlash: "always" });
`;

const CONTENT_CONFIG = `import { defineCollection, z } from "astro:content";
import { file, glob } from "astro/loaders";

const section = z.object({ type: z.string() }).passthrough();

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    image: z.string().optional(),
    noindex: z.boolean().default(false),
    sections: z.array(section).default([]),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    author: z.string(),
    image: z.string(),
    imageAlt: z.string().optional(),
  }),
});

const events = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/events" }),
  schema: z.object({ title: z.string(), description: z.string(), date: z.coerce.date() }),
});

const navigation = defineCollection({
  loader: file("src/data/navigation.json"),
  schema: z.object({ id: z.string(), label: z.string(), href: z.string() }),
});

export const collections = { pages, blog, events, navigation };
`;

const GALLEY = {
  name: NAME,
  media: { dir: "public/images", publicPath: "/images" },
  collections: [
    { id: "pages", url: "/{slug}/" },
    { id: "blog", label: "Journal", singular: "post", url: "/blog/{slug}/" },
    { id: "events", label: "Events", singular: "event", url: "/events/{slug}/" },
  ],
};

const HOME_TEXT =
  "Harbour Bakery is a small bakery on the quay in Portwenn, baking sourdough, morning buns and seasonal cakes for the town and the boats that stop here. We open early, bake everything on the premises and sell out most days, so come before noon if you can. Orders for birthdays and weddings are taken in person or by email.";
const ABOUT_TEXT =
  "The bakery started in a converted net loft, with one oven and a starter that had travelled from a family kitchen inland. Today four of us share the early shifts: two bakers, one pastry cook and someone at the counter who knows every regular by name. We buy flour from a mill twenty miles up the valley and butter from a dairy on the hill, and we change the cake list with the seasons.";
const CONTACT_TEXT =
  "You will find us on the harbour front, between the chandlery and the lifeboat station, in the building with the blue door. Call in for bread, or write to us about cakes for a celebration and we will reply within two working days. There is a bench outside for coffee in the sun, and dogs are always welcome at the hatch.";
const POST_A =
  "A good loaf starts the day before. We mix the dough in the late afternoon, let it rise slowly overnight in the cool room and shape it before dawn. The long rest gives the crumb its open texture and the crust its colour, and it makes the bread keep for days. Here is how the timetable works in a small kitchen, and what changes when the weather turns warm and the dough moves faster than the bakers do.";
const POST_B =
  "Every autumn we bake with apples from the orchard behind the church, and every autumn somebody asks for the recipe. This year we wrote it down: a buttery base, apples sliced thin and laid in rings, a little brown sugar and a long bake until the edges caramelise. It is the cake we make most in October, and the one regulars ask after when the first cold morning arrives on the quay.";
const EVENT_TEXT =
  "Bring your own starter or borrow ours for the afternoon. We will mix, fold and shape loaves together in the bakery after closing, and you will take home a dough to bake in your own oven the next morning. Places are limited to eight people so everyone has room at the bench, and aprons are provided for the session. Tea and a slice of cake are included.";

/** A dynamic route the way an Astro site writes one, so the engine can tell which collection it renders. */
function route(collection: string, params: string): string {
  return `---\nimport { getCollection } from "astro:content";\n\nexport async function getStaticPaths() {\n  const pages = await getCollection("${collection}");\n  return pages.map((page) => ({ params: { ${params} }, props: { page } }));\n}\n---\n`;
}

function page(front: string, body = ""): string {
  return `---\n${front.trim()}\n---\n${body ? `\n${body}\n` : ""}`;
}

export function cleanFiles(): Record<string, string | Uint8Array> {
  return {
    "package.json": JSON.stringify({ name: "harbour-bakery", private: true, type: "module", scripts: { dev: "astro dev", build: "astro build" }, dependencies: { astro: "^7.4.0" } }, null, 2),
    "astro.config.mjs": CONFIG,
    "src/content.config.ts": CONTENT_CONFIG,
    "galley.config.json": `${JSON.stringify(GALLEY, null, 2)}\n`,
    ".gitignore": "dist/\nnode_modules/\n",
    "src/pages/[...slug].astro": route("pages", "slug: page.id === \"index\" ? undefined : page.id"),
    "src/pages/blog/index.astro": "---\n// The journal: every post, newest first.\n---\n",
    "src/pages/blog/[slug].astro": route("blog", "slug: page.id"),
    "src/pages/events/[slug].astro": route("events", "slug: page.id"),
    "public/robots.txt": `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
    "public/images/loaves.png": pngHeader(1200, 800),
    "public/images/apple-cake.png": pngHeader(1200, 800),
    "public/images/quay.png": pngHeader(1600, 900),
    "public/images/share.png": pngHeader(1200, 630),
    "src/data/navigation.json": `${JSON.stringify(
      [
        { id: "about", label: "About the bakery", href: "/about/" },
        { id: "journal", label: "Journal", href: "/blog/" },
        { id: "contact", label: "Visit us", href: "/contact/" },
      ],
      null,
      2
    )}\n`,
    "src/content/pages/index.md": page(
      `title: Harbour Bakery — bread and cakes on the quay in Portwenn
description: A small bakery on the quay in Portwenn baking sourdough, morning buns and seasonal cakes. Open early, closed on Mondays.
image: /images/quay.png
sections:
  - type: hero
    heading: Bread and cakes on the quay
    text: ${HOME_TEXT}
    image: /images/quay.png
    imageAlt: The bakery's blue door on the harbour front at sunrise`
    ),
    "src/content/pages/about.md": page(
      `title: About the bakery
description: How a converted net loft with one oven became the bakery four of us run today, and where our flour and butter come from.
image: /images/loaves.png`,
      `${ABOUT_TEXT}\n\nRead [the journal](/blog/) for what we are baking this month.`
    ),
    "src/content/pages/contact.md": page(
      `title: Visit us
description: Where to find the bakery on the harbour front, and how to order cakes for birthdays and weddings.
image: /images/quay.png`,
      `${CONTACT_TEXT}\n\nThe [story of the bakery](/about/) is on its own page.`
    ),
    "src/content/blog/overnight-dough.md": page(
      `title: Why our dough rests overnight
description: The slow overnight rise behind our sourdough's open crumb and dark crust, and what changes in warm weather.
date: 2026-09-12
author: Tamsin Hale
image: /images/loaves.png
imageAlt: Three sourdough loaves cooling on a wire rack`,
      POST_A
    ),
    "src/content/blog/apple-cake.md": page(
      `title: The October apple cake
description: The apple cake regulars ask for every autumn, made with fruit from the orchard behind the church. The recipe, written down at last.
date: 2026-10-03
author: Tamsin Hale
image: /images/apple-cake.png
imageAlt: A round apple cake with caramelised edges on a blue plate`,
      POST_B
    ),
    "src/content/events/sourdough-afternoon.md": page(
      `title: A sourdough afternoon at the bakery
description: Mix, fold and shape a loaf with our bakers after closing, then bake it at home the next morning. Eight places.
date: 2027-03-14`,
      EVENT_TEXT
    ),
  };
}

// ─────────────────────────────────────────────── rendered pages (dist/)

interface Rendered {
  path: string;
  title: string;
  description: string;
  h1: string;
  text: string;
  image: string;
  imageAlt: string;
  jsonld: unknown[];
  noindex?: boolean;
  links?: Array<{ href: string; text: string }>;
  /** A redirect page (<meta http-equiv="refresh">), as static hosts write them. */
  redirect?: string;
  /** No markdown link in its head. */
  noTwin?: boolean;
}

/** The kit's twin address: /about/ → /about.md, the home page → /index.md. */
export function kitTwin(path: string): string {
  return path === "/" ? "/index.md" : `${path.replace(/\/$/, "")}.md`;
}

function html(p: Rendered, twin = `${p.path}index.md`): string {
  if (p.redirect) return `<!doctype html><title>Redirecting to: ${p.redirect}</title><meta http-equiv="refresh" content="0;url=${p.redirect}"><meta name="robots" content="noindex"><link rel="canonical" href="${SITE_URL}${p.redirect}"><body><a href="${p.redirect}">${p.redirect}</a></body>`;
  const nav = `<nav><a href="/">${NAME}</a> <a href="/about/">About the bakery</a> <a href="/blog/">Journal</a> <a href="/contact/">Visit us</a></nav>`;
  const links = (p.links ?? []).map((link) => `<p><a href="${link.href}">${link.text}</a></p>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${p.title}</title><meta name="description" content="${p.description}">${p.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE_URL}${p.path}">`}<meta property="og:site_name" content="${NAME}"><meta property="og:image" content="${SITE_URL}${p.image}">${p.noTwin ? "" : `<link rel="alternate" type="text/markdown" href="${twin}">`}${p.jsonld.map((data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`).join("")}</head><body>${nav}<main><h1>${p.h1}</h1><img src="${p.image}" alt="${p.imageAlt}" width="1200" height="800"><p>${p.text}</p>${links}</main></body></html>`;
}

function crumbs(path: string, title: string): unknown {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Journal", item: `${SITE_URL}/blog/` }, { "@type": "ListItem", position: 2, name: title, item: `${SITE_URL}${path}` }] };
}

export function cleanRendered(): Rendered[] {
  return [
    {
      path: "/",
      title: "Harbour Bakery — bread and cakes on the quay in Portwenn",
      description: "A small bakery on the quay in Portwenn baking sourdough, morning buns and seasonal cakes. Open early, closed on Mondays.",
      h1: "Bread and cakes on the quay",
      text: HOME_TEXT,
      image: "/images/quay.png",
      imageAlt: "The bakery's blue door on the harbour front at sunrise",
      jsonld: [
        { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: `${SITE_URL}/` },
        { "@context": "https://schema.org", "@type": "Organization", name: NAME, url: `${SITE_URL}/` },
      ],
      links: [{ href: "/events/sourdough-afternoon/", text: "A sourdough afternoon" }],
    },
    { path: "/about/", title: "About the bakery · Harbour Bakery", description: "How a converted net loft with one oven became the bakery four of us run today, and where our flour and butter come from.", h1: "About the bakery", text: ABOUT_TEXT, image: "/images/loaves.png", imageAlt: "Three sourdough loaves cooling on a wire rack", jsonld: [], links: [{ href: "/blog/", text: "the journal" }] },
    { path: "/contact/", title: "Visit us · Harbour Bakery", description: "Where to find the bakery on the harbour front, and how to order cakes for birthdays and weddings.", h1: "Visit us", text: CONTACT_TEXT, image: "/images/quay.png", imageAlt: "The bakery's blue door on the harbour front at sunrise", jsonld: [], links: [{ href: "/about/", text: "story of the bakery" }] },
    {
      path: "/blog/",
      title: "Journal · Harbour Bakery",
      description: "Notes from the bakery: how we bake, what is in season, and the recipes regulars ask for most often.",
      h1: "Journal",
      text: `${POST_A.slice(0, 200)} ${POST_B.slice(0, 200)}`,
      image: "/images/loaves.png",
      imageAlt: "Three sourdough loaves cooling on a wire rack",
      jsonld: [],
      links: [
        { href: "/blog/overnight-dough/", text: "Why our dough rests overnight" },
        { href: "/blog/apple-cake/", text: "The October apple cake" },
      ],
    },
    {
      path: "/blog/overnight-dough/",
      title: "Why our dough rests overnight · Harbour Bakery",
      description: "The slow overnight rise behind our sourdough's open crumb and dark crust, and what changes in warm weather.",
      h1: "Why our dough rests overnight",
      text: POST_A,
      image: "/images/loaves.png",
      imageAlt: "Three sourdough loaves cooling on a wire rack",
      jsonld: [{ "@context": "https://schema.org", "@type": "BlogPosting", headline: "Why our dough rests overnight", datePublished: "2026-09-12", author: { "@type": "Person", name: "Tamsin Hale" } }, crumbs("/blog/overnight-dough/", "Why our dough rests overnight")],
    },
    {
      path: "/blog/apple-cake/",
      title: "The October apple cake · Harbour Bakery",
      description: "The apple cake regulars ask for every autumn, made with fruit from the orchard behind the church. The recipe, written down at last.",
      h1: "The October apple cake",
      text: POST_B,
      image: "/images/apple-cake.png",
      imageAlt: "A round apple cake with caramelised edges on a blue plate",
      jsonld: [{ "@context": "https://schema.org", "@type": "BlogPosting", headline: "The October apple cake", datePublished: "2026-10-03", author: { "@type": "Person", name: "Tamsin Hale" } }, crumbs("/blog/apple-cake/", "The October apple cake")],
    },
    {
      path: "/events/sourdough-afternoon/",
      title: "A sourdough afternoon at the bakery · Harbour Bakery",
      description: "Mix, fold and shape a loaf with our bakers after closing, then bake it at home the next morning. Eight places.",
      h1: "A sourdough afternoon at the bakery",
      text: EVENT_TEXT,
      image: "/images/quay.png",
      imageAlt: "The bakery's blue door on the harbour front at sunrise",
      jsonld: [
        { "@context": "https://schema.org", "@type": "Event", name: "A sourdough afternoon at the bakery", startDate: "2027-03-14T15:00", location: { "@type": "Place", name: NAME, address: "The Quay, Portwenn" } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` }, { "@type": "ListItem", position: 2, name: "A sourdough afternoon" }] },
      ],
    },
  ];
}

/**
 * `kit`: the site kit's layout — twins at /about.md and /index.md, llms.txt
 * with an Optional section, llms-full.txt and agent.md. `base`: a sub-path
 * build (every address in the pages carries it; the folder doesn't).
 */
export function distFiles(pages: Rendered[], extra: Record<string, string | Uint8Array> = {}, options: { kit?: boolean; base?: string } = {}): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = {};
  const twinOf = (path: string) => (options.kit ? kitTwin(path) : `${path}index.md`);

  for (const p of pages) {
    files[`dist${p.path}index.html`] = html(p, twinOf(p.path));
    if (!p.redirect && !p.noTwin && !p.noindex) files[`dist${twinOf(p.path)}`] = `---\ntitle: ${JSON.stringify(p.h1)}\n---\n\n# ${p.h1}\n\n${p.text}\n`;
  }
  if (options.kit) {
    const listed = pages.filter((p) => !p.redirect && !p.noindex && !p.noTwin);

    files["dist/llms.txt"] = `# ${NAME}\n\n> A small bakery on the quay in Portwenn.\n\nEvery page below links to its markdown version.\n\n## Pages\n\n${listed.filter((p) => p.path !== "/contact/").map((p) => `- [${p.h1}](${SITE_URL}${twinOf(p.path)}): ${p.description}`).join("\n")}\n\n## Optional\n\n- [Visit us](${SITE_URL}/contact.md)\n`;
    files["dist/llms-full.txt"] = `# ${NAME}\n\n${listed.map((p) => `---\nSource: ${SITE_URL}${p.path}\n\n${p.text}`).join("\n\n")}\n`;
    files["dist/agent.md"] = `# ${NAME} — for AI agents\n\n## Where things are\n\n- /llms.txt\n`;
  }
  files["dist/robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  files["dist/sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter((p) => !p.noindex).map((p) => `  <url><loc>${SITE_URL}${p.path}</loc></url>`).join("\n")}\n</urlset>\n`;
  files["dist/llms.txt"] ??= `# ${NAME}\n\n> A small bakery on the quay in Portwenn.\n\n## Pages\n\n${pages.map((p) => `- [${p.h1}](${SITE_URL}${p.path}index.md)`).join("\n")}\n`;
  for (const name of ["loaves.png", "apple-cake.png", "quay.png", "share.png"]) files[`dist/images/${name}`] = pngHeader(1200, 800);
  const base = options.base;

  if (!base) return { ...files, ...extra };
  // Every address the pages and site files state gains the base; the files stay where they are.
  const rebased: Record<string, string | Uint8Array> = {};

  for (const [name, content] of Object.entries({ ...files, ...extra })) {
    rebased[name] = typeof content !== "string" ? content : content.replaceAll(`${SITE_URL}/`, `${SITE_URL}${base}/`).replace(/(href|src|content)="\/(?!\/)/g, `$1="${base}/`).replace(/url=\//g, `url=${base}/`);
  }
  return rebased;
}

export function makeFixture(files: Record<string, string | Uint8Array>, dist?: Record<string, string | Uint8Array>): string {
  const root = tempDir("seo-site-");

  writeTree(root, files);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "First version");
  if (dist) writeTree(root, dist);
  return root;
}

/** The clean site with ten-plus real problems planted, each a small change to one file. */
export function plantedFiles(): Record<string, string | Uint8Array> {
  const files = cleanFiles();
  const edit = (path: string, find: string, replace: string) => {
    const text = String(files[path]);

    if (!text.includes(find)) throw new Error(`fixture: “${find}” not in ${path}`);
    files[path] = text.replace(find, replace);
  };

  // 1 duplicate title, 2 missing description, 3 placeholder text
  edit("src/content/pages/contact.md", "title: Visit us", "title: About the bakery");
  edit("src/content/pages/contact.md", "description: Where to find the bakery on the harbour front, and how to order cakes for birthdays and weddings.", 'description: ""');
  edit("src/content/pages/contact.md", "The [story of the bakery](/about/)", "Opening hours: [Add opening hours]. The [story of the bakery](/about)");
  // 4 noindex on the home page, 5 missing alt
  edit("src/content/pages/index.md", "image: /images/quay.png\nsections:", "image: /images/quay.png\nnoindex: true\nsections:");
  edit("src/content/pages/index.md", "    imageAlt: The bakery's blue door on the harbour front at sunrise", '    imageAlt: ""');
  // 6 a link to a page that moved (the redirect knows where), 7 vague link text
  edit("src/content/pages/about.md", "Read [the journal](/blog/)", "Our [menu](/old-menu/) has moved. [Click here](/blog/)");
  files["netlify.toml"] = '[[redirects]]\nfrom = "/old-menu/"\nto = "/contact/"\nstatus = 301\n';
  // 8 alt text that is a file name, 9 the site name twice in a title
  edit("src/content/blog/overnight-dough.md", "imageAlt: Three sourdough loaves cooling on a wire rack", "imageAlt: IMG_2041.jpg");
  edit("src/content/blog/apple-cake.md", "title: The October apple cake", "title: The October apple cake | Harbour Bakery");
  // 10 an orphan page, 11 a far-too-long title, 12 an event whose date has passed
  files["src/content/pages/allergens.md"] = page(
    `title: Allergens and ingredients in every loaf, bun and cake we bake at the bakery on the quay
description: Which of our breads and cakes contain nuts, dairy, eggs or seeds, and how we keep the gluten-free bakes apart in the kitchen.`,
    "Every loaf, bun and cake has a card by the counter listing what it contains. Ask at the hatch if you need to know more about any of them, and we will check the recipe book with you before you buy anything at all from the shelves."
  );
  edit("src/content/events/sourdough-afternoon.md", "date: 2027-03-14", "date: 2025-03-14");
  // 13 AI search crawler blocked (and training blocked, which is fine and reported plainly)
  files["public/robots.txt"] = `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  return files;
}

/** Rendered problems: a page without a main heading, an image without alt, a missing preferred address, broken structured data, a sitemap missing a page, an llms.txt without its heading. */
export function plantedRendered(): Record<string, string | Uint8Array> {
  const pages = cleanRendered();
  const about = pages.find((p) => p.path === "/about/")!;
  const contact = pages.find((p) => p.path === "/contact/")!;
  const files = distFiles(pages);

  files["dist/about/index.html"] = html(about).replace(/<h1>.*?<\/h1>/, "<h2>About the bakery</h2>").replace(`alt="${about.imageAlt}" `, "").replace(/<link rel="canonical"[^>]*>/, "");
  files["dist/contact/index.html"] = html(contact).replace("</head>", '<script type="application/ld+json">{"@type": "LocalBusiness", "name": </script></head>');
  files["dist/sitemap.xml"] = String(files["dist/sitemap.xml"]).replace(`  <url><loc>${SITE_URL}/contact/</loc></url>\n`, "");
  files["dist/llms.txt"] = "Harbour Bakery\n\nJust a list of pages.\n";
  files["dist/blog/apple-cake/index.html"] = String(files["dist/blog/apple-cake/index.html"]).replace("<title>The October apple cake · Harbour Bakery</title>", "<title>The October apple cake | Harbour Bakery · Harbour Bakery</title>");
  return files;
}
