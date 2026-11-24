import { describe, expect, it } from "vitest";
import { authorLine } from "../../src/features/proof/authorLine";

const who = { name: "Ana Ruiz", email: "ana@example.com" };

describe("who a version is recorded as, in the Publish dialog", () => {
  it("names the setting that chose the author, and where to change it", () => {
    expect(authorLine({ ...who, from: "site" }, "s1")).toMatchObject({ text: "Recorded as Ana Ruiz (ana@example.com), this site’s own author.", change: { label: "Site settings › Connections", to: "/sites/s1/settings#connections" } });
    expect(authorLine({ ...who, from: "repository" }, "s1").text).toContain("from the site’s own version settings");
    expect(authorLine({ ...who, from: "app" }, "s1").change).toEqual({ label: "App settings › You", to: "/settings#you" });
    expect(authorLine({ ...who, from: "machine" }, "s1")).toMatchObject({ note: "To use another name, set it in", change: { label: "App settings › You" } });
    expect(authorLine({ name: "Site editor", email: "site-editor@localhost", from: "default" }, "s1").text).toContain("no name is set yet");
  });

  it("on a hosted install with accounts, names the signed-in person's own account", () => {
    expect(authorLine({ ...who, from: "account" }, "s1", true)).toEqual({ text: "Recorded as Ana Ruiz (ana@example.com), from your account.", change: { label: "Your account", to: "/account" } });
  });
});
