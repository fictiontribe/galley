/**
 * The sidebar's unread count for the inbox. Mounted for as long as a site is
 * open, so it also keeps the inbox fresh when submissions arrive.
 */
import { count } from "@/lib/format";
import { Count } from "@/ui";
import { useInboxForms, useInboxLive } from "./data";

export function InboxNavBadge({ siteId }: { siteId: string }) {
  useInboxLive(siteId);
  const forms = useInboxForms(siteId);
  const unread = forms.data?.unread ?? 0;
  if (unread === 0) return null;
  return (
    <span className="app-nav__count">
      <Count value={unread} label={count(unread, "unread submission")} />
    </span>
  );
}
