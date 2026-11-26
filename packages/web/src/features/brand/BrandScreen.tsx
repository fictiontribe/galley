/**
 * /sites/:siteId/brand — the site's look and voice, written down.
 *
 * States: loading · error · no brand yet (two ways in) · reading (the real
 * steps, cancellable, with what has been found so far) · the proposal under
 * review (questions first, then the sheet, then Save) · the saved brand
 * (the same sheet; any edit becomes a proposal again).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ApplyPlan, BrandFinding, BrandProposal, BrandQuestion, DriftReport, SiteBrandFile, SiteBrandState } from "@galley/core/sitebrand/types";
import { useTopBar } from "@/app/chrome";
import { api, buildUrl, isApiFailure } from "@/lib/api";
import { formatUsdAsCredits, useManagedAi } from "@/lib/credits";
import { download } from "@/lib/download";
import { notify } from "@/lib/stores/toasts";
import { useSite } from "@/lib/stores/site";
import { Badge, Button, Dialog, EmptyState, ErrorState, Icon, Input, Menu, Skeleton, Spinner, buttonClass } from "@/ui";
import "./brand.css";
import { Specimen } from "./Specimen";
import { SourceDrop, SourceList, Start, WebsiteField } from "./Start";
import { setBrandState, useBrandState, useMeasure, useProposalSaver } from "./useBrand";
import { ROLE_LABEL, whereFrom } from "./words";
import { count } from "@/lib/format";

function Progress({ state, measuring, onCancel }: { state: SiteBrandState; measuring: { path: string; index: number; total: number } | null | "starting"; onCancel: () => void }) {
  const analysis = state.analysis;
  const steps = analysis?.steps ?? [];
  const partial = analysis?.partial;

  return (
    <div className="brand-progress-view" role="status" aria-live="polite">
      <h2 className="brand-progress-view__title">{measuring ? "Measuring the site" : "Reading the brand"}</h2>
      <ol className="brand-steps">
        {measuring ? (
          <li className="brand-step brand-step--running">
            <Spinner label="Working" />
            <span>{measuring === "starting" ? "Starting the preview" : `Measuring ${measuring.path} — ${measuring.index + 1} of ${measuring.total}`}</span>
          </li>
        ) : (
          steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className={`brand-step brand-step--${step.state}`}>
              {step.state === "running" ? <Spinner label="Working" /> : step.state === "done" ? <Icon name="check" /> : step.state === "error" ? <Icon name="warning" /> : <span className="brand-step__dot" aria-hidden="true" />}
              <span className="brand-step__label">{step.label}</span>
              {step.detail ? <span className="brand-step__detail">{step.detail}</span> : null}
            </li>
          ))
        )}
      </ol>
      {partial?.colors?.length ? (
        <div className="brand-partial">
          <span className="g-eyebrow">Found so far</span>
          <ul className="brand-partial__swatches">
            {partial.colors.map((color) => (
              <li key={color.id}>
                <span style={{ background: color.value }} aria-hidden="true" />
                {ROLE_LABEL[color.role]} <code>{color.value}</code>
              </li>
            ))}
          </ul>
          {partial.typography?.fonts.length ? <p className="brand-partial__fonts">Fonts: {partial.typography.fonts.map((f) => f.family).join(", ")}</p> : null}
        </div>
      ) : null}
      <Button variant="secondary" onClick={onCancel}>
        Stop
      </Button>
    </div>
  );
}

function Questions({ questions, onAnswer }: { questions: BrandQuestion[]; onAnswer: (id: string, value: string) => void }) {
  const open = questions.filter((q) => !q.answer);

  if (!questions.length) return null;
  return (
    <section className="brand-questions" aria-labelledby="brand-questions-title">
      <h2 id="brand-questions-title" className="brand-questions__title">
        {open.length ? (open.length === 1 ? "1 question before saving" : `${open.length} questions before saving`) : "Questions answered"}
      </h2>
      <ul>
        {questions.map((question) => (
          <li key={question.id} className="brand-question">
            <p className="brand-question__text">{question.text}</p>
            <div className="brand-question__options" role="radiogroup" aria-label={question.text}>
              {question.options.map((option) => {
                const hex = /^#[0-9A-F]{6}$/i.test(option.value) ? option.value : null;

                return (
                  <button key={option.value} type="button" role="radio" aria-checked={question.answer === option.value} className={`brand-option${question.answer === option.value ? " brand-option--chosen" : ""}`} onClick={() => onAnswer(question.id, option.value)}>
                    {hex ? <span className="brand-option__chip" style={{ background: hex }} aria-hidden="true" /> : null}
                    <span className="brand-option__label">{option.label}</span>
                    {option.evidence.length ? <span className="brand-option__where">{whereFrom(option.evidence)}</span> : null}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Findings({ findings }: { findings: BrandFinding[] }) {
  const [all, setAll] = useState(false);

  if (!findings.length) return null;
  return (
    <section className="brand-findings" aria-label="Worth a look">
      <span className="g-eyebrow">Worth a look</span>
      <ul>
        {findings.slice(0, all ? 20 : 3).map((finding) => (
          <li key={finding.id} className={`brand-finding brand-finding--${finding.kind}`}>
            {finding.text}
            {finding.about?.filter((v) => /^#[0-9A-F]{6}$/i.test(v)).length ? (
              <span className="brand-logo__colors">
                {finding.about.filter((v) => /^#[0-9A-F]{6}$/i.test(v)).map((c) => (
                  <i key={c} style={{ background: c }} title={c} />
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {findings.length > 3 ? (
        <button type="button" className="app-link-button brand-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${findings.length - 3} more`}
        </button>
      ) : null}
    </section>
  );
}

function Ask({ siteId, onDone }: { siteId: string; onDone: (proposal: BrandProposal, reply: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="brand-ask"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setError(null);
        try {
          const result = await api("POST /api/sites/:siteId/brand/ask", { params: { siteId }, body: { text } });

          setReply(result.reply);
          setText("");
          onDone(result.proposal, result.reply);
        } catch (caught) {
          setError(isApiFailure(caught) ? caught.shape.message : "That change couldn't be made.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Icon name="chat" />
      <Input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask for a change… “make the accent warmer and check the contrast still passes”" aria-label="Ask for a change to the brand" maxLength={2000} disabled={busy} />
      <Button type="submit" size="sm" variant="secondary" busy={busy} busyLabel="Changing…" disabled={!text.trim()}>
        Ask
      </Button>
      {reply || error ? <p className={error ? "g-error-text brand-ask__reply" : "brand-ask__reply"}>{error ?? reply}</p> : null}
    </form>
  );
}

function ApplyDialog({ siteId, open, onClose }: { siteId: string; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  if (open && !loaded.current) {
    loaded.current = true;
    void api("GET /api/sites/:siteId/brand/apply", { params: { siteId } }).then(setPlan, setError);
  }
  const close = () => {
    loaded.current = false;
    setPlan(null);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Apply the brand to the site"
      description={plan ? `Changes ${plan.edits.length === 1 ? "1 value" : `${plan.edits.length} values`} in ${plan.file}. You'll see the site before and after in Proof.` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Not now
          </Button>
          <Button
            variant="primary"
            busy={busy}
            busyLabel="Applying…"
            disabled={!plan?.edits.length}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api("POST /api/sites/:siteId/brand/apply", { params: { siteId } });

                notify({ tone: "success", title: "Applied", body: `${count(result.plan.edits.length, "change")} to ${result.plan.file} ${result.plan.edits.length === 1 ? "is" : "are"} waiting in Proof.`, action: { label: "Open the proof", onClick: () => navigate(`/sites/${siteId}/proof`) } });
                close();
              } catch (caught) {
                setError(caught);
              } finally {
                setBusy(false);
              }
            }}
          >
            {plan?.edits.length ? `Apply ${plan.edits.length === 1 ? "1 change" : `${plan.edits.length} changes`}` : "Apply"}
          </Button>
        </>
      }
    >
      {error ? <ErrorState compact title="Couldn't plan the change" error={error} /> : null}
      {!plan && !error ? <Skeleton lines={4} /> : null}
      {plan ? (
        <div className="brand-apply">
          {plan.edits.length ? (
            <ul className="brand-apply__edits">
              {plan.edits.map((edit) => (
                <li key={edit.token}>
                  <span className="brand-apply__label">{edit.label}</span>
                  <code className="brand-apply__code">
                    <del className="g-del">{edit.before}</del>
                    <ins className="g-ins">{edit.after}</ins>
                  </code>
                  <span className="brand-apply__where">
                    {edit.token} · line {edit.line}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>The site already wears the brand: nothing to change.</p>
          )}
          {[...plan.warnings, ...plan.notes].map((line) => (
            <p key={line} className={plan.warnings.includes(line) ? "brand-apply__warning" : "brand-note"}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </Dialog>
  );
}

function DriftDialog({ report, onClose }: { report: DriftReport | null; onClose: () => void }) {
  return (
    <Dialog open={report !== null} onClose={onClose} title="Checked against the site" description={report ? `Measured ${report.pages.join(", ")}. ${report.matching} things match the brand.` : undefined} size="lg">
      {report ? (
        <div className="brand-drift">
          <h3 className="brand-subhead">On the site, not in the brand</h3>
          {report.unknown.length ? (
            <ul>
              {report.unknown.map((item) => (
                <li key={`${item.kind}-${item.value}`}>
                  {item.kind === "colour" ? <i className="brand-drift__chip" style={{ background: item.value }} /> : null}
                  <code>{item.value}</code> {item.kind === "colour" && item.area ? `· ${item.area}% of the page` : ""} · {item.where.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p>Nothing new: the pages use only the brand’s colours and fonts.</p>
          )}
          <h3 className="brand-subhead">In the brand, not seen on these pages</h3>
          {report.unused.length ? (
            <ul>
              {report.unused.map((item) => (
                <li key={`${item.kind}-${item.value}`}>
                  {item.kind === "colour" ? <i className="brand-drift__chip" style={{ background: item.value }} /> : null}
                  {item.name} <code>{item.value}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>Everything in the brand is in use.</p>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

export function BrandScreen() {
  const { siteId = "" } = useParams();
  const navigate = useNavigate();
  const { managed, creditMillicents } = useManagedAi();
  const query = useBrandState(siteId);
  const { measure, stop, progress, starting } = useMeasure(siteId);
  const [applyOpen, setApplyOpen] = useState(false);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<{ id: string; brand: SiteBrandFile } | null>(null);
  const importer = useRef<HTMLInputElement>(null);
  const saver = useProposalSaver(siteId, (next) => setBrandState(siteId, next));
  const state = query.data;

  useTopBar({ crumbs: [{ label: "Brand" }] });
  const refresh = () => void query.refetch();
  const readSite = async () => {
    const outcome = await measure();

    if (outcome.problem) notify({ tone: "warning", title: "Read from the code only", body: outcome.problem });
    try {
      await api("POST /api/sites/:siteId/brand/analyse", { params: { siteId }, body: { from: "site", ...(outcome.pages.length ? { measurements: outcome.pages } : {}) } });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn't read the brand", body: isApiFailure(caught) ? caught.shape.message : "Try again." });
    }
    refresh();
  };
  const readMaterial = async (sources?: string[]) => {
    try {
      await api("POST /api/sites/:siteId/brand/analyse", { params: { siteId }, body: { from: "material", ...(sources ? { sources } : {}) } });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn't read the material", body: isApiFailure(caught) ? caught.shape.message : "Try again." });
    }
    refresh();
  };

  // The first open after the app starts may come back before the site's fonts are scanned: ask again for them.
  const scanning = Boolean(state?.scanning);

  useEffect(() => {
    if (!scanning) return;
    const timer = window.setTimeout(() => void query.refetch(), 1500);

    return () => window.clearTimeout(timer);
  }, [scanning, state, query.refetch]);

  if (query.status === "error" && !state) return <div className="app-screen"><div className="app-screen__inner"><ErrorState title="Couldn't open the brand" error={query.error} onRetry={refresh} /></div></div>;
  if (!state) {
    // The heading straight away, so the screen is plainly the Brand screen while the brand is read.
    return (
      <div className="app-screen brand-screen" aria-busy="true">
        <div className="app-screen__inner">
          <header className="app-page-header">
            <div className="app-page-header__text">
              <h1 className="app-page-header__title">Brand</h1>
              <p className="app-page-header__description brand-loading" role="status">
                <Spinner label="Loading" /> Opening the brand…
              </p>
            </div>
          </header>
          <div className="brand-swatches brand-swatches--skeleton">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={200} />
            ))}
          </div>
        </div>
      </div>
    );
  }
  const measuring = starting ? ("starting" as const) : progress;
  const running = measuring !== null || state.analysis?.state === "running";
  const proposal = state.proposal;
  // New material to read, whether or not a proposal is open (older servers only report it inside a proposal).
  const unread = (state.unread ?? proposal?.pendingSources ?? []).filter((id) => state.sources.some((source) => source.id === id && !source.ignored));
  const shown: SiteBrandFile | null = proposal?.brand ?? state.brand;
  const brand = local && local.id === (proposal?.id ?? "saved") ? local.brand : shown;
  const edit = (next: SiteBrandFile) => {
    setLocal({ id: proposal?.id ?? "saved", brand: next });
    saver.save(next);
  };
  const header = (
    <header className="app-page-header">
      <div className="app-page-header__text">
        <h1 className="app-page-header__title">Brand</h1>
        <p className="app-page-header__description">
          {proposal
            ? `A proposal ${proposal.from === "site" ? "read from the site" : proposal.from === "both" ? "from the site and your material" : "from your material"}. Check it, answer any questions, then save it.`
            : state.brand
              ? "The site’s look and voice. The assistant works inside it."
              : "The site’s look and voice, written down."}
        </p>
      </div>
      {brand && !running ? (
        <div className="app-page-header__actions">
          <Button
            variant="secondary"
            busy={checking}
            busyLabel="Measuring…"
            onClick={async () => {
              setChecking(true);
              try {
                const outcome = await measure();

                if (!outcome.pages.length) {
                  notify({ tone: "warning", title: "Couldn't check against the site", body: outcome.problem ?? "Try again." });
                  return;
                }
                setDrift(await api("POST /api/sites/:siteId/brand/drift", { params: { siteId }, body: { measurements: outcome.pages } }));
              } catch (caught) {
                notify({ tone: "danger", title: "Couldn't check against the site", body: isApiFailure(caught) ? caught.shape.message : "Try again." });
              } finally {
                setChecking(false);
              }
            }}
          >
            Check against the site
          </Button>
          {state.settings.tokensFile ? (
            <Button variant="secondary" onClick={() => setApplyOpen(true)}>
              Apply to the site
            </Button>
          ) : null}
          <Menu
            label="Export"
            items={[
              { id: "bundle", label: "Brand file (for another site)", icon: "download", onSelect: () => download(buildUrl("GET /api/sites/:siteId/brand/export", { siteId }, { format: "brand" })) },
              { id: "tokens", label: "Design tokens (W3C format)", icon: "download", onSelect: () => download(buildUrl("GET /api/sites/:siteId/brand/export", { siteId }, { format: "tokens" })) },
              { kind: "separator", id: "s" },
              { id: "import", label: "Import a brand…", icon: "upload", onSelect: () => importer.current?.click() },
            ]}
            trigger={(props) => (
              <button type="button" className={buttonClass("secondary", "md")} {...props}>
                Export
                <Icon name="chevron-down" />
              </button>
            )}
          />
        </div>
      ) : null}
      <input
        ref={importer}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];

          event.target.value = "";
          if (!file) return;
          try {
            await api("POST /api/sites/:siteId/brand/import", { params: { siteId }, body: { bundle: JSON.parse(await file.text()) } });
            refresh();
          } catch (caught) {
            notify({ tone: "danger", title: "Couldn't import that brand", body: isApiFailure(caught) ? caught.shape.message : "It isn't a brand file." });
          }
        }}
      />
    </header>
  );

  return (
    <div className="app-screen brand-screen">
      <div className="app-screen__inner">
        {header}
        {running ? (
          <Progress
            state={state}
            measuring={measuring}
            onCancel={() => {
              stop();
              void api("POST /api/sites/:siteId/brand/cancel", { params: { siteId } }).then(refresh);
            }}
          />
        ) : null}
        {!running && state.analysis?.state === "error" && !proposal ? <ErrorState compact title="Couldn't read the brand" message={state.analysis.error ?? "Try again."} onRetry={() => void (state.sources.length ? readMaterial() : readSite())} /> : null}
        {!running && !brand ? <Start siteId={siteId} state={state} onReadSite={() => void readSite()} onReadMaterial={() => void readMaterial()} onChange={refresh} /> : null}
        {!running && brand ? (
          <>
            {proposal ? (
              <div className="brand-review" role="region" aria-label="Review the proposal">
                <div className="brand-review__text">
                  <strong>Nothing is saved yet.</strong> Saving writes the brand into the site as changes you can check in Proof.
                  {proposal.cost !== null ? (
                    <span className="brand-review__cost">
                      {managed
                        ? ` Reading it used about ${formatUsdAsCredits(proposal.cost, creditMillicents)}.`
                        : ` Reading it cost about $${proposal.cost.toFixed(2)}.`}
                    </span>
                  ) : null}
                </div>
                <Button
                  variant="quiet"
                  onClick={async () => {
                    await api("DELETE /api/sites/:siteId/brand/proposal", { params: { siteId } });
                    setLocal(null);
                    refresh();
                  }}
                >
                  Discard
                </Button>
                <Button
                  variant="primary"
                  busy={saving}
                  busyLabel="Saving…"
                  disabled={proposal.questions.some((q) => !q.answer) || saver.saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const result = await api("POST /api/sites/:siteId/brand/save", { params: { siteId } });

                      setLocal(null);
                      notify({ tone: "success", title: "Brand saved", body: `${count(result.paths.length, "file")} ${result.paths.length === 1 ? "is" : "are"} waiting in Proof. Publish to keep ${result.paths.length === 1 ? "it" : "them"}.`, action: { label: "Open the proof", onClick: () => navigate(`/sites/${siteId}/proof`) } });
                      refresh();
                    } catch (caught) {
                      notify({ tone: "danger", title: "Couldn't save the brand", body: isApiFailure(caught) ? caught.shape.message : "Try again." });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Save the brand
                </Button>
              </div>
            ) : null}
            {proposal ? <Questions questions={proposal.questions} onAnswer={(id, value) => brand && saver.save(brand, { [id]: value })} /> : null}
            {unread.length ? (
              <div className="brand-new">
                <span>{unread.length === 1 ? "1 new file to read" : `${unread.length} new files to read`}</span>
                <Button size="sm" variant="secondary" onClick={() => void readMaterial(unread)}>
                  Read {unread.length === 1 ? "it" : "them"}
                </Button>
              </div>
            ) : null}
            {state.assistant ? <Ask siteId={siteId} onDone={() => refresh()} /> : null}
            <Findings findings={proposal?.findings ?? []} />
            {saver.error ? <p className="g-error-text">That change couldn't be kept: {isApiFailure(saver.error) ? saver.error.shape.message : "try again."}</p> : null}
            <Specimen siteId={siteId} state={state} brand={brand} onChange={edit} editable />
            <section className="brand-band brand-band--material" aria-labelledby="brand-material">
              <header className="brand-band__label">
                <h2 id="brand-material" className="brand-band__title">
                  Material
                </h2>
              </header>
              <div className="brand-band__body">
                {state.sources.length ? <SourceList siteId={siteId} sources={state.sources} staged={state.staged} settings={state.settings} onChange={refresh} /> : <p className="brand-note">Nothing added. Guidelines, logos and screenshots can be added any time; their findings come back here to review.</p>}
                <SourceDrop siteId={siteId} onAdded={refresh} compact />
                <WebsiteField siteId={siteId} onAdded={refresh} />
              </div>
            </section>
            {state.digest ? (
              <details className="brand-digest">
                <summary>
                  <span className="g-eyebrow">Used by the assistant</span> What it is told about the brand, word for word
                </summary>
                <pre>{state.digest}</pre>
              </details>
            ) : null}
            {state.pending.length ? (
              <p className="brand-pending-note">
                <Badge tone="change">Unpublished</Badge> The brand’s files have changes waiting.{" "}
                <Link className="g-link" to={`/sites/${siteId}/proof`}>
                  Open the proof
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
        {!running && !brand && !state.sources.length && state.problem ? <EmptyState compact title="The brand file can't be read." body={state.problem} /> : null}
      </div>
      <ApplyDialog siteId={siteId} open={applyOpen} onClose={() => setApplyOpen(false)} />
      <DriftDialog report={drift} onClose={() => setDrift(null)} />
    </div>
  );
}
