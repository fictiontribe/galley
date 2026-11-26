import { describe, expect, it } from "vitest";
import { formatCredits, formatPriceStringAsCredits, formatUsdAsCredits, usdToCredits } from "@/lib/credits";
import { costLine, modelOptionLabel } from "@/features/media/video/cost";

describe("managed AI credits formatting", () => {
  it("converts USD to whole credits with rounding up", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(-0.5)).toBe(0);
    expect(usdToCredits(0.0001)).toBe(1);
    expect(usdToCredits(0.03)).toBe(12);
    expect(usdToCredits(0.08)).toBe(32);
    expect(usdToCredits(0.4)).toBe(160);
    expect(usdToCredits(3)).toBe(1200);
    expect(usdToCredits(15)).toBe(6000);
    expect(usdToCredits(1, 500)).toBe(200);
  });

  it("formats singular, plural, and null/zero credit values", () => {
    expect(formatCredits(0)).toBe("0 credits");
    expect(formatCredits(1)).toBe("1 credit");
    expect(formatCredits(42)).toBe("42 credits");
    expect(formatCredits(1250)).toBe("1,250 credits");
    expect(formatUsdAsCredits(null)).toBe("—");
    expect(formatUsdAsCredits(0)).toBe("0 credits");
    expect(formatUsdAsCredits(0.4)).toBe("160 credits");
  });

  it("converts dollar price strings cleanly and falls back gracefully", () => {
    expect(formatPriceStringAsCredits("$3")).toBe("1,200 credits");
    expect(formatPriceStringAsCredits("$15")).toBe("6,000 credits");
    expect(formatPriceStringAsCredits("$0.03 per megapixel")).toBe("12 credits per megapixel");
    expect(formatPriceStringAsCredits("$0.04 per image")).toBe("16 credits per image");
    expect(formatPriceStringAsCredits("$0.03–$0.08 per second")).toBe("12–32 credits per second");
    expect(formatPriceStringAsCredits("$0.03-$0.08 per second")).toBe("12–32 credits per second");
    expect(formatPriceStringAsCredits("$0.5 (generate)")).toBe("200 credits (generate)");
    expect(formatPriceStringAsCredits("Free")).toBe("Free");
  });

  it("formats video cost lines and model option labels in credits when creditMillicents is provided", () => {
    const model = {
      id: "google/veo-3.1-lite",
      label: "Veo 3.1 Lite",
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      supportsFirstFrame: true,
      audio: true,
      price: "$0.03–$0.08 per second",
    };

    expect(modelOptionLabel(model)).toBe("Veo 3.1 Lite — $0.03–$0.08 per second");
    expect(modelOptionLabel(model, 250)).toBe("Veo 3.1 Lite — 12–32 credits per second");

    expect(costLine({ ...model, price: "$0.08 per second", resolutions: ["720p"] }, 5, "OpenRouter", 250)).toBe(
      "About 160 credits for 5 seconds — from your Galley AI credits",
    );
    expect(costLine(model, 5, "OpenRouter", 250)).toBe(
      "About 60–160 credits for 5 seconds, depending on the resolution — from your Galley AI credits",
    );
    expect(costLine({ ...model, price: undefined }, 5, "OpenRouter", 250)).toBe(
      "Drawn from your Galley AI credits when the video is made.",
    );
    // BYOK mode stays unchanged
    expect(costLine({ ...model, price: "$0.08 per second", resolutions: ["720p"] }, 5, "OpenRouter")).toBe(
      "About $0.40 for 5 seconds — charged by OpenRouter",
    );
  });
});
