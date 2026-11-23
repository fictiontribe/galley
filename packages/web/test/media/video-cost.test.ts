import { describe, expect, it } from "vitest";
import { costLine, defaultDuration, imageModelFacts, modelFacts, modelOptionLabel, parsePrice } from "@/features/media/video/cost";

describe("video prices", () => {
  it("reads the price lines providers publish", () => {
    expect(parsePrice("$0.03–$0.08 per second")).toEqual({ low: 0.03, high: 0.08, unit: "second" });
    expect(parsePrice("$0.084 per second")).toEqual({ low: 0.084, high: 0.084, unit: "second" });
    expect(parsePrice("$0.40 per video")).toEqual({ low: 0.4, high: 0.4, unit: "video" });
    expect(parsePrice("$0.50 (per sku 720p)")?.unit).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice("free")).toBeNull();
  });

  it("says the cost before starting, and who charges it", () => {
    expect(costLine({ id: "k", label: "Kling", price: "$0.08 per second" }, 5, "OpenRouter")).toBe("About $0.40 for 5 seconds — charged by OpenRouter");
    expect(costLine({ id: "v", label: "Veo", price: "$0.03–$0.08 per second", resolutions: ["720p", "1080p"] }, 6, "OpenRouter")).toBe("About $0.18–$0.48 for 6 seconds, depending on the resolution — charged by OpenRouter");
    expect(costLine({ id: "v", label: "Veo", price: "$0.40 per video" }, undefined, "Lumen")).toBe("About $0.40 for this video — charged by Lumen");
    expect(costLine({ id: "s", label: "Seedance", price: "$0.05 per second" }, undefined, "OpenRouter")).toBe("About $0.05 a second; this model chooses the length — charged by OpenRouter");
  });

  it("never invents a number", () => {
    expect(costLine({ id: "s", label: "Seedance" }, 5, "OpenRouter")).toBe("OpenRouter doesn’t publish a price for this model. It’s charged to your OpenRouter account when the video is made.");
  });

  it("starts at 5 seconds where the model offers it", () => {
    expect(defaultDuration({ id: "a", label: "A", durations: [4, 6, 8] })).toBe(4);
    expect(defaultDuration({ id: "a", label: "A", durations: [10, 5] })).toBe(5);
    expect(defaultDuration({ id: "a", label: "A" })).toBeUndefined();
  });
});

describe("model facts for the pickers", () => {
  it("names price and capabilities", () => {
    expect(modelFacts({ id: "v", label: "Veo", price: "$0.03–$0.08 per second", durations: [4, 6, 8], resolutions: ["720p", "1080p"], supportsFirstFrame: true, audio: true })).toBe("4, 6, 8 s · 720p / 1080p · can start from a picture · with sound");
    expect(imageModelFacts({ supportsReferences: true, supportsTransparency: true }, { id: "f", label: "FLUX", price: "$0.03 per megapixel", supportsTransparency: false })).toBe("takes reference pictures");
    expect(modelOptionLabel({ label: "FLUX.2 Pro", price: "$0.03 per megapixel" })).toBe("FLUX.2 Pro — $0.03 per megapixel");
  });
});
