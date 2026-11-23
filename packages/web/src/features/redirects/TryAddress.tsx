/** "Try an address": type an old address, see where a visitor ends up and through which redirects. */
import { useState, type FormEvent } from "react";
import type { RedirectTrace } from "@galley/core/redirects-info";
import { api, errorShape } from "@/lib/api";
import { Button, Input, ProofMark } from "@/ui";
import { kindWord } from "./words";

function Outcome({ trace }: { trace: RedirectTrace }) {
  if (trace.otherDomain) {
    return (
      <p className="redir-try__line">
        <span className="g-mono">{trace.otherDomain}</span> isn’t this site’s address, so this site’s redirects never see it.
      </p>
    );
  }
  if (trace.hops.length === 0) {
    return (
      <div className="redir-try__result">
        <p className="redir-try__line">
          {trace.finalKind === "page" ? (
            <>
              No redirect: <span className="g-mono">{trace.path}</span> is the page “{trace.finalTitle}”.
            </>
          ) : trace.finalKind === "file" ? (
            <>
              No redirect: <span className="g-mono">{trace.path}</span> is a file on the site.
            </>
          ) : (
            <>
              No redirect, and nothing is at <span className="g-mono">{trace.path}</span>: visitors see the missing-page page.
            </>
          )}
        </p>
        {trace.nearMiss ? (
          <p className="redir-try__note">
            There is one for <span className="g-mono">{trace.nearMiss}</span>, which differs only by the trailing slash or capitals. Most hosts treat those as different addresses.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="redir-try__result">
      <ol className="redir-try__hops">
        {trace.hops.map((hop, index) => (
          <li key={`${index}:${hop.from}`}>
            <span className="g-mono">{hop.from}</span>
            <span className="redir-arrow" aria-label="goes to">
              →
            </span>
            <span className="g-mono">{hop.to}</span>
            <span className="redir-kind">
              {kindWord(hop.status)} <span className="redir-kind__code g-mono">{hop.status}</span>
            </span>
          </li>
        ))}
      </ol>
      {trace.loop ? (
        <p className="redir-try__line redir-try__line--danger">
          <ProofMark kind="bang" /> This goes round in a circle: visitors never arrive anywhere.
        </p>
      ) : trace.finalKind === "external" ? (
        <p className="redir-try__line">
          Ends on another site: <span className="g-mono">{trace.final}</span>
        </p>
      ) : trace.finalKind === "page" ? (
        <p className="redir-try__line redir-try__line--ok">
          <ProofMark kind="reg" /> Ends on “{trace.finalTitle}”, <span className="g-mono">{trace.final}</span>
          {trace.hops.length > 1 ? `, after ${trace.hops.length} steps.` : "."}
        </p>
      ) : trace.finalKind === "file" ? (
        <p className="redir-try__line redir-try__line--ok">
          Ends on the file <span className="g-mono">{trace.final}</span>.
        </p>
      ) : (
        <p className="redir-try__line redir-try__line--danger">
          <ProofMark kind="bang" /> Ends at <span className="g-mono">{trace.final}</span>, where nothing is: visitors see the missing-page page.
        </p>
      )}
    </div>
  );
}

export function TryAddress({ siteId }: { siteId: string }) {
  const [address, setAddress] = useState("");
  const [trace, setTrace] = useState<RedirectTrace | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    try {
      setTrace(await api("POST /api/sites/:siteId/redirects/try", { params: { siteId }, body: { address } }));
      setProblem(null);
    } catch (error) {
      setProblem(errorShape(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="app-card app-card--pad redir-panel" aria-labelledby="redir-try-title">
      <h2 id="redir-try-title" className="redir-panel__title">
        Try an address
      </h2>
      <form className="redir-try__form" onSubmit={(event) => void submit(event)}>
        <Input size="sm" mono value={address} placeholder="/an-old-page/" aria-label="An old address" onChange={(event) => setAddress(event.target.value)} />
        <Button size="sm" variant="secondary" type="submit" busy={busy} busyLabel="Trying…">
          Try
        </Button>
      </form>
      {problem ? <p className="redir-try__line redir-try__line--danger">{problem}</p> : trace ? <Outcome trace={trace} /> : <p className="g-hint">See exactly where a visitor who types it ends up.</p>}
    </section>
  );
}
