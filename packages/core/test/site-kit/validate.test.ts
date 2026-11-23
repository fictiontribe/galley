/**
 * Kit files are recognised by evidence (the kit's schema in the content
 * config, or the files' own shape — never a folder's name), then described
 * and checked as what they are: a good form has no problems in Proof, and
 * real mistakes are said in the builder's words.
 */
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runSiteKitSetup, validateKitFile, wireContentConfig } from "../../src/site-kit/index";
import { detectSite } from "../../src/content/index";
import { disposeAll, openSite, sh, tempDir, writeTree } from "../site/helpers";

const FIXTURE = fileURLToPath(new URL("../fixtures/pre-kit-astro", import.meta.url));

function site(files: Record<string, string> = {}): string {
  const root = tempDir("kit-validate-");

  cpSync(FIXTURE, root, { recursive: true });
  writeTree(root, files);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Initial");
  return root;
}

/** The fixture's content config with the forms collection "Set it up for me" adds. */
function wired(): string {
  const result = wireContentConfig(readFileSync(join(FIXTURE, "src/content.config.ts"), "utf8"), "src/content.config.ts");

  if (result.state !== "edited") throw new Error("the fixture's content config should take the forms collection");
  return result.text;
}

const form = (extra: Record<string, unknown> = {}) =>
  `${JSON.stringify(
    {
      name: "Request a demo",
      submitLabel: "Request a demo",
      fields: [
        { id: "phone", type: "tel", label: "Phone" },
        { id: "email", type: "email", label: "Work email", required: true, validation: { businessEmailOnly: true } },
        { id: "size", type: "radio", label: "Team size", options: [{ value: "1", label: "Just me" }, { value: "10", label: "Ten or more" }] },
        { id: "more", type: "textarea", label: "Tell us more", showWhen: { field: "size", equals: "10" } },
      ],
      destinations: [{ provider: "galley", settings: {} }],
      afterSubmit: [{ type: "message", text: "Thanks." }],
      ...extra,
    },
    null,
    2,
  )}\n`;

afterEach(disposeAll);

describe("recognising kit files", () => {
  it("by the kit's schema in the content config, before the folder has any file", async () => {
    const root = site();
    const { site: service } = await openSite(root);

    await runSiteKitSetup(service, { build: false });
    await service.deleteEntry("src/content/forms/contact.json");
    const model = await detectSite(root);
    const forms = model.collections.find((collection) => collection.id === "forms");

    expect(forms?.kit).toBe("forms");
    expect(forms?.count).toBe(0);
    expect(forms?.fields.find((field) => field.key === "fields")?.label).toBe("Fields");
  }, 120_000);

  it("by the files' shape, whatever the folder is called — and not by the name alone", async () => {
    const root = site({
      // Both declared with the site's own schemas, not the kit's: only the files can say what they are.
      "src/content.config.ts": readFileSync(join(FIXTURE, "src/content.config.ts"), "utf8").replace(
        "export const collections = { pages, blog, team };",
        'const enquiries = defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/enquiries" }), schema: z.any() });\nconst forms = defineCollection({ loader: glob({ pattern: "*.json", base: "./src/content/forms" }) });\nexport const collections = { pages, blog, team, enquiries, forms };',
      ),
      "src/content/enquiries/demo.json": form(),
      "src/content/enquiries/callback.json": form({ name: "Call me back" }),
      "src/content/forms/a.json": `${JSON.stringify({ title: "Not a form", items: [1, 2] })}\n`,
      "src/content/forms/b.json": `${JSON.stringify({ title: "Nor this" })}\n`,
      "src/data/scripts.json": `${JSON.stringify({ scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-AB12CDE3" } }] })}\n`,
      "src/data/menu.json": `${JSON.stringify({ scripts: "not a list" })}\n`,
    });
    const model = await detectSite(root);
    const kit = Object.fromEntries(model.collections.filter((collection) => collection.kit).map((collection) => [collection.path, collection.kit]));

    expect(kit).toEqual({ "src/content/enquiries": "forms", "src/data/scripts.json": "scripts" });
  });
});

describe("Proof's problems for kit files", () => {
  it("a good form has none — no “section” or “required” guesses from inference", async () => {
    const root = site({
      "src/content.config.ts": wired(),
      "src/content/forms/demo.json": form(),
      "src/content/forms/contact.json": form({ name: "Contact" }),
    });
    const { site: service } = await openSite(root);

    writeTree(root, { "src/content/forms/demo.json": form({ submitLabel: "Book it" }) });
    expect(await service.validate(["src/content/forms/demo.json"])).toEqual([]);
  });

  it("says real mistakes in the builder's words", () => {
    const issues = validateKitFile(
      "forms",
      {
        name: "Demo",
        submitLabel: "Send",
        fields: [
          { id: "email", type: "email", label: "Work email", required: "yes" },
          { id: "email", type: "text", label: "Again" },
          { id: "more", type: "text", label: "Details", showWhen: { field: "topic", equals: "x" } },
          { id: "zip", type: "text", label: "ZIP", validation: { pattern: "(\\d+-?)+" } },
        ],
        destinations: [{ provider: "hubspot", settings: { formId: "0f8fad5b-d9cb-469f-a165-70867728950e" } }],
        afterSubmit: [{ type: "redirect", url: "" }, { type: "script", code: "x()" }],
      },
      "src/content/forms/demo.json",
    ).map((issue) => `${issue.severity}: ${issue.message}`);

    expect(issues).toEqual([
      "error: “Fields › Work email › Required” should be on or off (true or false).",
      "error: Fields › Again › Id: Two fields are called “email”. Each field needs its own id.",
      "error: Fields › Details › Show only when… › Field: “more” depends on “topic”, which isn't a field of this form.",
      "error: Destinations › HubSpot › Hub ID: HubSpot needs its hub id (settings.portalId).",
      "error: Fields › ZIP › Checks › Custom pattern: This pattern could be slow enough to stall the site's form; simplify it.",
      "error: After sending › Go to a page: it needs the address to go to.",
      "warning: After sending › Custom code: the site leaves this code out of its pages, because its site kit settings don't allow form code (forms.allowFormScripts).",
    ]);
  });

  it("names a script by its integration and a setting by the catalogue's label", () => {
    const issues = validateKitFile("scripts", { scripts: [{ id: "gtm", kind: "gtm", enabled: true, settings: { containerId: "GTM-12" } }] }, "src/data/scripts.json");

    expect(issues.map((issue) => issue.message)).toEqual(["Scripts › Google Tag Manager › Container ID: “GTM-12” doesn't look like a Google Tag Manager Container ID (it looks like GTM-XXXXXXX)."]);
    expect(issues[0]?.field).toEqual(["scripts", 0, "settings", "containerId"]);
  });

  it("knows when form code is allowed, and when a redirect goes nowhere", () => {
    const file = { name: "A", submitLabel: "Go", fields: [], destinations: [{ provider: "galley", settings: {} }], afterSubmit: [{ type: "script", code: "x()" }, { type: "redirect", url: "/thanks/" }] };

    expect(validateKitFile("forms", file, "f.json", { allowFormScripts: true, routeExists: (url) => url === "/thanks/" })).toEqual([]);
    expect(validateKitFile("forms", file, "f.json", { allowFormScripts: true, routeExists: () => false }).map((issue) => issue.message)).toEqual(["After sending › Go to a page: no page lives at /thanks/."]);
  });
});
