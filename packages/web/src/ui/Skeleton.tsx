import type { CSSProperties } from "react";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Render n text lines (the last one shorter) instead of one block. */
  lines?: number;
  /** Pill-shaped (for buttons and tags). */
  pill?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Placeholder for layout-bearing content while it loads. Purely visual: put
 * `aria-busy` on the region that is loading.
 */
export function Skeleton({ width, height, lines, pill, className, style }: SkeletonProps) {
  const cls = `app-skeleton${pill ? " app-skeleton--pill" : ""}${className ? ` ${className}` : ""}`;
  if (lines && lines > 1) {
    return (
      <span className="app-skeleton-lines" aria-hidden="true" style={{ inlineSize: width, ...style }}>
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className={cls} style={{ inlineSize: index === lines - 1 ? "62%" : "100%", blockSize: height }} />
        ))}
      </span>
    );
  }
  return <span className={cls} aria-hidden="true" style={{ inlineSize: width, blockSize: height, ...style }} />;
}
