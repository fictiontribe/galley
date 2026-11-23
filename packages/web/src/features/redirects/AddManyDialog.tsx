/**
 * "Add many": paste a list or drop a file, and see straight away what was
 * understood — the format, how many, a preview — with the problems in
 * groups and one choice each. Nothing is added until the person confirms;
 * then it lands as one pending change. Every choice re-asks the server, so
 * what is confirmed is exactly what was reviewed.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { ImportProblem, ImportResolutions, ImportReview, RedirectImportSource, RedirectsOverview } from "@galley/core/redirects-info";
import { api, errorShape } from "@/lib/api";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, Dialog, ErrorState, Icon, ProofMark, SegmentedControl, Spinner, Textarea, cx } from "@/ui";
import { setOverview } from "./data";
import { kindWord, newAddressParts, oldAddressParts, redirectsCount } from "./words";

const EXAMPLE = "/old-page/, /new-page/\n/2019/05/notes/  /blog/notes/  301\nhttps://www.example.com/team/  /about/";

interface Input {
  text?: string;
  path?: string;
  filename?: string;
  label?: string;
}

function ProblemGroup({ problem, onResolve }: { problem: ImportProblem; onResolve: (key: keyof ImportResolutions, value: string) => void }) {
  const [open, setOpen] = useState(problem.severity === "error");
  const tone = problem.severity === "error" ? "danger" : problem.severity === "warning" ? "warning" : "info";

  return (
    <li className={`redir-problem redir-problem--${tone}`}>
      <div className="redir-problem__head">
        <ProofMark kind={problem.severity === "info" ? "stet" : "bang"} className="redir-problem__mark" />
        <div className="redir-problem__text">
          <p className="redir-problem__title">{problem.title}</p>
          <p className="redir-problem__body">{problem.body}</p>
        </div>
      </div>
      <div className="redir-problem__resolve">
        {problem.resolution && problem.resolution.options.length > 1 ? (
          <SegmentedControl label={problem.title} value={problem.resolution.value} options={problem.resolution.options} onChange={(value) => onResolve(problem.resolution!.key, value)} />
        ) : problem.resolution?.options.length === 1 && problem.resolution.value !== problem.resolution.options[0]!.value ? (
          <Button size="sm" variant={problem.severity === "error" ? "primary" : "secondary"} onClick={() => onResolve(problem.resolution!.key, problem.resolution!.options[0]!.value)}>
            {problem.resolution.options[0]!.label}
          </Button>
        ) : problem.resolution?.options.length === 1 ? (
          <Badge tone="neutral" mark={null}>
            {problem.resolution.options[0]!.label}
          </Badge>
        ) : null}
      </div>
      {problem.examples.length ? (
        <>
          <button type="button" className="app-link-button redir-problem__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide them" : problem.count > problem.examples.length ? `Show the first ${problem.examples.length}` : "Show them"}
          </button>
          {open ? (
            <ul className="redir-problem__examples">
              {problem.examples.map((example, index) => (
                <li key={`${example.line ?? index}:${example.from}`}>
                  {example.line !== undefined ? <span className="redir-problem__line g-mono">{`Line ${example.line}`}</span> : null}
                  <span className="g-mono redir-problem__from">{example.from}</span>
                  {example.to ? <span className="g-mono g-faint">{` → ${example.to}`}</span> : null}
                  {example.detail ? <span className="redir-problem__detail">{example.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function Preview({ review }: { review: ImportReview }) {
  const rows = review.preview.filter((row) => row.state !== "same").slice(0, 200);

  if (!rows.length) return null;
  return (
    <div className="redir-preview">
      <p className="g-eyebrow">What will be added</p>
      <div className="redir-preview__table" role="table" aria-label="Redirects to be added">
        {rows.map((row) => {
          const from = oldAddressParts(row.from);
          const to = newAddressParts(row.to);

          return (
            <div key={row.from} role="row" className="redir-preview__row">
              <span role="cell">{row.state === "new" ? <Badge tone="insert">New</Badge> : <Badge tone="change">Changed</Badge>}</span>
              <span role="cell" className="redir-cell" title={row.from}>
                {from.lead ? <span className="redir-address__lead">{from.lead} </span> : null}
                <span className="g-mono">{from.path}</span>
              </span>
              <span role="cell" className="redir-arrow" aria-label="goes to">
                →
              </span>
              <span role="cell" className="redir-cell" title={row.to}>
                <span className="g-mono">{to.path}</span>
                {to.tail ? <span className="redir-address__lead"> {to.tail}</span> : null}
              </span>
              <span role="cell" className="redir-kind">
                {kindWord(row.status)} <span className="redir-kind__code g-mono">{row.status}</span>
              </span>
            </div>
          );
        })}
      </div>
      {review.counts.add + review.counts.change > rows.length ? <p className="g-hint">{`And ${(review.counts.add + review.counts.change - rows.length).toLocaleString()} more.`}</p> : null}
    </div>
  );
}

export interface AddManyDialogProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  overview: RedirectsOverview;
  /** Open straight on a file in the site (the WordPress import's list). */
  start?: RedirectImportSource | null;
}

