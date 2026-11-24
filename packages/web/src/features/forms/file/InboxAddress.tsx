/**
 * "Where should the live site send submissions?" — one step on the Forms
 * screen while a form sends to the inbox and the site kit's settings name no
 * address. Visitors' browsers must be able to reach the address, so it is
 * offered only when they can; on a computer of one's own the screen says
 * so, and what the choices are. (The preview needs none of this: it is
 * handed the address as each page loads.)
 */
import type { SiteKitStatus } from "@galley/core/api";
import { errorShape } from "@/lib/api";
import { useHostedInstall, useMeta } from "@/lib/stores/meta";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { Button, ProofMark } from "@/ui";
import { useState } from "react";
import { editorAddress } from "@/features/inbox/reach";
import { docsPage } from "../logic/locate";
import { setInboxAddress, useKitStatus } from "./kit";
import { useWhoPublishes } from "@/lib/may";

/** Whether the step is needed: a form uses the inbox, the kit is there, and its settings name no address. */
export function needsInboxAddress(status: SiteKitStatus | undefined): boolean {
  return Boolean(status?.kit && status.inbox.used && !status.inbox.endpoint);
}

export function InboxAddressStep() {
  const siteId = useSite((s) => s.detail?.id ?? "");
  const docsUrl = useMeta((s) => s.meta?.brand.docsUrl);
  const status = useKitStatus(siteId);
  const hosted = useHostedInstall();
  const publishes = useWhoPublishes();
  const [busy, setBusy] = useState(false);
  const kit = status.data;
  if (!kit || !needsInboxAddress(kit)) return null;
  const { inbox } = kit;
  const docs = docsPage(docsUrl, "forms");
  const use = async () => {
    setBusy(true);
    try {
      await setInboxAddress(siteId);
      notify({ tone: "neutral", title: "The inbox address is set", body: `The live site sends its forms here once ${publishes}. It’s waiting in Proof.` });
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t set the inbox address", body: errorShape(error).message });
    } finally {
      setBusy(false);
    }
  };
  let body;
  if (!inbox.settable) {
    body = (
      <p className="kit-callout__body">
        This site uses the site kit as a package, so the address goes in its <span className="g-mono">astro.config</span>: set the kit’s <span className="g-mono">forms.endpoint</span> to{" "}
        <span className="g-mono">{inbox.address}</span>.
      </p>
    );
  } else if (inbox.reachable && inbox.address) {
    body = (
      <>
        <p className="kit-callout__body">
          Visitors’ browsers can reach this app’s inbox at <span className="g-mono">{inbox.address}</span>. Set it, and the live site sends its forms there once {publishes}.
        </p>
        <div className="kit-callout__actions">
          <Button size="sm" variant="primary" busy={busy} busyLabel="Setting…" onClick={() => void use()}>
            Send them to this inbox
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className="kit-callout__body">
          {hosted ? (
            <>
              This editor’s address{inbox.address ? <>, <span className="g-mono">{editorAddress(inbox.address)}</span>,</> : null} isn’t one visitors’ browsers can reach, so the live site can’t send its forms here. In the preview, forms still send here, so you can test them. For the live site, give the editor a public address, or send each form somewhere else under “Where it goes” — a webhook, HubSpot or another service.
            </>
          ) : (
            <>
              This app runs on this computer, so visitors’ browsers can’t reach its inbox. In the preview, forms still send here, so you can test them. For the live site, run this app on a server with a public address, or send each form somewhere else under “Where it goes” — a webhook, HubSpot or another service.
            </>
          )}
        </p>
        {docs ? (
          <div className="kit-callout__actions">
            <a className="g-link" href={docs} target="_blank" rel="noreferrer">
              How the inbox reaches the live site
            </a>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <div className="kit-callout" role="note">
      <ProofMark kind="bang" className="kit-callout__mark" />
      <div className="kit-callout__main">
        <p className="kit-callout__title">Where should the live site send submissions?</p>
        {body}
      </div>
    </div>
  );
}
