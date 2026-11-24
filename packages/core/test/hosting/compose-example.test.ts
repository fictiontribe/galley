/**
 * The repository's own docker-compose.yml, Caddyfile and .env.example are
 * exactly what `galley host recipe` writes for one install with Caddy in
 * front, with placeholder values a reader replaces — one source of truth,
 * so the example can't drift from what the app hands an operator.
 *
 * After a change to the recipe (or a new version), write them again with:
 *   GALLEY_UPDATE_EXAMPLE=1 npx vitest run test/hosting/compose-example.test.ts
 * (in packages/core).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IMAGE_REPOSITORY, VERSION } from "../../src/brand";
import { deriveAddresses } from "../../src/hosting/addresses";
import { recipeFiles } from "../../src/hosting/recipe";

const REPOSITORY = fileURLToPath(new URL("../../../../", import.meta.url));
/** Recipe file → the file beside the Dockerfile. */
const EXAMPLE: Record<string, string> = { "compose.yaml": "docker-compose.yml", Caddyfile: "Caddyfile", ".env": ".env.example" };

describe("the repository's compose example", () => {
  it("is what the recipe writes for name “editor” at cms.example.com, with Caddy in front", () => {
    const files = recipeFiles({ name: "editor", addresses: deriveAddresses("cms.example.com")!, image: `${IMAGE_REPOSITORY}:${VERSION}`, proxy: "caddy" });

    expect(files.map((file) => file.name).sort()).toEqual(Object.keys(EXAMPLE).sort());
    for (const file of files) {
      const path = join(REPOSITORY, EXAMPLE[file.name]!);

      if (process.env.GALLEY_UPDATE_EXAMPLE === "1") writeFileSync(path, file.content);
      expect(readFileSync(path, "utf8"), `${EXAMPLE[file.name]} has drifted from the recipe: write it again (see the top of this test)`).toBe(file.content);
    }
  });
});
