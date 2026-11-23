/**
 * A small in-process WordPress, enough to exercise the REST reader the way a
 * real site would: discovery through the Link header, pretty permalinks or
 * `?rest_route=`, paging with X-WP-TotalPages, `_embed`, a 429 with
 * Retry-After, application-password sign-in, and a mode where the API is
 * switched off as security plugins do.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CATEGORIES, COURSES, INDEX, PAGES, POSTS, TYPES } from "./fixtures/rest";

export interface FakeOptions {
  mode?: "pretty" | "plain" | "disabled";
  /** The most items per page the server returns, whatever is asked for. */
  maxPerPage?: number;
  /** REST routes that answer 429 the first time they are asked for. */
  rateLimitOnce?: string[];
  files?: Map<string, Uint8Array>;
  /** "user:password" accepted for application-password sign-in. */
  credentials?: string;
}

export interface FakeWordPress {
  url: string;
  requests: Array<{ path: string; userAgent: string; authorization: boolean }>;
  close(): Promise<void>;
}

const DRAFT = {
  id: 104,
  date: "2024-05-01T08:00:00",
  date_gmt: "2024-05-01T08:00:00",
  slug: "",
  status: "draft",
  type: "post",
  link: "{{SITE}}/?p=104",
  title: { rendered: "Notes for the summer open studio" },
  content: { rendered: "<p>Ideas for the open studio in July.</p>\n<p><img src=\"{{SITE}}/wp-content/uploads/2024/04/mugs-copy.png\" alt=\"Mugs again\"></p>", protected: false },
  excerpt: { rendered: "", protected: false },
  author: 1,
  featured_media: 0,
  categories: [],
  tags: [],
};

export async function startFakeWordPress(options: FakeOptions = {}): Promise<FakeWordPress> {
  const mode = options.mode ?? "pretty";
  const maxPerPage = options.maxPerPage ?? 100;
  const limited = new Set(options.rateLimitOnce ?? []);
  const requests: FakeWordPress["requests"] = [];
  let origin = "";
  const fill = (value: unknown) => JSON.parse(JSON.stringify(value).replaceAll("{{SITE}}", origin)) as unknown;

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=UTF-8", ...headers });
    res.end(JSON.stringify(fill(body)));
  };

  const list = (res: ServerResponse, items: unknown[], query: URLSearchParams) => {
    const perPage = Math.min(Number(query.get("per_page") ?? 10), maxPerPage);
    const page = Number(query.get("page") ?? 1);
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));

    if (page > totalPages) return json(res, 400, { code: "rest_post_invalid_page_number", message: "The page number requested is larger than the number of pages available." });
    json(res, 200, items.slice((page - 1) * perPage, page * perPage), { "X-WP-Total": String(items.length), "X-WP-TotalPages": String(totalPages) });
  };

  function rest(route: string, query: URLSearchParams, req: IncomingMessage, res: ServerResponse) {
    const signedIn = Boolean(options.credentials) && req.headers.authorization === `Basic ${Buffer.from(options.credentials!).toString("base64")}`;

    if (req.headers.authorization && !signedIn) return json(res, 401, { code: "incorrect_password", message: "The provided password is an invalid application password." });
    if (mode === "disabled") return json(res, 401, { code: "rest_cannot_access", message: "Only authenticated users can access the REST API.", data: { status: 401 } });
    if (limited.has(route)) {
      limited.delete(route);
      return json(res, 429, { code: "too_many_requests" }, { "Retry-After": "1" });
    }
    const include = (query.get("include") ?? "").split(",").filter(Boolean).map(Number);

    switch (route) {
      case "/":
      case "":
        return json(res, 200, INDEX);
      case "/wp/v2/posts": {
        if (query.has("status") && !signedIn) return json(res, 400, { code: "rest_invalid_param", message: "Invalid parameter(s): status" });
        return list(res, signedIn ? [DRAFT, ...POSTS] : POSTS, query);
      }
      case "/wp/v2/pages":
        if (query.has("status") && !signedIn) return json(res, 400, { code: "rest_invalid_param", message: "Invalid parameter(s): status" });
        return list(res, PAGES, query);
      case "/wp/v2/types":
        return json(res, 200, TYPES);
      case "/wp/v2/courses":
        return list(res, COURSES, query);
      case "/wp/v2/categories":
        return json(res, 200, CATEGORIES.filter((category) => !include.length || include.includes(category.id as number)));
      case "/wp/v2/tags":
        return json(res, 200, []);
      case "/wp/v2/media":
        return json(res, 200, [], { "X-WP-Total": "0", "X-WP-TotalPages": "1" });
      case "/wp/v2/users":
        return json(res, 401, { code: "rest_user_cannot_view", message: "Sorry, you are not allowed to list users." });
      case "/wp/v2/comments":
        return json(res, 200, [], { "X-WP-Total": "4", "X-WP-TotalPages": "4" });
      default:
        return json(res, 404, { code: "rest_no_route", message: "No route was found matching the URL and request method." });
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", origin);

    requests.push({ path: `${url.pathname}${url.search}`, userAgent: String(req.headers["user-agent"] ?? ""), authorization: Boolean(req.headers.authorization) });
    const file = options.files?.get(url.pathname);

    if (url.pathname.startsWith("/wp-content/uploads/")) {
      if (!file) {
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<h1>Not found</h1>");
      }
      const type = url.pathname.endsWith(".png") ? "image/png" : url.pathname.endsWith(".pdf") ? "application/pdf" : url.pathname.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";

      res.writeHead(200, { "content-type": type, "content-length": String(file.length) });
      return res.end(file);
    }
    if (url.searchParams.has("rest_route")) {
      if (mode === "pretty" || mode === "plain" || mode === "disabled") return rest(url.searchParams.get("rest_route")!.replace(/\/+$/, "") || "/", url.searchParams, req, res);
    }
    if (url.pathname.startsWith("/wp-json")) {
      if (mode === "plain") {
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<h1>Not found</h1>");
      }
      return rest(url.pathname.slice("/wp-json".length).replace(/\/+$/, "") || "/", url.searchParams, req, res);
    }
    if (url.pathname === "/") {
      const api = mode === "plain" ? `${origin}/?rest_route=/` : `${origin}/wp-json/`;
      const headers: Record<string, string> = { "content-type": "text/html; charset=UTF-8" };

      if (mode !== "disabled") headers.link = `<${api}>; rel="https://api.w.org/"`;
      res.writeHead(200, headers);
      return res.end(`<!doctype html><html><head><title>Quillfield Pottery</title>${mode === "disabled" ? "" : `<link rel="https://api.w.org/" href="${api}" />`}<link rel="stylesheet" href="${origin}/wp-content/themes/clay/style.css"></head><body><h1>Quillfield Pottery</h1></body></html>`);
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>Not found</h1>");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: origin,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
