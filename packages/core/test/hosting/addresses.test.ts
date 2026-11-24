/**
 * The three addresses of an install and the name everything carries. (That
 * the derivation agrees with the install's own lives in the server's suite,
 * which can read packages/server/src/gateway.ts.)
 */
import { describe, expect, it } from "vitest";
import { addressProblem, defaultEditorName, depthBelow, deriveAddresses, editorNameProblem, resolveAddresses } from "../../src/hosting/addresses";

describe("editor addresses", () => {
  it("derive the preview and live names one level below the same domain", () => {
    expect(deriveAddresses("cms.example.com")).toEqual({ editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" });
    expect(deriveAddresses("Edit.Studio.Example.co.uk.")).toEqual({ editor: "edit.studio.example.co.uk", preview: "edit-preview.studio.example.co.uk", live: "edit-live.studio.example.co.uk" });
    // An apex gets prefixes: a sibling of an apex would be someone else's domain.
    expect(deriveAddresses("example.com")).toEqual({ editor: "example.com", preview: "preview.example.com", live: "live.example.com" });
    expect(deriveAddresses("localhost")).toEqual({ editor: "localhost", preview: "preview.localhost", live: "live.localhost" });
    expect(deriveAddresses("cms.localhost")).toEqual({ editor: "cms.localhost", preview: "preview.cms.localhost", live: "live.cms.localhost" });
    expect(deriveAddresses("10.0.0.4")).toBeNull();
    expect(deriveAddresses("intranet")).toBeNull();
    expect(deriveAddresses(`${"a".repeat(60)}.example.com`)).toBeNull();
  });

  it("refuse what can't carry a certificate, in plain words", () => {
    expect(addressProblem("https://cms.example.com")).toContain("without “https://”");
    expect(addressProblem("cms.example.com/admin")).toContain("without a path");
    expect(addressProblem("cms.example.com:8443")).toContain("without a port");
    expect(addressProblem("*.example.com")).toContain("wildcard");
    expect(addressProblem("192.168.1.20")).toContain("not an IP address");
    expect(addressProblem("[2001:db8::1]")).toContain("not an IP address");
    expect(addressProblem("intranet")).toContain("needs a domain");
    expect(addressProblem("cms_1.example.com")).toContain("letters, digits, dashes and dots");
    expect(addressProblem("")).toContain("missing");
    expect(addressProblem("cms.example.com")).toBeNull();
    expect(addressProblem("localhost")).toBeNull();
  });

  it("resolve explicit names, and refuse three that aren't distinct", () => {
    expect(resolveAddresses({ address: "cms.example.com" })).toEqual({ addresses: { editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" } });
    expect(resolveAddresses({ address: "cms.example.com", previewAddress: "p.example.com", liveAddress: "l.example.com" })).toEqual({ addresses: { editor: "cms.example.com", preview: "p.example.com", live: "l.example.com" } });
    expect(resolveAddresses({ address: "intranet.local", previewAddress: "intranet.local" })).toEqual({ problem: "The editor, the preview and the live comparison each need an address of their own." });
    expect(resolveAddresses({ address: "cms.example.com", previewAddress: "https://p.example.com" })).toMatchObject({ problem: expect.stringContaining("The preview's address") });
  });

  it("name things with a short name every host accepts", () => {
    expect(defaultEditorName("Lowfield Studio")).toBe("lowfield-studio-editor");
    expect(defaultEditorName("Café Nördlicht & Söhne Großhandel GmbH")).toBe("cafe-nordlicht-editor");
    expect(defaultEditorName("2024 Annual Report")).toBe("site-2024-annual-editor");
    expect(defaultEditorName("!!!")).toBe("site-editor");
    for (const name of ["lowfield-studio-editor", "cafe-nordlicht-editor", "site-2024-annual-editor", "site-editor"]) expect(editorNameProblem(name)).toBeNull();
    expect(editorNameProblem("Acme")).toContain("lowercase");
    expect(editorNameProblem("1acme")).toContain("starting with a letter");
    expect(editorNameProblem("acme--editor")).toContain("single dashes");
    expect(editorNameProblem("a".repeat(26))).toContain("25 characters");
  });

  it("count how deep a name sits below a domain", () => {
    expect(depthBelow("cms.example.com", "example.com")).toBe(1);
    expect(depthBelow("a.cms.example.com", "example.com")).toBe(2);
    expect(depthBelow("example.com", "example.com")).toBe(0);
    expect(depthBelow("cms.example.org", "example.com")).toBe(-1);
    expect(depthBelow("notexample.com", "example.com")).toBe(-1);
  });
});
