/**
 * A site stand-in for the media storage tests: just enough SiteService for
 * the media storage service — its id, its settings file, and the model's
 * `media` built from it the way the engine builds it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GalleyError } from "../../src/errors";
import type { GalleyConfig, SiteModel, SiteService } from "../../src/types";
import { hashContent } from "../../src/workspace/index";

export interface FakeSite {
  site: SiteService;
  config: GalleyConfig;
  saves: number;
}

export function fakeSite(id = "lowfield", config: GalleyConfig = {}): FakeSite {
  const state: FakeSite = { site: null as unknown as SiteService, config, saves: 0 };
  const model = () =>
    ({
      media: {
        dir: "public/images",
        publicPath: "/images",
        roots: [{ dir: "public/images", publicPath: "/images" }],
        ...(state.config.media?.storage ? { storage: state.config.media.storage } : {}),
        ...(state.config.media?.images ? { images: state.config.media.images } : {}),
      },
    }) as unknown as SiteModel;

  state.site = {
    id,
    model: async () => model(),
    readConfig: async () => structuredClone(state.config),
    // The settings file with its version, as the engine reads it before a save.
    readFile: async () => ({ content: JSON.stringify(state.config), hash: hashContent(JSON.stringify(state.config)) }),
    saveConfig: async (next: GalleyConfig, options: { baseHash?: string } = {}) => {
      if (options.baseHash && options.baseHash !== hashContent(JSON.stringify(state.config))) throw new GalleyError("conflict", "The site's settings changed since they were opened.");
      state.config = structuredClone(next);
      state.saves += 1;
      return model();
    },
  } as unknown as SiteService;
  return state;
}

export async function tempHome(): Promise<{ home: string; done: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "galley-media-test-"));

  return { home, done: () => rm(home, { recursive: true, force: true }) };
}
