/**
 * Form providers from the catalogue, named for this app's screens. The
 * built-in inbox is called by what it is ("Inbox"), never by the product's
 * name, so a white-labelled app reads right.
 */
import type { FormProviderInfo } from "@galley/core/kit";
import { FORM_PROVIDERS } from "@galley/core/kit-catalog";
import { pluginFormProvider } from "@/features/plugins/catalog";

/** The built-in catalogue first; then a destination a plugin active for the site adds (from the last catalogue read). */
export function providerInfo(id: string): FormProviderInfo | null {
  return FORM_PROVIDERS.find((provider) => provider.id === id) ?? pluginFormProvider(id);
}

export function providerName(id: string): string {
  if (id === "galley") return "Inbox";
  return providerInfo(id)?.name ?? id;
}
