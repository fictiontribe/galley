/**
 * A display name as it is kept (nothing in it a reader can't see) and as two
 * names are compared (what a reader would take for one name).
 */
import { describe, expect, it } from "vitest";
import { nameKey, tidyName } from "../../src/install/names";

const point = (hex: number) => String.fromCodePoint(hex);

describe("a name as it is kept", () => {
  it("loses the controls that reorder text", () => {
    for (const hex of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c]) {
      expect(tidyName(`Sam ${point(hex)}Owner${point(hex)}`), hex.toString(16)).toBe("Sam Owner");
    }
  });

  it("loses characters with no width", () => {
    // Zero-width space, word joiner, byte-order mark, soft hyphen, the invisible operators, the grapheme joiner, the Mongolian vowel separator.
    for (const hex of [0x200b, 0x2060, 0xfeff, 0x00ad, 0x2061, 0x2062, 0x2063, 0x2064, 0x034f, 0x180e]) {
      expect(tidyName(`Sa${point(hex)}m Owner`), hex.toString(16)).toBe("Sam Owner");
    }
  });

  it("loses fillers that show as nothing", () => {
    for (const hex of [0x115f, 0x1160, 0x3164, 0xffa0, 0x2800, 0x17b4, 0x17b5]) {
      expect(tidyName(`Sam${point(hex)} Owner${point(hex)}`), hex.toString(16)).toBe("Sam Owner");
    }
  });

  it("loses tag characters, except as the spelling of a flag", () => {
    const tags = (text: string) => [...text].map((char) => point(0xe0000 + char.charCodeAt(0))).join("");
    const scotland = `${point(0x1f3f4)}${tags("gbsct")}${point(0xe007f)}`;

    expect(tidyName(`Sam${tags("owner")} Owner`)).toBe("Sam Owner");
    expect(tidyName(`Isla ${scotland}`)).toBe(`Isla ${scotland}`);
    // A flag never finished is the plain flag: the letters after it spell nothing a reader sees.
    expect(tidyName(`Isla ${point(0x1f3f4)}${tags("gbsct")}`)).toBe(`Isla ${point(0x1f3f4)}`);
  });

  it("turns line breaks, tabs and other controls into single spaces", () => {
    expect(tidyName("  Sam\n\tOwner\u0085 Jr  ")).toBe("Sam Owner Jr");
  });

  it("keeps a joiner where writing needs one", () => {
    const persian = "می‌خواهم";
    const conjunct = "क्‍ष";
    const family = "👨‍👩‍👧";
    const heart = "❤️‍🔥";

    expect(persian).toContain("‌");
    expect(tidyName(`علی ${persian}`)).toBe(`علی ${persian}`);
    expect(tidyName(conjunct)).toBe(conjunct);
    expect(tidyName(`Sam ${family} ${heart}`)).toBe(`Sam ${family} ${heart}`);
  });

  it("drops a joiner where it joins nothing", () => {
    expect(tidyName("Sa‌m O‍wner")).toBe("Sam Owner");
    expect(tidyName("‍Sam Owner‌")).toBe("Sam Owner");
    expect(tidyName("Sam ‍ Owner")).toBe("Sam Owner");
    // One joiner is all a place can need.
    expect(tidyName("می‌‌‌خواهم")).toBe("می‌خواهم");
  });

  it("is empty when nothing a reader sees is left", () => {
    expect(tidyName("​‮⁠﻿ ㅤ")).toBe("");
  });
});

describe("two names compared", () => {
  it("are one name whatever the case, the width or the spacing", () => {
    const key = nameKey("Sam Owner");

    for (const other of ["sam owner", "SAM OWNER", "Ｓａｍ　Ｏｗｎｅｒ", "  Sam   Owner ", "Sam Owner", "Sam Owner️"]) expect(nameKey(other), other).toBe(key);
    expect(nameKey("Straße")).toBe(nameKey("STRASSE"));
    expect(nameKey("ﬁona")).toBe(nameKey("Fiona"));
  });

  it("are one name whatever unseen characters one of them carries", () => {
    const key = nameKey("Sam Owner");

    for (const hex of [0x200b, 0x200c, 0x200d, 0x202e, 0x2066, 0x00ad, 0xfeff, 0x3164, 0x2800]) expect(nameKey(`Sa${point(hex)}m Owner`), hex.toString(16)).toBe(key);
  });

  it("are two names when a reader could tell them apart", () => {
    expect(nameKey("Sam Owner")).not.toBe(nameKey("Sam Owners"));
    expect(nameKey("Sam Owner")).not.toBe(nameKey("Sam O."));
    expect(nameKey("José")).not.toBe(nameKey("Jose"));
  });

  it("doesn't claim to catch look-alike letters from another script", () => {
    // Cyrillic а (U+0430) for Latin a: that needs the Unicode confusables table, which isn't used here.
    expect(nameKey("Sаm Owner")).not.toBe(nameKey("Sam Owner"));
  });
});
