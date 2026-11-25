/**
 * Image generation. The OpenAI and Google providers are tested against a
 * scripted fetch whose responses copy the documented shapes; they have not
 * been run against the live services.
 */
import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANDIDATE_TTL_MS, createImageService, createSettingsService, filenameFromPrompt, renderMockSvg } from "../../src/ai/index";
import { OPENAI_SIZES } from "../../src/ai/images/catalog";
import type { ImageAspect, SiteService } from "../../src/types";
import { cleanEnv, tempDir } from "./helpers/env";
import { createFakeSite } from "./helpers/fake-site";
import { jsonResponse, scriptedFetch } from "./helpers/scripted-fetch";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwx1234";
const GOOGLE_KEY = "AIzaSyD-abcdefghijklmnopqrstuvwxyz01234";

function setup(steps: Parameters<typeof scriptedFetch>[0] = [], env: Record<string, string> = {}, now?: () => number) {
  const home = tempDir("ai-images-");
  const settings = createSettingsService({ home, env: cleanEnv(env) });
  const script = scriptedFetch(steps);
  const images = createImageService({ home, settings, fetch: script.fetch, ...(now ? { now } : {}) });

  return { home, settings, script, images };
}

describe("mock provider", () => {
  it("draws the same picture for the same prompt, a different one for another", () => {
    expect(renderMockSvg("A harbour at dawn", 1200, 675)).toBe(renderMockSvg("A harbour at dawn", 1200, 675));
    expect(renderMockSvg("A harbour at dawn", 1200, 675)).not.toBe(renderMockSvg("A harbour at dusk", 1200, 675));
    expect(renderMockSvg("Bread & <butter>", 100, 100)).toContain("Bread &amp; &lt;butter&gt;");
  });

  it("honours every aspect ratio and needs no key", async () => {
    const { images } = setup();
    const expected: Record<ImageAspect, [number, number]> = {
      "1:1": [1200, 1200],
      "16:9": [1200, 675],
      "4:3": [1200, 900],
      "3:2": [1200, 800],
      "9:16": [675, 1200],
      "3:4": [900, 1200],
      "2:3": [800, 1200],
    };

    for (const [aspect, [width, height]] of Object.entries(expected) as Array<[ImageAspect, [number, number]]>) {
      const [candidate] = await images.generate({ prompt: "Loaves on a rack", provider: "mock", aspect });

      expect(candidate).toMatchObject({ width, height, mime: "image/svg+xml", provider: "mock", previewUrl: `/api/images/candidates/${candidate!.id}` });
      const read = await images.read(candidate!.id);

      expect(new TextDecoder().decode(read!.data)).toContain(`viewBox="0 0 ${width} ${height}"`);
    }
  });

  it("uses the built-in placeholder when no image service is chosen, and says so", async () => {
    const { images, settings } = setup();
    const [candidate] = await images.generate({ prompt: "Anything at all" });

    expect((await settings.get()).images.provider).toBeNull();
    expect(candidate).toMatchObject({ provider: "mock", model: "abstract-svg", mime: "image/svg+xml" });
    expect((await images.providers()).find((info) => info.id === "mock")).toMatchObject({ placeholder: true, configured: true });
    expect((await images.providers()).filter((info) => info.placeholder)).toHaveLength(1);
  });

  it("never shows a service as chosen that generation would refuse", async () => {
    const { settings, images } = setup();

    // Choosing a service needs its key first, in plain words.
    await expect(settings.update({ images: { provider: "openai" } })).rejects.toMatchObject({ code: "invalid", message: "Add an OpenAI API key first, then choose OpenAI." });
    await settings.setSecret("openai", "sk-proj-0123456789abcdefghijklmnop");
    await settings.update({ images: { provider: "openai", model: "gpt-image-2" } });
    expect((await settings.get()).images).toMatchObject({ provider: "openai", model: "gpt-image-2" });
    // The key goes away: Settings no longer says OpenAI, and generation uses the placeholder rather than refuse.
    await settings.setSecret("openai", null);
    expect((await settings.get()).images).toMatchObject({ provider: null, model: null });
    expect((await images.generate({ prompt: "A loaf on a board" }))[0]).toMatchObject({ provider: "mock" });
    // Asking for a service by name without its key is still refused, plainly.
    await expect(images.generate({ prompt: "A loaf on a board", provider: "openai" })).rejects.toMatchObject({ code: "unconfigured", message: expect.stringContaining("OpenAI API key") });
  });
});

