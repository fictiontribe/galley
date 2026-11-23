/**
 * The closed write surface treats a form's custom code as build-mode-only:
 * content mode (the assistant editing content, MCP in content mode, an
 * "agent" write that names no mode) can't add or change a `script` action;
 * build mode, and the person in the app on a site that allows build mode, can.
 */
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { addedFormCode, wireContentConfig } from "../../src/site-kit/index";
import { disposeAll, openSite, sh, tempDir, writeTree } from "../site/helpers";

const FIXTURE = fileURLToPath(new URL("../fixtures/pre-kit-astro", import.meta.url));
const PATH = "src/content/forms/contact.json";
const CONTACT = { name: "Contact", submitLabel: "Send", fields: [{ id: "email", type: "email", label: "Email" }], destinations: [{ provider: "galley", settings: {} }], afterSubmit: [{ type: "message", text: "Thanks." }] };
const SCRIPT = { type: "script", code: "window.alert(values.email)" };

function site(config?: object): string {
  const root = tempDir("kit-guard-");

  cpSync(FIXTURE, root, { recursive: true });
  // The forms collection as "Set it up for me" declares it.
  const wired = wireContentConfig(readFileSync(join(root, "src/content.config.ts"), "utf8"), "src/content.config.ts");

  if (wired.state === "edited") writeFileSync(join(root, "src/content.config.ts"), wired.text);
  writeTree(root, { [PATH]: `${JSON.stringify(CONTACT, null, 2)}\n`, ...(config ? { "galley.config.json": `${JSON.stringify(config)}\n` } : {}) });
  sh(root, "init", "-q", "-b", "main");
  sh(root, "add", "-A");
  sh(root, "commit", "-q", "-m", "Initial");
  return root;
}

const addScript = [{ op: "insert" as const, path: ["afterSubmit"], index: 1, value: SCRIPT }];

afterEach(disposeAll);

describe("a form's custom code is build-mode-only", () => {
  it("content mode refuses it, and so does an agent that names no mode", async () => {
    const root = site();
    const { site: service } = await openSite(root);

    for (const options of [{ origin: "agent" as const, mode: "content" as const }, { origin: "agent" as const }]) {
      const result = await service.updateEntry(PATH, addScript, options);

      expect(result.applied).toBe(0);
      expect(result.refused[0]?.reason).toBe("Custom code in a form runs in every visitor's browser, so it can only be added in build mode. Nothing was changed.");
    }
    await expect(service.writeFile(PATH, JSON.stringify({ ...CONTACT, afterSubmit: [SCRIPT] }), { origin: "agent", mode: "content" })).rejects.toThrow(/only be added in build mode/);
    await expect(service.createEntry({ collection: "forms", slug: "sneaky", data: { ...CONTACT, afterSubmit: [SCRIPT] } }, { origin: "agent", mode: "content" })).rejects.toThrow(/only be added in build mode/);
    expect(JSON.parse(readFileSync(join(root, PATH), "utf8")).afterSubmit).toHaveLength(1);
    // Removing code, or editing anything else, is ordinary content editing.
    expect((await service.updateEntry(PATH, [{ op: "set", path: ["name"], value: "Get in touch" }], { origin: "agent", mode: "content" })).applied).toBe(1);
  });

  it("build mode and the person in the app may add it, unless the site turns build mode off", async () => {
    const root = site();
    const { site: service } = await openSite(root);

    expect((await service.updateEntry(PATH, addScript, { origin: "agent", mode: "build" })).applied).toBe(1);
    sh(root, "checkout", "--", PATH);
    expect((await service.updateEntry(PATH, addScript, { origin: "user" })).applied).toBe(1);

    const locked = site({ ai: { allowBuild: false } });
    const { site: lockedService } = await openSite(locked);
    const result = await lockedService.updateEntry(PATH, addScript, { origin: "user" });

    expect(result.applied).toBe(0);
    expect(result.refused[0]?.reason).toBe("Custom code in a form can only be added on sites that allow build mode. Nothing was changed.");
  });

  it("only new or changed code counts", () => {
    const before = JSON.stringify({ ...CONTACT, afterSubmit: [SCRIPT] });

    expect(addedFormCode(before, JSON.stringify({ ...CONTACT, name: "Other", afterSubmit: [SCRIPT] }))).toEqual([]);
    expect(addedFormCode(before, JSON.stringify({ ...CONTACT, afterSubmit: [] }))).toEqual([]);
    expect(addedFormCode(before, JSON.stringify({ ...CONTACT, afterSubmit: [{ type: "script", code: "x()" }] }))).toEqual(["x()"]);
  });
});
