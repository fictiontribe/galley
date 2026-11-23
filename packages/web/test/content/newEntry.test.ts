import { describe, expect, it } from "vitest";
import { newEntryBody } from "@/features/content/collection/slug";

const pages = { id: "pages", body: true };

describe("creating an entry", () => {
  it("from blank: the answers given and an empty body", () => {
    expect(newEntryBody({ collection: pages, slug: "/spring-sale/", title: " Spring sale ", titleKey: "title", values: { description: "" }, template: "" })).toEqual({
      collection: "pages",
      slug: "spring-sale",
      data: { title: "Spring sale", description: "" },
      body: "",
    });
  });

  it("from a template: only the title is laid over it, so the template's own content stays", () => {
    expect(newEntryBody({ collection: pages, slug: "about-us", title: "About us", titleKey: "title", values: { description: "" }, template: "about" })).toEqual({
      collection: "pages",
      slug: "about-us",
      data: { title: "About us" },
      template: "about",
    });
  });
});
