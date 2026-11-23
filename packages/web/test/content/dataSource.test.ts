import { describe, expect, it } from "vitest";
import { goneLine, moveActive, pickImageSrc } from "../../src/features/content/fields/dataSource";

const media = { dir: "public/images", publicPath: "/images", roots: [{ dir: "public/images", publicPath: "/images" }] };
const raw = (path: string) => `/api/sites/s1/raw?path=${encodeURIComponent(path)}`;

describe("data-source picker", () => {
  it("reads a site-root picture from the running preview, else from the site's media", () => {
    expect(pickImageSrc("/images/lookbooks/look-02.webp", "http://127.0.0.1:4611/", media, raw)).toBe("http://127.0.0.1:4611/images/lookbooks/look-02.webp");
    expect(pickImageSrc("/images/coat.webp", null, media, raw)).toBe("/api/sites/s1/raw?path=public%2Fimages%2Fcoat.webp");
    expect(pickImageSrc("https://cdn.example.com/coat.webp", "http://127.0.0.1:4611", media, raw)).toBe("https://cdn.example.com/coat.webp");
  });

  it("shows no picture for anything else", () => {
    expect(pickImageSrc(undefined, null, media, raw)).toBeNull();
    expect(pickImageSrc("http://insecure.example/coat.webp", null, media, raw)).toBeNull();
    expect(pickImageSrc("//cdn.example.com/coat.webp", null, media, raw)).toBeNull();
    expect(pickImageSrc("javascript:alert(1)", null, media, raw)).toBeNull();
    expect(pickImageSrc("/elsewhere/coat.webp", null, media, raw)).toBeNull();
  });

  it("says where a gone value was", () => {
    expect(goneLine("Products in the shop")).toBe("No longer in the shop");
    expect(goneLine("Collections in the shop")).toBe("No longer in the shop");
    expect(goneLine("Team directory")).toBe("No longer offered by Team directory");
  });

  it("moves through the results with the arrow keys, wrapping, and leaves other keys alone", () => {
    expect(moveActive("ArrowDown", -1, 3)).toBe(0);
    expect(moveActive("ArrowDown", 2, 3)).toBe(0);
    expect(moveActive("ArrowUp", 0, 3)).toBe(2);
    expect(moveActive("ArrowUp", 2, 3)).toBe(1);
    expect(moveActive("Home", 2, 3)).toBeNull();
    expect(moveActive("ArrowDown", 0, 0)).toBeNull();
  });
});
