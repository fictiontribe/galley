import { describe, expect, it } from "vitest";
import type { MediaConfig, MediaItem } from "@galley/core/types";
import { filterMedia, folderOf, kindOf, mediaPathForUrl, sortMedia, thumbnailSource } from "@/features/media/mediaPaths";
import { fileNameFromPrompt, NAME_LENGTH } from "@/features/media/fileName";

const media: MediaConfig = {
  dir: "public/images",
  publicPath: "/images",
  roots: [
    { dir: "public/images", publicPath: "/images" },
    { dir: "public", publicPath: "/" },
  ],
};

function item(name: string, type: string, status: MediaItem["status"] = "clean", modifiedAt = 0): MediaItem {
  return { path: `public/images/${name}`, url: `/images/${name}`, name, size: 100, type, modifiedAt, status };
}

describe("media paths", () => {
  it("maps site URLs to repo paths by the longest matching root", () => {
    expect(mediaPathForUrl("/images/team/ana.webp", media)).toBe("public/images/team/ana.webp");
    expect(mediaPathForUrl("/favicon.svg", media)).toBe("public/favicon.svg");
    expect(mediaPathForUrl("/images/a%20b.png?v=2", media)).toBe("public/images/a b.png");
  });

  it("leaves other sites and odd values alone", () => {
    expect(mediaPathForUrl("https://cdn.example.com/x.png", media)).toBeNull();
    expect(mediaPathForUrl("//cdn.example.com/x.png", media)).toBeNull();
    expect(mediaPathForUrl("", media)).toBeNull();
    expect(mediaPathForUrl("/images/", media)).toBeNull();
    expect(mediaPathForUrl("/x.png", null)).toBeNull();
  });

  it("chooses where a thumbnail comes from", () => {
    expect(thumbnailSource("https://example.com/a.png", media, (p) => `raw:${p}`)).toBe("https://example.com/a.png");
    expect(thumbnailSource("/images/a.png", media, (p) => `raw:${p}`)).toBe("raw:public/images/a.png");
  });
});

describe("library", () => {
  const items = [item("hero.svg", "image/svg+xml", "clean", 1), item("tour.mp4", "video/mp4", "clean", 2), item("new-photo.png", "image/png", "added", 0), item("brochure.pdf", "application/pdf", "modified", 3)];

  it("filters by words and kind", () => {
    expect(filterMedia(items, "photo", "all").map((i) => i.name)).toEqual(["new-photo.png"]);
    expect(filterMedia(items, "", "image").map((i) => i.name)).toEqual(["hero.svg", "new-photo.png"]);
    expect(filterMedia(items, "images tour", "all").map((i) => i.name)).toEqual(["tour.mp4"]);
    expect(kindOf({ type: "application/pdf" })).toBe("document");
  });

  it("puts new and changed files first, then the newest", () => {
    expect(sortMedia(items).map((i) => i.name)).toEqual(["new-photo.png", "brochure.pdf", "tour.mp4", "hero.svg"]);
    expect(folderOf("public/images/team/a.png")).toBe("public/images/team");
  });
});

describe("the name offered for a generated picture", () => {
  it("cuts at a whole word and leaves no joining word dangling", () => {
    const name = fileNameFromPrompt("A wool coat on an iron hook against a limewashed wall, low winter sun");

    expect(name).toBe("wool-coat-on-an-iron-hook");
    // Never the old six-word cut, which ended mid-phrase.
    expect(name).not.toBe("a-wool-coat-on-an-iron");
    for (const word of ["a", "an", "the", "on", "of", "in", "and"]) {
      expect(name.endsWith(`-${word}`)).toBe(false);
      expect(name.startsWith(`${word}-`)).toBe(false);
    }
    expect(name.length).toBeLessThanOrEqual(NAME_LENGTH);
  });

  it("keeps short prompts whole and copes with odd ones", () => {
    expect(fileNameFromPrompt("Undyed wool on the cutting table")).toBe("undyed-wool-on-the-cutting-table");
    expect(fileNameFromPrompt("The coat of the season")).toBe("coat-of-the-season");
    expect(fileNameFromPrompt("A portrait in the")).toBe("portrait");
    expect(fileNameFromPrompt("   ")).toBe("image");
    expect(fileNameFromPrompt("Supercalifragilisticexpialidociousandthensomemoreletters")).toHaveLength(NAME_LENGTH);
  });
});
