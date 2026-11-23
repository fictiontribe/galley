import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: ReactNode;
  /** Link target; the last crumb is the current page and never links. */
  to?: string;
}

export interface BreadcrumbsProps {
  items: Crumb[];
  className?: string;
}

/** "Pages › Home" — separator › with a space each side; the last item is the current page. */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={className ? `g-crumbs ${className}` : "g-crumbs"}>
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 ? (
              <span className="g-crumbs__sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            {last ? (
              <span aria-current="page">{item.label}</span>
            ) : item.to ? (
              <Link className="app-crumb-link" to={item.to}>
                {item.label}
              </Link>
            ) : (
              <span>{item.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
