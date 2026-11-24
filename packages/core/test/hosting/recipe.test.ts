/**
 * The files to run an install with Docker, parsed back as YAML: every
 * variant runs the editor hardened with one volume and no published port,
 * the output is deterministic, and nothing secret is written except the
 * connector's key, in a file marked sensitive.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { IMAGE_REPOSITORY, PRODUCT, VERSION } from "../../src/brand";
import { defaultImage, installEnvironment, recipeFiles, RECIPE_PROXIES, SHARED_PROXY_NETWORK, SHARED_PROXY_PROJECT, type RecipeInput } from "../../src/hosting/recipe";

const ADDRESSES = { editor: "cms.example.com", preview: "cms-preview.example.com", live: "cms-live.example.com" };
const HASH = "a".repeat(64);
const TUNNEL_TOKEN = "eyJ-tunnel-token-that-is-secret-0123456789";
const input = (proxy: RecipeInput["proxy"], extra: Partial<RecipeInput> = {}): RecipeInput => ({ name: "acme-editor", addresses: ADDRESSES, image: "ghcr.io/example/editor:1.2.3", proxy, setupTokenSha256: HASH, ...extra });
const file = (files: Array<{ name: string; content: string }>, name: string) => files.find((entry) => entry.name === name)!.content;

describe("the Docker recipe", () => {
  it.each(RECIPE_PROXIES)("%s: the editor runs hardened, with one volume at /data and no published port", (proxy) => {
    const files = recipeFiles(input(proxy, proxy === "tunnel" ? { tunnelToken: TUNNEL_TOKEN } : {}));
    const compose = parse(file(files, "compose.yaml"));
    const editor = compose.services.editor;

    expect(editor).toMatchObject({
      image: "ghcr.io/example/editor:1.2.3",
      user: "node",
      read_only: true,
      tmpfs: ["/tmp"],
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges"],
      mem_limit: "2g",
      pids_limit: 512,
      stop_grace_period: "30s",
      env_file: ".env",
      restart: "unless-stopped",
    });
    expect(editor.volumes).toEqual(["data:/data"]);
    expect(Object.keys(compose.volumes)).toContain("data");
    expect(editor.ports).toBeUndefined();
    expect(editor.expose).toBeUndefined();
    expect(editor.healthcheck.test.join(" ")).toContain("http://127.0.0.1:4400/healthz");
    // The compose project carries the product's slug, so it is recognisable on a shared server.
    expect(compose.name).toBe(`${PRODUCT.slug}-acme-editor`);
    // Deterministic: the same input, byte for byte the same files.
    expect(recipeFiles(input(proxy, proxy === "tunnel" ? { tunnelToken: TUNNEL_TOKEN } : {}))).toEqual(files);
  });

  it("caddy: Caddy serves the three names and is the only thing with ports", () => {
    const files = recipeFiles(input("caddy"));
    const compose = parse(file(files, "compose.yaml"));

    expect(files.map((entry) => entry.name)).toEqual(["compose.yaml", "Caddyfile", ".env"]);
    expect(compose.services.caddy.ports).toEqual(["80:80", "443:443", "443:443/udp"]);
    expect(compose.services.caddy.volumes).toContain("./Caddyfile:/etc/caddy/Caddyfile:ro");
    const caddyfile = file(files, "Caddyfile");

    expect(caddyfile).toContain("cms.example.com, cms-preview.example.com, cms-live.example.com {");
    expect(caddyfile).toContain("reverse_proxy editor:4400");
    expect(caddyfile).not.toContain("tls internal");
    // Names on this computer only: Caddy's own authority signs them.
    expect(file(recipeFiles(input("caddy", { addresses: { editor: "cms.localhost", preview: "preview.cms.localhost", live: "live.cms.localhost" } })), "Caddyfile")).toContain("tls internal");
  });

  it("shared-proxy: the editor joins the shared Caddy's network under its own name; the proxy files come along", () => {
    const files = recipeFiles(input("shared-proxy"));
    const compose = parse(file(files, "compose.yaml"));

    expect(files.map((entry) => entry.name)).toEqual(["compose.yaml", ".env", "acme-editor.caddy", "proxy/compose.yaml", "proxy/Caddyfile"]);
    expect(Object.keys(compose.services)).toEqual(["editor"]);
    expect(compose.services.editor.networks).toEqual({ proxy: { aliases: ["acme-editor"] } });
    expect(compose.networks.proxy).toEqual({ external: true, name: SHARED_PROXY_NETWORK });
    expect(file(files, "acme-editor.caddy")).toContain("reverse_proxy acme-editor:4400");
    const proxy = parse(file(files, "proxy/compose.yaml"));

    expect(proxy.services.caddy.volumes).toContain("./sites:/etc/caddy/sites:ro");
    expect(proxy.name).toBe(SHARED_PROXY_PROJECT);
    expect(SHARED_PROXY_PROJECT).toBe(`${PRODUCT.slug}-proxy`);
    expect(file(files, "proxy/Caddyfile")).toContain("import sites/*.caddy");
  });

  it("tunnel: the connector dials out; its key is only in tunnel.env, marked sensitive", () => {
    const files = recipeFiles(input("tunnel", { tunnelToken: TUNNEL_TOKEN }));
    const compose = parse(file(files, "compose.yaml"));

    expect(compose.services.connector).toMatchObject({ image: "cloudflare/cloudflared:latest", command: ["tunnel", "--no-autoupdate", "run"], env_file: "tunnel.env", cap_drop: ["ALL"] });
    expect(compose.services.connector.ports).toBeUndefined();
    for (const entry of files) {
      if (entry.content.includes(TUNNEL_TOKEN)) expect(entry).toMatchObject({ name: "tunnel.env", sensitive: true });
      else expect(entry.sensitive).toBeUndefined();
    }
    expect(file(files, "tunnel.env")).toContain(`TUNNEL_TOKEN=${TUNNEL_TOKEN}`);
    // Without a key yet, the file says where it goes and holds nothing.
    expect(file(recipeFiles(input("tunnel")), "tunnel.env")).not.toMatch(/^TUNNEL_TOKEN=/m);
  });

  it("the .env carries the three addresses, the proxy and only the setup code's hash", () => {
    const env = file(recipeFiles(input("caddy", { repository: "git@github.com:example/site.git" })), ".env");

    expect(env.split("\n").filter((line) => line && !line.startsWith("#"))).toEqual([
      "GALLEY_PUBLIC_URL=https://cms.example.com",
      "GALLEY_PREVIEW_URL=https://cms-preview.example.com",
      "GALLEY_LIVE_VIEW_URL=https://cms-live.example.com",
      "GALLEY_TRUST_PROXY=1",
      `GALLEY_SETUP_TOKEN_SHA256=${HASH}`,
      "GALLEY_SITE_REPOSITORY=git@github.com:example/site.git",
      "GALLEY_PREVIEW_MEMORY_MB=1024",
    ]);
    expect(file(recipeFiles(input("caddy", { setupTokenSha256: undefined })), ".env")).not.toContain("GALLEY_SETUP_TOKEN_SHA256=");
    // A site inside a larger repository: where, beside the repository.
    expect(file(recipeFiles(input("caddy", { repository: "git@github.com:example/monorepo.git", folder: "apps/site" })), ".env")).toContain("GALLEY_SITE_REPOSITORY=git@github.com:example/monorepo.git\nGALLEY_SITE_FOLDER=apps/site\n");
    expect(installEnvironment(ADDRESSES)).not.toHaveProperty("GALLEY_PREVIEW_MEMORY_MB");
    expect(installEnvironment(ADDRESSES)).not.toHaveProperty("GALLEY_SETUP_TOKEN_SHA256");
  });

  it("installs this version's image unless GALLEY_HOSTING_IMAGE names another", () => {
    expect(defaultImage({})).toBe(`${IMAGE_REPOSITORY}:${VERSION}`);
    expect(IMAGE_REPOSITORY).toMatch(/^ghcr\.io\/[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(defaultImage({ GALLEY_HOSTING_IMAGE: " registry.example.com/editor:2 " })).toBe("registry.example.com/editor:2");
  });
});
