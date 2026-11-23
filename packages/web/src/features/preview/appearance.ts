/**
 * The app's look as the overlay needs it: the accent actually in use (the
 * white-label brand's, or the default) and whether the app is light or dark
 * right now, so outlines and the "Click to edit" tag match a re-branded app.
 */
import { useEffect, useState } from "react";
import { useMeta } from "@/lib/stores/meta";
import { useUi } from "@/lib/stores/ui";
import { toHex } from "./frames";

export interface AppAppearance {
  accent: string;
  theme: "light" | "dark";
}

function read(): AppAppearance | null {
  const root = document.documentElement;
  const accent = toHex(getComputedStyle(root).getPropertyValue("--accent"));
  if (!accent) return null;
  const setting = root.dataset.theme;
  const dark = setting === "dark" || (setting !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return { accent, theme: dark ? "dark" : "light" };
}

export function useAppAppearance(): AppAppearance | null {
  const brandAccent = useMeta((s) => s.meta?.brand.accent);
  const theme = useUi((s) => s.theme);
  const [appearance, setAppearance] = useState<AppAppearance | null>(read);
  useEffect(() => {
    // After BrandEffects has applied the brand and theme to the document.
    const frame = requestAnimationFrame(() => setAppearance(read()));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setAppearance(read());
    media.addEventListener("change", onChange);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", onChange);
    };
  }, [brandAccent, theme]);
  return appearance;
}
