import { cx } from "@/ui";

const PROVIDER_MARKS: Record<string, string> = { galley: "In", hubspot: "Hs", marketo: "Mk", salesforce: "Sf", pardot: "Pd", webhook: "→", mailto: "@" };

/** A provider's or integration's small mark: a lettered tile (vendor logos aren't used). */
export function Mark({ text, size = "md", className }: { text: string; size?: "sm" | "md"; className?: string }) {
  return (
    <span className={cx("kit-mark", size === "sm" && "kit-mark--sm", className)} aria-hidden="true">
      {text}
    </span>
  );
}

export function providerMark(provider: string): string {
  return PROVIDER_MARKS[provider] ?? provider.slice(0, 2);
}
