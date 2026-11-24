import type { ReactNode, RefObject } from "react";
import type { SetupStatus } from "@galley/core/install/types";

export interface StepProps {
  status: SetupStatus;
  onStatus: (status: SetupStatus) => void;
  heading: RefObject<HTMLHeadingElement | null>;
}

/** A first-run screen's heading (focused when the screen changes) and one plain sentence under it. */
export function StepHead({ heading, title, lede }: { heading: RefObject<HTMLHeadingElement | null>; title: string; lede: ReactNode }) {
  return (
    <header className="wizard-head">
      <h1 ref={heading} tabIndex={-1} className="wizard-title">
        {title}
      </h1>
      <p className="wizard-lede">{lede}</p>
    </header>
  );
}