describe("candidates", () => {
  it("expires after two hours and is swept", async () => {
    let clock = 1_000_000;
    const { images, home } = setup([], {}, () => clock);
    const [candidate] = await images.generate({ prompt: "A loaf", provider: "mock" });
    const dir = join(home, "tmp", "candidates");

    expect(readdirSync(dir)).toHaveLength(2);
    clock += CANDIDATE_TTL_MS - 1000;
    expect(await images.read(candidate!.id)).not.toBeNull();
    clock += 2000;
    expect(await images.read(candidate!.id)).toBeNull();
    for (const name of readdirSync(dir)) utimesSync(join(dir, name), new Date(1000), new Date(1000));
    await images.sweep();
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it("saves with a name from the prompt, avoids collisions, and records usage", async () => {
    const { images, settings } = setup();
    const site = createFakeSite();
    const [a] = await images.generate({ prompt: "The Old Bakery, at dawn — with steam!", provider: "mock" });
    const [b] = await images.generate({ prompt: "The Old Bakery, at dawn — with steam!", provider: "mock" });
    const first = await images.save(site, { candidateId: a!.id });
    const second = await images.save(site, { candidateId: b!.id });

    expect(first.path).toBe("public/images/old-bakery-at-dawn-steam.svg");
    expect(second.path).toBe("public/images/old-bakery-at-dawn-steam-2.svg");
    expect(await images.read(a!.id)).toBeNull();
    await expect(images.save(site, { candidateId: a!.id })).rejects.toMatchObject({ code: "not-found" });
    const [c] = await images.generate({ prompt: "x y z", provider: "mock" });

    expect((await images.save(site, { candidateId: c!.id, filename: "Team Photo.PNG" }, "agent")).path).toBe("public/images/team-photo.svg");
    expect((await settings.usage()).today.images).toBe(3);
  });

  it("derives kebab names of at most 60 characters on word boundaries", () => {
    const name = filenameFromPrompt("A very long description of a sunlit kitchen extension with oak floors and a big roof window over the island");

    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.startsWith("very-long-description")).toBe(true);
    expect(filenameFromPrompt("Café crème")).toBe("cafe-creme");
    expect(filenameFromPrompt("!!!")).toBe("image");
  });
});

describe("OpenAI provider (scripted)", () => {
  it("posts to images/generations with a mapped size, style appended", async () => {
    const { images, script, settings } = setup([() => jsonResponse(200, { created: 1, data: [{ b64_json: PNG }], output_format: "png", usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } })], {
      OPENAI_API_KEY: OPENAI_KEY,
    });

    await settings.update({ images: { provider: "openai" } });
    const [candidate] = await images.generate({ prompt: "A loaf", aspect: "16:9", style: "flat illustration", transparent: true });
    const request = script.requests[0]!;

    expect(request.url).toBe("https://api.openai.com/v1/images/generations");
    expect(request.headers.authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(request.body).toEqual({ model: "gpt-image-2.6-sunburst", prompt: "A loaf\n\nStyle: flat illustration", n: 1, size: "1536x864", output_format: "png", background: "transparent" });
    expect(candidate).toMatchObject({ mime: "image/png", width: 1536, height: 864, provider: "openai", model: "gpt-image-2.6-sunburst" });
  });

  it("never takes a secrets file or one of the version history's own for a reference image, whatever its name ends in", async () => {
    const dir = tempDir("ai-ref-secret-");
    const asked: string[] = [];

    writeFileSync(join(dir, ".env.png"), "TOKEN=not-a-picture\n");
    const site = { id: "s", resolvePath: (path: string) => (asked.push(path), join(dir, path.split("/").pop()!)) } as unknown as SiteService;
    const { images, script } = setup([() => jsonResponse(200, { data: [{ b64_json: PNG }] })], { OPENAI_API_KEY: OPENAI_KEY });

    for (const path of [".env.png", "config/.ENV.local.jpg", ".git/objects/pack.png"]) {
      await expect(images.generate({ prompt: "Like this", provider: "openai", model: "gpt-image-2.6-flare", referencePaths: [path] }, { site })).rejects.toMatchObject({ code: "forbidden", message: "That file can't be used as a reference image." });
    }
    // Not opened, and nothing was sent to the provider.
    expect(asked).toEqual([]);
    expect(script.requests).toEqual([]);
  });

  it("sends reference images to images/edits as data URLs", async () => {
    const dir = tempDir("ai-ref-");

    writeFileSync(join(dir, "logo.png"), Buffer.from(PNG, "base64"));
    const site = { id: "s", resolvePath: (path: string) => join(dir, path.split("/").pop()!) } as unknown as SiteService;
    const { images, script } = setup([() => jsonResponse(200, { data: [{ b64_json: PNG }, { b64_json: PNG }] })], { OPENAI_API_KEY: OPENAI_KEY });
    const candidates = await images.generate({ prompt: "Use this logo on a sign", provider: "openai", model: "gpt-image-2.6-flare", count: 2, referencePaths: ["public/images/logo.png"] }, { site });

    expect(script.requests[0]!.url).toBe("https://api.openai.com/v1/images/edits");
    expect(script.requests[0]!.body.images).toEqual([{ image_url: `data:image/png;base64,${PNG}` }]);
    expect(script.requests[0]!.body.n).toBe(2);
    expect(candidates).toHaveLength(2);
  });

  it("explains content-policy, quota and key failures without leaking the key", async () => {
    const cases: Array<[number, unknown, RegExp, string]> = [
      [400, { error: { message: "Your request was rejected by the safety system.", type: "image_generation_user_error", code: "moderation_blocked" } }, /declined to make that image/, "ai"],
      [429, { error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } }, /out of credit/, "unconfigured"],
      [401, { error: { message: `Incorrect API key provided: ${OPENAI_KEY}`, type: "invalid_request_error", code: "invalid_api_key" } }, /didn't accept the API key/, "unconfigured"],
    ];

    for (const [status, body, message, code] of cases) {
      const { images } = setup([() => jsonResponse(status, body)], { OPENAI_API_KEY: OPENAI_KEY });
      const error = await images.generate({ prompt: "A loaf", provider: "openai" }).catch((e) => e);

      expect(error).toMatchObject({ code, message: expect.stringMatching(message) });
      expect(`${error.message} ${error.detail}`).not.toContain(OPENAI_KEY);
    }
  });

  it("asks for a key when none is set", async () => {
    const { images } = setup();

    await expect(images.generate({ prompt: "A loaf", provider: "openai" })).rejects.toMatchObject({ code: "unconfigured", message: expect.stringContaining("OpenAI API key") });
  });

  it("maps every aspect to a valid GPT Image size", () => {
    for (const { width, height } of Object.values(OPENAI_SIZES)) {
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(3);
      expect(width * height).toBeGreaterThanOrEqual(655_360);
      expect(width * height).toBeLessThanOrEqual(8_294_400);
    }
  });
});

describe("Google provider (scripted)", () => {
  const interaction = {
    id: "int_1",
    status: "completed",
    steps: [
      { type: "thought", content: [{ type: "image", mime_type: "image/png", data: "ZHJhZnQ=" }] },
      { type: "model_output", content: [{ type: "text", text: "Here you go." }, { type: "image", mime_type: "image/png", data: PNG }] },
    ],
    usage: { total_input_tokens: 12, total_output_tokens: 1290 },
  };

  it("posts to the Interactions API with the aspect ratio and skips thought images", async () => {
    const { images, script } = setup([() => jsonResponse(200, interaction)], { GEMINI_API_KEY: GOOGLE_KEY });
    const [candidate] = await images.generate({ prompt: "A loaf", provider: "google", aspect: "3:4" });
    const request = script.requests[0]!;

    expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(request.headers["x-goog-api-key"]).toBe(GOOGLE_KEY);
    expect(request.headers["api-revision"]).toBe("2026-05-20");
    expect(request.body).toEqual({
      model: "gemini-nano-banana-2.1",
      input: [{ type: "text", text: "A loaf" }],
      response_format: { type: "image", aspect_ratio: "3:4", image_size: "1K" },
    });
    expect(candidate).toMatchObject({ mime: "image/png", width: 1, height: 1, provider: "google" });
    expect(Buffer.from((await images.read(candidate!.id))!.data).toString("base64")).toBe(PNG);
  });

  it("makes one request per image and passes references inline", async () => {
    const dir = tempDir("ai-ref-");

    writeFileSync(join(dir, "shop.png"), Buffer.from(PNG, "base64"));
    const site = { id: "s", resolvePath: (path: string) => join(dir, path.split("/").pop()!) } as unknown as SiteService;
    const { images, script } = setup([() => jsonResponse(200, interaction), () => jsonResponse(200, interaction)], { GOOGLE_API_KEY: GOOGLE_KEY });

    await images.generate({ prompt: "Like this shop", provider: "google", count: 2, referencePaths: ["public/images/shop.png"] }, { site });
    expect(script.requests).toHaveLength(2);
    expect(script.requests[0]!.body.input[1]).toEqual({ type: "image", mime_type: "image/png", data: PNG });
  });

  it("explains a rejected key, a used-up quota and a declined prompt", async () => {
    const rejectedKey = { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } };
    const quota = { error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } };
    const declined = { id: "int_2", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "I can't create that." }] }] };

    for (const [status, body, message] of [
      [400, rejectedKey, /didn't accept the API key/],
      [429, quota, /used up its image allowance/],
      [200, declined, /may have declined/],
    ] as Array<[number, unknown, RegExp]>) {
      const { images } = setup([() => jsonResponse(status, body)], { GEMINI_API_KEY: GOOGLE_KEY });
      const error = await images.generate({ prompt: "A loaf", provider: "google" }).catch((e) => e);

      expect(error.message).toMatch(message);
      expect(`${error.message} ${error.detail}`).not.toContain(GOOGLE_KEY);
    }
  });

  it("refuses transparency, which Google doesn't offer", async () => {
    const { images } = setup([], { GEMINI_API_KEY: GOOGLE_KEY });

    await expect(images.generate({ prompt: "A logo", provider: "google", transparent: true })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("files stay tidy", () => {
  it("discard removes both files", async () => {
    const { images, home } = setup();
    const [candidate] = await images.generate({ prompt: "A loaf", provider: "mock" });

    await images.discard(candidate!.id);
    expect(existsSync(join(home, "tmp", "candidates", `${candidate!.id}.json`))).toBe(false);
    expect(readdirSync(join(home, "tmp", "candidates"))).toHaveLength(0);
  });
});
