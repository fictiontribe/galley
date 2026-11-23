import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useSite } from "@/lib/stores/site";
import { useSites } from "@/lib/stores/sites";
import { Icon, Logo, Skeleton } from "@/ui";
import { needsAttention } from "./logic";
import { QuickSwitcher } from "./QuickSwitcher";
import { useSiteSession } from "./session";

/**
 * The top of the sidebar inside a site: the site's name, opening the quick
 * switcher. It also carries the site's session (place memory, presence, waking
 * a paused preview) because it is on every screen of every site.
 */
export function SiteSwitcherButton() {
  const detail = useSite((s) => s.detail);
  // The route's site, not the store's: the store catches up a moment later.
  const { siteId = "" } = useParams();
  const waiting = useSites((s) => (s.sites ?? []).filter((site) => site.id !== siteId && needsAttention(site)).length);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useSiteSession(siteId);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="g-brand app-brand app-brand--switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        // The visible name first (so speech control finds it), then what the button does.
        aria-label={`${detail?.name ?? "This site"}, switch site`}
        title="Switch site"
        onClick={() => setOpen(!open)}
      >
        <Logo />
        <span className="g-brand__name app-nav__text">{detail?.name ?? <Skeleton width={110} height={14} />}</span>
        {waiting > 0 ? (
          <span className="sites-brand-dot app-nav__text" title={`${waiting} other ${waiting === 1 ? "site needs" : "sites need"} attention`}>
            <span className="g-sr">{`${waiting} other ${waiting === 1 ? "site needs" : "sites need"} attention`}</span>
          </span>
        ) : null}
        <Icon name="chevron-up-down" className="app-brand__chevron app-nav__text" />
      </button>
      <QuickSwitcher open={open} onClose={() => setOpen(false)} anchor={button} currentId={siteId} />
    </>
  );
}