export function AddManyDialog({ siteId, open, onClose, overview, start }: AddManyDialogProps) {
  const [input, setInput] = useState<Input>({ text: "" });
  const [mode, setMode] = useState<"add" | "replace">("add");
  const [resolutions, setResolutions] = useState<ImportResolutions>({});
  const [siteHosts, setSiteHosts] = useState<string[]>([]);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const asked = useRef(0);

  useEffect(() => {
    if (!open) return;
    setInput(start ? { path: start.path, label: start.label } : { text: "" });
    setMode("add");
    setResolutions({});
    setSiteHosts([]);
    setReview(null);
    setError(null);
  }, [open, start]);

  const body = () => ({ ...(input.path ? { path: input.path } : { text: input.text ?? "" }), ...(input.filename ? { filename: input.filename } : {}), mode, resolutions, ...(siteHosts.length ? { siteHosts } : {}) });

  // Ask again whenever the input or a choice changes; only the newest answer counts.
  useEffect(() => {
    if (!open) return;
    if (!input.path && !(input.text ?? "").trim()) {
      setReview(null);
      return;
    }
    const ticket = ++asked.current;
    const timer = setTimeout(
      () => {
        setChecking(true);
        api("POST /api/sites/:siteId/redirects/review", { params: { siteId }, body: body() })
          .then((result) => {
            if (ticket !== asked.current) return;
            setReview(result);
            setError(null);
          })
          .catch((caught: unknown) => {
            if (ticket === asked.current) setError(caught);
          })
          .finally(() => {
            if (ticket === asked.current) setChecking(false);
          });
      },
      input.path ? 0 : 350
    );

    return () => clearTimeout(timer);
    // body() reads exactly these.
  }, [open, input, mode, resolutions, siteHosts, siteId]);

  const readFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setError(new Error("That file is larger than 20 MB. Split it into smaller files."));
      return;
    }
    setInput({ text: await file.text(), filename: file.name, label: file.name });
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];

    if (file) void readFile(file);
  };
  const confirm = async () => {
    if (!review) return;
    setAdding(true);
    try {
      const result = await api("POST /api/sites/:siteId/redirects/import", { params: { siteId }, body: { ...body(), baseHash: overview.hash } });

      setOverview(siteId, result.overview);
      const added = result.review.counts.add + result.review.counts.change;

      notify({ tone: "success", title: added === 1 ? "1 redirect added" : `${added.toLocaleString()} redirects added`, body: "They’re one change in Proof, with the host’s file updated beside them." });
      onClose();
    } catch (caught) {
      const shape = errorShape(caught);

      notify({ tone: "danger", title: "Couldn’t add the redirects", body: shape.message, detail: shape.detail });
    } finally {
      setAdding(false);
    }
  };

  const adds = review ? review.counts.add + review.counts.change : 0;
  const blocked = Boolean(review && review.blocking > 0);
  const empty = !input.path && !(input.text ?? "").trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Add many redirects"
      description="Paste a list, or drop a file: a spreadsheet, a _redirects file, .htaccess or nginx lines, a Cloudflare list. Nothing is added until you confirm."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button variant="primary" busy={adding} busyLabel="Adding…" disabled={!review || adds === 0 || blocked || checking} onClick={() => void confirm()}>
            {review && adds > 0 ? `Add ${redirectsCount(adds)}` : "Add redirects"}
          </Button>
        </>
      }
    >
      <div className="redir-many">
        <div className="redir-many__source">
          {input.path || input.filename ? (
            <div className="redir-many__file">
              <Icon name="page" />
              <span>{input.label ?? input.filename ?? input.path}</span>
              <Button size="sm" variant="quiet" onClick={() => setInput({ text: "" })}>
                Paste instead
              </Button>
            </div>
          ) : (
            <div className={cx("redir-many__drop", dragging && "redir-many__drop--on")} onDragOver={(event) => (event.preventDefault(), setDragging(true))} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <Textarea mono rows={7} maxRows={14} value={input.text ?? ""} placeholder={EXAMPLE} aria-label="Redirects to add, one per line" onChange={(event) => setInput({ text: event.target.value })} data-autofocus />
              <div className="redir-many__actions">
                <Button size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>
                  Choose a file…
                </Button>
                <span className="g-hint">or drop it here</span>
                <input ref={fileInput} type="file" hidden accept=".csv,.tsv,.txt,.json,.conf,.htaccess,.mjs,text/*" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} />
              </div>
            </div>
          )}
          {overview.imports.length && !input.path ? (
            <div className="redir-many__offers">
              {overview.imports.map((source) => (
                <Button key={source.path} size="sm" variant="quiet" icon="download" onClick={() => setInput({ path: source.path, label: source.label })}>
                  {`${source.label} (${source.count.toLocaleString()})`}
                </Button>
              ))}
            </div>
          ) : null}
          <SegmentedControl
            label="What to do with the list already here"
            value={mode}
            onChange={setMode}
            options={[
              { value: "add", label: "Add to the list" },
              { value: "replace", label: "Replace the list" },
            ]}
          />
        </div>

        <div className="redir-many__review" aria-live="polite" aria-busy={checking}>
          {empty ? (
            <p className="redir-many__idle">One redirect per line: the old address, then the new one. Full addresses of this site are shortened to their path.</p>
          ) : error && !review ? (
            <ErrorState compact title="Couldn’t read the list" error={error} />
          ) : !review ? (
            <Spinner label="Reading the list" />
          ) : (
            <>
              <p className="redir-many__summary">
                <strong>{`Understood ${review.understood.toLocaleString()} ${review.understood === 1 ? "line" : "lines"}`}</strong>
                <span className="g-faint">{` · ${review.formatLabel}`}</span>
                {checking ? <Spinner label="Checking" /> : null}
              </p>
              <dl className="redir-tally">
                <div>
                  <dt>New</dt>
                  <dd>{review.counts.add.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Changed</dt>
                  <dd>{review.counts.change.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Already there</dt>
                  <dd>{review.counts.same.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Left out</dt>
                  <dd>{review.counts.leftOut.toLocaleString()}</dd>
                </div>
              </dl>
              {review.unknownHosts.length ? (
                <div className="redir-many__hosts">
                  {review.unknownHosts.slice(0, 3).map((host) => (
                    <p key={host.host}>
                      <span>{`${host.count.toLocaleString()} old ${host.count === 1 ? "address is" : "addresses are"} on `}</span>
                      <span className="g-mono">{host.host}</span>
                      <span>. Is that this site?</span>{" "}
                      <Button size="sm" variant="secondary" onClick={() => setSiteHosts([...siteHosts, host.host])}>
                        Yes, read them as this site’s
                      </Button>
                    </p>
                  ))}
                </div>
              ) : null}
              {review.problems.length ? (
                <ul className="redir-problems">
                  {review.problems.map((problem) => (
                    <ProblemGroup key={`${problem.code}:${problem.title}`} problem={problem} onResolve={(key, value) => setResolutions({ ...resolutions, [key]: key === "missingStatus" ? Number(value) : value })} />
                  ))}
                </ul>
              ) : (
                <p className="redir-many__clean">
                  <ProofMark kind="reg" /> Every line reads cleanly.
                </p>
              )}
              {blocked ? <p className="redir-many__blocked" role="status">Loops can’t be added. Leave them out to continue.</p> : null}
              <Preview review={review} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
