import { Link } from "react-router-dom";
import { useSites } from "@/lib/stores/sites";
import { ProofMark } from "@/ui";
import { counted, needsAttention } from "./logic";

/**
 * The status bar's quiet "3 sites need attention", on every screen, leading
 * to the Sites screen showing just those. Nothing at all when nothing waits.
 */
export function AttentionIndicator() {
  const count = useSites((s) => (s.sites ?? []).filter(needsAttention).length);
  if (count === 0) return null;
  return (
    <Link to="/?attention=1" className="g-statusbar__item sites-indicator" title="Open the Sites screen showing only the sites with something waiting">
      <ProofMark kind="bang" />
      {counted(count, "site")} {count === 1 ? "needs" : "need"} attention
    </Link>
  );
}
