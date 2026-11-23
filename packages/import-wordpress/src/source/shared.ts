/**
 * What both sources agree on: which content types are WordPress's own
 * plumbing, which ones signal a feature a static site doesn't have, and how
 * slugs and dates are normalised.
 */
import type { WordPressStatus } from "../types";

/** Types that are WordPress's own machinery, never content to import or offer. */
export const INTERNAL_TYPES = new Set([
  "attachment",
  "revision",
  "nav_menu_item",
  "custom_css",
  "customize_changeset",
  "oembed_cache",
  "user_request",
  "wp_block",
  "wp_template",
  "wp_template_part",
  "wp_global_styles",
  "wp_navigation",
  "wp_font_family",
  "wp_font_face",
  "elementor_library",
  "elementor_font",
  "elementor_icons",
  "elementor_snippet",
  "e-landing-page",
  "et_pb_layout",
  "et_template",
  "et_header_layout",
  "et_body_layout",
  "et_footer_layout",
  "fl-builder-template",
  "vc_grid_item",
  "acf-field-group",
  "acf-field",
  "acf-post-type",
  "acf-taxonomy",
  "wpcf7_contact_form",
  "wpforms",
  "shop_order",
  "shop_order_refund",
  "shop_coupon",
  "shop_webhook",
  "product_variation",
  "scheduled-action",
  "jp_pay_order",
  "jp_pay_product",
  "feedback",
  "wp_privacy_request",
]);

/** Content types whose presence means a feature that needs a person's decision. */
export const FEATURE_TYPES: Record<string, string> = {
  product: "woocommerce",
  shop_order: "woocommerce",
  download: "e-commerce",
  wpcf7_contact_form: "contact-form-7",
  wpforms: "wpforms",
  tribe_events: "events",
  memberpressproduct: "membership",
  pmpro_membership: "membership",
  forum: "forums",
  topic: "forums",
};

/** REST namespaces that tell what plugins a site runs. */
export const FEATURE_NAMESPACES: Array<[RegExp, string]> = [
  [/^wc\//, "woocommerce"],
  [/^contact-form-7\//, "contact-form-7"],
  [/^wpforms\//, "wpforms"],
  [/^gf\//, "gravity-forms"],
  [/^tribe\/events/, "events"],
  [/^wpml\//, "wpml"],
  [/^pll\//, "polylang"],
  [/^yoast\//, "yoast"],
  [/^rankmath\//, "rank-math"],
  [/^aioseo\//, "aioseo"],
  [/^elementor\//, "elementor"],
  [/^mp\//, "membership"],
  [/^pmpro\//, "membership"],
  [/^jetpack\//, "jetpack"],
];

/** WordPress stores non-ASCII slugs percent-encoded. */
export function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function normalizeStatus(value: string | undefined): WordPressStatus {
  const status = (value ?? "").trim();

  return (["publish", "draft", "pending", "private", "future", "trash", "inherit", "auto-draft"] as const).find((known) => known === status) ?? "draft";
}

/** "2024-05-03 09:15:00" (GMT) → ISO; the local date when GMT is unset (drafts carry 0000-00-00). */
export function isoDate(local: string | undefined, gmt: string | undefined): string {
  const g = (gmt ?? "").trim();

  if (g && !g.startsWith("0000")) return `${g.replace(" ", "T").replace(/Z?$/, "")}Z`.replace(/(T\d\d:\d\d:\d\d)\.\d+Z$/, "$1Z");
  return (local ?? "").trim().replace(" ", "T");
}

export function isAfter(item: { date: string; modified?: string }, since: string | undefined): boolean {
  if (!since) return true;
  const threshold = Date.parse(since);

  if (Number.isNaN(threshold)) return true;
  const latest = Math.max(Date.parse(item.date) || 0, Date.parse(item.modified ?? "") || 0);

  return latest >= threshold;
}
