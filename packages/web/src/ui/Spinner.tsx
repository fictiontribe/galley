export interface SpinnerProps {
  /** What is happening, for screen readers. */
  label?: string;
  className?: string;
}

/** The working mark: stet dots — "let it stand", wait for it. */
export function Spinner({ label = "Working", className }: SpinnerProps) {
  return (
    <span className={className ? `g-dots ${className}` : "g-dots"} role="img" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
