/** Pieces the account screens share: a settings-style section, and a one-time link shown once. */
import type { ReactNode } from "react";
import type { OneTimeLink } from "@galley/core/install/accounts";
import { absoluteTime } from "@/lib/format";
import { Button, ProofMark } from "@/ui";
import { copyText } from "@/features/deploy/parts";
import { timeLeft } from "./logic";

export function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="app-settings__section" id={id} aria-labelledby={`${id}-title`}>
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id={`${id}-title`}>
          {title}
        </h2>
        {description ? <p className="app-settings__section-text">{description}</p> : null}
      </header>
      <div className="app-settings__section-body">{children}</div>
    </section>
  );
}

/**
 * A one-time link, shown the once it exists: the address to send, Copy, when
 * it stops working, and whether it was e-mailed too. The server keeps only
 * its hash, so it is never shown again.
 */
export function LinkOnce({ link, who, again }: { link: OneTimeLink; who: string; again: string }) {
  return (
    <div className="accounts-link" role="status">
      <p className="accounts-link__lede">
        {link.emailed ? `This link was e-mailed to ${who}. You can also send it yourself:` : `Send this link to ${who} yourself — by e-mail, chat, however you like:`}
      </p>
      <div className="accounts-link__row">
        <input className="accounts-link__url g-mono" readOnly value={link.url} aria-label="The link" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
        <Button size="sm" variant="secondary" icon="copy" onClick={() => copyText(link.url, "Link")}>
          Copy link
        </Button>
      </div>
      <p className="accounts-link__note">
        <ProofMark kind="bang" />
        <span title={absoluteTime(link.expiresAt)}>{`It works once, and stops working ${timeLeft(link.expiresAt)}. It isn’t shown again: ${again}`}</span>
      </p>
    </div>
  );
}
