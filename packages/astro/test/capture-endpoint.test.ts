// @vitest-environment happy-dom
// @vitest-environment-options { "url": "http://www.example.com/demo/" }
// The Galley capture endpoint submitter against a small fake server speaking
// the contract in docs/forms.md, through the window's real fetch (with CORS).
// The page is http here only because the fake server is: browsers block an
// https page from posting to http.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FormDestination, FormField } from "../src/kit";
import type { SubmitContext } from "../src/client/types";
import { payloadFor } from "../src/forms/logic.js";
import { submit as galley } from "../src/client/providers/galley.js";

const fields: FormField[] = [
  { id: "first", type: "text", label: "First name" },
  { id: "email", type: "email", label: "Email" },
  { id: "interests", type: "checkboxes", label: "Interests", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
];
const answers = { first: "Kim", email: "kim@example.com", interests: ["a", "b"] };

async function run(destination: FormDestination) {
  const form = document.createElement("form");

  document.body.append(form);
  const { values, items } = payloadFor(destination, fields, answers);
  const context: SubmitContext = {
    formId: "demo",
    form,
    fields,
    answers,
    items,
    page: { url: "http://www.example.com/demo/", title: "Book a demo", referrer: "" },
    meta: { elapsedMs: 4200, honeypot: "", locale: "en-GB", kit: "0.1.0" },
    messages: {},
  };

  return galley(values, destination, context);
}

// ── The capture endpoint, against a small fake server ────────────────────
describe("galley (capture endpoint)", () => {
  let server: Server;
  let base = "";
  const seen: Array<{ method: string; headers: IncomingMessage["headers"]; body: string }> = [];
  let status = 200;
  let payload: unknown = { ok: true, id: "sub_123" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";

      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", headers: req.headers, body });
        res.setHeader("access-control-allow-origin", "http://www.example.com");
        res.setHeader("access-control-allow-headers", "content-type, accept");
        res.setHeader("access-control-allow-methods", "POST");
        res.setHeader("access-control-expose-headers", "Retry-After");
        if (status === 429) res.setHeader("retry-after", "30");
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((done) => server.listen(4931, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  beforeEach(() => {
    seen.length = 0;
    status = 200;
    payload = { ok: true, id: "sub_123" };
  });

  const destination = (): FormDestination => ({ provider: "galley", settings: { endpoint: `${base}/f/site_1` } });

  it("POSTs { form, values, page, meta } as JSON and reads { ok: true, id }", async () => {
    const result = await run(destination());

    expect(result, JSON.stringify(result)).toEqual({ ok: true, detail: "Stored as sub_123." });
    const post = seen.find((request) => request.method === "POST")!;

    expect(post.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(post.body)).toEqual({
      form: "demo",
      values: { first: "Kim", email: "kim@example.com", interests: ["a", "b"] },
      page: { url: "http://www.example.com/demo/", title: "Book a demo", referrer: "" },
      meta: { elapsedMs: 4200, honeypot: "", locale: "en-GB", kit: "0.1.0" },
    });
  });

  it("reads 422 { ok: false, errors, message }, 429 with Retry-After, 403 and 404", async () => {
    status = 422;
    payload = { ok: false, errors: { email: "That address can't receive mail." }, message: "Check the marked answers." };
    expect(await run(destination())).toMatchObject({ ok: false, errors: { email: "That address can't receive mail." }, message: "Check the marked answers." });
    status = 429;
    payload = { ok: false, message: "Too many submissions in a short time." };
    expect(await run(destination())).toMatchObject({ ok: false, retry: true, retryAfter: 30 });
    status = 403;
    payload = { ok: false };
    expect(await run(destination())).toMatchObject({ ok: false });
    status = 404;
    payload = { ok: false, message: "This form isn't taking submissions here." };
    expect(await run(destination())).toMatchObject({ ok: false, notConnected: true });
  });

  it("is not connected without an address", async () => {
    expect(await run({ provider: "galley", settings: {} })).toMatchObject({ ok: false, notConnected: true });
  });
});
