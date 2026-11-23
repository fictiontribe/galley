import type { ReactNode } from "react";
import { cx } from "./cx";

export interface PageHeaderProps {
  /** Mono label above the title: a section number, a framework, a path. */
  eyebrow?: ReactNode;
  /** The screen's title (display face). */
  title: ReactNode;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons on the right. One primary at most. */
  actions?: ReactNode;
  className?: string;
}

/** The head of a full-width screen (Sites, Version history, Settings). */
export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cx("app-page-header", className)}>
      <div className="app-page-header__text">
        {eyebrow ? <p className="g-eyebrow">{eyebrow}</p> : null}
        <h1 className="app-page-header__title">{title}</h1>
        {description ? <p className="app-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="app-page-header__actions">{actions}</div> : null}
    </header>
  );
}
