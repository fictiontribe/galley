import { describe, expect, it } from "vitest";
import { pagesToOffer, usedOnWords } from "@/features/forms/logic/embed";

const page = (slug: string, title: string) => ({ path: `src/content/pages/${slug}.md`, url: slug === "index" ? "/" : `/${slug}/`, title });
// Caddow's pages as the editor lists them: by title, so the home page (titled with the site's name) comes first.
const pages = [page("index", "Caddow — coats and knitwear, made in runs of forty"), page("contact", "Contact"), page("404", "Page not found"), page("atelier", "The atelier"), page("stockists", "Stockists")];

describe("Use this form › Add to page", () => {
  it("never suggests a page that already shows the form, and leaves the home page and the not-found page out of first place", () => {
    const offered = pagesToOffer(pages, [{ path: "src/content/pages/contact.md" }]);

    expect(offered.map((item) => item.url)).toEqual(["/atelier/", "/stockists/", "/"]);
    expect(offered[0]?.url).not.toBe("/");
  });

  it("offers nothing when every page already has the form, so the popover says where it is instead", () => {
    expect(pagesToOffer(pages, pages)).toEqual([]);
    expect(usedOnWords(["Contact"])).toBe("It’s on Contact.");
    expect(usedOnWords(["Home page", "Contact"])).toBe("It’s on Home page and Contact.");
    expect(usedOnWords(["Home page", "Contact", "Stockists", "The atelier"])).toBe("It’s on Home page, Contact and 2 more pages.");
  });
});
