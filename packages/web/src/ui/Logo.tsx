import { useMeta } from "@/lib/stores/meta";
import { cx } from "./cx";

export interface LogoProps {
  className?: string;
}

/**
 * The brand mark in the fixed 20 px logo slot. A deployment's
 * `brand.logoUrl` replaces it; otherwise the built-in mark is drawn inline
 * (geometry of brand/logo/mark.svg) so it follows the theme and the accent.
 */
export function Logo({ className }: LogoProps) {
  const logoUrl = useMeta((s) => s.meta?.brand.logoUrl);
  if (logoUrl) return <img className={cx("g-brand__logo", className)} src={logoUrl} alt="" />;
  return (
    <svg className={cx("g-brand__logo app-logo", className)} viewBox="0 0 32 32" width="20" height="20" aria-hidden="true" focusable="false">
      <path className="app-logo__bars" d="M2 6h28v4H2zM2 14h10v4H2zM20 14h10v4H20z" />
      <path className="app-logo__caret" d="M8.76 24.24 16 15.33l7.24 8.91-3.1 2.52L16 21.67l-4.14 5.09z" />
    </svg>
  );
}
