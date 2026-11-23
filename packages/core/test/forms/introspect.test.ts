/**
 * Introspection against recorded-shape fixtures written from the vendors'
 * documentation (HubSpot's embed/v2 form JSON and v3 field groups; Marketo's
 * forms2.js descriptor). The error bodies are the ones both endpoints really
 * answer with (checked once by hand, 2026-11-23): HubSpot
 * `{"status":"error","message":"Form not found",…}` with 404, Marketo
 * `{"message":"Form error; subscription not found","error":true,"errorCode":"614"}` with 200.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hubspotFields, introspectForm, marketoFields } from "../../src/forms/introspect";
import { createGuardedFetch, type ResolvedAddress, type Transport } from "../../src/forms/net";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as unknown;

function fetcherFor(body: unknown, status = 200, table: Record<string, string[]> = { "forms.hsforms.com": ["104.16.0.1"], "forms-eu1.hsforms.com": ["104.16.0.2"], "go.example.com": ["93.184.216.34"] }) {
  const urls: string[] = [];
  const transport: Transport = async (url) => {
    urls.push(url.toString());
    return { status, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) };
  };
  const fetch = createGuardedFetch({
    resolve: async (host) => {
      const list = table[host];

      if (!list) throw new Error("ENOTFOUND");
      return list.map((address) => ({ address, family: 4 }) as ResolvedAddress);
    },
    transport,
  });

  return { fetch, urls };
}

const HUB = { portalId: "12345678", formId: "0f8fad5b-d9cb-469f-a165-70867728950e" };
const MKTO = { munchkinId: "123-abc-456", formId: "1234", host: "https://go.example.com" };

describe("HubSpot", () => {
  it("maps the embed form definition: groups, dependent fields, options, hidden, required", () => {
    expect(hubspotFields(fixture("hubspot-embed-v3.json"))).toEqual([
      { name: "firstname", label: "First name", type: "text", required: true },
      { name: "lastname", label: "Last name", type: "text" },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "company_size", label: "Company size", type: "select", options: [{ value: "1-10", label: "1–10" }, { value: "11-50", label: "11–50" }] },
      { name: "procurement_contact", label: "Procurement contact", type: "text" },
      { name: "message", label: "How can we help?", type: "textarea" },
      { name: "phone", label: "Phone number", type: "tel" },
      { name: "newsletter", label: "Send me the newsletter", type: "checkbox" },
      { name: "lead_source", label: "Lead source", type: "hidden" },
    ]);
  });

  it("maps the v3 fieldGroups shape too", () => {
    expect(hubspotFields(fixture("hubspot-v3-fieldgroups.json")).map((field) => [field.name, field.type, field.required ?? false])).toEqual([
      ["email", "email", true],
      ["industry", "select", false],
      ["interests", "checkboxes", false],
      ["consent", "checkbox", true],
      ["start", "date", false],
    ]);
  });

  it("asks the vendor's own host, by region", async () => {
    const na = fetcherFor(fixture("hubspot-embed-v3.json"));

    await introspectForm("hubspot", HUB, { fetch: na.fetch });
    expect(na.urls).toEqual([`https://forms.hsforms.com/embed/v3/form/${HUB.portalId}/${HUB.formId}/json`]);
    const eu = fetcherFor(fixture("hubspot-embed-v3.json"));

    await introspectForm("hubspot", { ...HUB, region: "eu1" }, { fetch: eu.fetch });
    expect(eu.urls[0]).toMatch(/^https:\/\/forms-eu1\.hsforms\.com\//);
  });

  it("says why in plain words: missing settings, not found, newer editor", async () => {
    const { fetch } = fetcherFor({});

    await expect(introspectForm("hubspot", { formId: HUB.formId }, { fetch })).rejects.toThrow(/Hub ID/);
    await expect(introspectForm("hubspot", { portalId: HUB.portalId, formId: "../../etc" }, { fetch })).rejects.toThrow(/form ID/);
    await expect(introspectForm("hubspot", { ...HUB, region: "evil.com/x" }, { fetch })).rejects.toThrow(/data region/);
    const missing = fetcherFor({ status: "error", message: "Form not found", correlationId: "x" }, 404);

    await expect(introspectForm("hubspot", HUB, { fetch: missing.fetch })).rejects.toThrow("HubSpot has no form with that ID in account 12345678.");
    const newer = fetcherFor({ status: "error", message: "You cannot fetch this type of form using this endpoint. Not an Embed version 2 or 3 form" }, 400);

    await expect(introspectForm("hubspot", HUB, { fetch: newer.fetch })).rejects.toThrow(/newer form editor/);
  });
});

describe("Marketo", () => {
  it("maps the forms2 descriptor: rows, fieldsets, picklists, single boxes, hidden; skips rich text", () => {
    expect(marketoFields(fixture("marketo-getform.json"))).toEqual([
      { name: "Email", type: "email", label: "Email Address", required: true },
      { name: "FirstName", type: "text", label: "First Name" },
      { name: "LastName", type: "text", label: "Last Name", required: true },
      { name: "Phone", type: "tel", label: "Phone Number" },
      { name: "Country", type: "select", label: "Country", required: true, options: [{ value: "USA", label: "United States" }, { value: "Canada", label: "Canada" }] },
      { name: "Comments__c", type: "textarea", label: "Comments" },
      { name: "OptIn", type: "checkbox", label: "Yes, send me updates" },
      { name: "Company", type: "text", label: "Company Name", required: true },
      { name: "Industry", type: "checkboxes", label: "Industry", options: [{ value: "Retail", label: "Retail" }, { value: "Education", label: "Education" }] },
      { name: "UTM_Source__c", type: "hidden" },
    ]);
  });

  it("asks the configured host's getForm, and reads a JSONP answer as well", async () => {
    const plain = fetcherFor(fixture("marketo-getform.json"));
    const result = await introspectForm("marketo", MKTO, { fetch: plain.fetch });

    expect(result.fields).toHaveLength(10);
    expect(plain.urls).toEqual(["https://go.example.com/index.php/form/getForm?munchkinId=123-ABC-456&form=1234"]);
    const jsonp = fetcherFor(`jQuery1234_5678(${JSON.stringify(fixture("marketo-getform.json"))});`);

    expect((await introspectForm("marketo", MKTO, { fetch: jsonp.fetch })).fields).toHaveLength(10);
  });

  it("refuses a host that resolves to a private address, and plain http", async () => {
    const internal = fetcherFor(fixture("marketo-getform.json"), 200, { "go.example.com": ["10.0.0.8"] });

    await expect(introspectForm("marketo", MKTO, { fetch: internal.fetch })).rejects.toThrow(/private or local network/);
    expect(internal.urls).toHaveLength(0);
    const http = fetcherFor(fixture("marketo-getform.json"));

    await expect(introspectForm("marketo", { ...MKTO, host: "http://go.example.com" }, { fetch: http.fetch })).rejects.toThrow(/secure/);
    await expect(introspectForm("marketo", { ...MKTO, host: "https://go.example.com:8080" }, { fetch: http.fetch })).rejects.toThrow(/port/);
    expect(http.urls).toHaveLength(0);
  });

  it("says why: unknown subscription, bad settings", async () => {
    const unknown = fetcherFor({ message: "Form error; subscription not found", error: true, errorCode: "614" });

    await expect(introspectForm("marketo", MKTO, { fetch: unknown.fetch })).rejects.toThrow("Marketo doesn't know Munchkin ID 123-ABC-456 at go.example.com. Check both.");
    await expect(introspectForm("marketo", { ...MKTO, munchkinId: "nope" }, { fetch: unknown.fetch })).rejects.toThrow(/Munchkin ID first/);
    await expect(introspectForm("marketo", { ...MKTO, host: "" }, { fetch: unknown.fetch })).rejects.toThrow(/address your Marketo forms/);
  });
});

describe("other providers", () => {
  it("are refused plainly", async () => {
    await expect(introspectForm("salesforce", {}, { fetch: fetcherFor({}).fetch })).rejects.toThrow("Fields can't be read from this kind of form. Add them here by hand.");
  });
});
