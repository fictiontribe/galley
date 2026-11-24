/**
 * /sites/:siteId/inbox — submissions sent to this app's capture address:
 * forms on the left, the selected form's submissions, and one submission in
 * full. New ones slide in live; deleting offers Undo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { CaptureSettings, InboxFilter, InboxFormSummary } from "@galley/core/api";
import type { FormSubmission } from "@galley/core/kit";
import { useTopBar } from "@/app/chrome";
import { api, buildUrl, errorShape } from "@/lib/api";
import { absoluteTime, count, relativeTime } from "@/lib/format";
import { invalidate, useQuery } from "@/lib/query";
import { notify } from "@/lib/stores/toasts";
import { Badge, Button, buttonClass, EmptyState, ErrorState, Icon, Input, PageHeader, SegmentedControl, Skeleton, cx } from "@/ui";
import { CaptureSettingsDialog } from "./CaptureSettingsDialog";
import { inboxKeys, sendTestSubmission, useCaptureSettings, useFreshIds, useInboxForms, type TestOutcome } from "./data";
import { ReachText } from "./ReachNote";
import { arrival, labelledAnswers, rowSummary } from "./summary";
import "./inbox.css";
import { useMay } from "@/lib/may";

const PAGE = 50;

const SPAM_REASONS: Record<string, string> = {
  honeypot: "Filled in the hidden field bots fill in",
  "too-fast": "Sent faster than a person could",
  turnstile: "Didn’t pass the Turnstile check",
  marked: "Marked as spam",
};

function providerName(provider: string): string {
  if (provider === "email") return "E-mail alert";
  if (provider === "webhook") return "Webhook";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// ─────────────────────────────────────────────────────────── forms column

function FormList({ forms, current, onPick }: { forms: InboxFormSummary[]; current: string | null; onPick: (id: string) => void }) {
  return (
    <nav className="app-inbox__forms" aria-label="Forms">
      <p className="g-eyebrow app-inbox__eyebrow">Forms</p>
      <ul>
        {forms.map((form) => (
          <li key={form.id}>
            <button type="button" className="app-inbox__form" aria-current={form.id === current ? "true" : undefined} onClick={() => onPick(form.id)}>
              <span className="app-inbox__form-name">{form.name}</span>
              <span className="app-inbox__form-meta">
                {form.unread > 0 ? <Badge tone="accent" mark={null}>{`${form.unread} new`}</Badge> : null}
                <span className="g-faint" aria-label={count(form.total, "submission")}>
                  {form.total.toLocaleString()}
                </span>
              </span>
              {!form.capturing ? <span className="app-inbox__form-note">{form.problem ?? "Sends elsewhere, not here"}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────── empty states

function NoForms({ siteId, settings }: { siteId: string; settings: CaptureSettings | undefined }) {
  return (
    <div className="app-screen__inner">
      <EmptyState
        title="No forms yet."
        body="Forms on the site send what visitors write here, with an e-mail alert if you like. Build one to start."
        actions={
          <Link to={`/sites/${siteId}/forms`} className={buttonClass("primary", "md")}>
            Build a form
          </Link>
        }
        mark="pilcrow"
      />
      {settings ? (
        <div className="app-inbox__reach">
          <ReachText settings={settings} />
        </div>
      ) : null}
    </div>
  );
}

function FirstSubmission({ siteId, form, settings }: { siteId: string; form: InboxFormSummary; settings: CaptureSettings | undefined }) {
  const openedAt = useRef(Date.now());
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  if (!form.capturing) {
    return (
      <EmptyState
        compact
        title="This form sends elsewhere."
        body={form.problem ?? "Its submissions go to another service, so they don’t arrive here. Add the inbox as one of its destinations to keep a copy here too."}
        actions={
          <Link to={`/sites/${siteId}/forms`} className={buttonClass("secondary", "md")}>
            Open the form builder
          </Link>
        }
      />
    );
  }
  const send = async () => {
    if (!settings || !form.definition) return;
    setSending(true);
    const result = await sendTestSubmission(settings, form.id, form.definition, openedAt.current);
    setSending(false);
    // A success replaces this empty state with the new row, so it is said in a toast that outlives it.
    if (result.ok) notify({ tone: "success", title: "Test submission received", body: "It’s at the top of the list, marked Test." });
    else setOutcome(result);
    invalidate(inboxKeys.all(siteId));
  };
  return (
    <div className="app-inbox__first">
      <EmptyState compact title="Nothing here yet." body={`When someone sends “${form.name}”, it arrives here first.`} />
      {settings ? (
        <>
          <ReachText settings={settings} />
          <div className="app-inbox__test">
            <Button variant="secondary" icon="play" busy={sending} busyLabel="Sending…" onClick={() => void send()} disabled={!form.definition}>
              Send a test submission
            </Button>
            <span className="g-faint">It goes through the same checks as a visitor’s{settings.turnstile.configured && form.definition?.spam?.turnstileSiteKey ? " and lands in Spam, because a test can’t pass the Turnstile check" : ""}.</span>
          </div>
          {outcome ? (
            <div className={cx("app-inbox__outcome", outcome.ok ? "app-inbox__outcome--ok" : "app-inbox__outcome--bad")} role="status">
              <p>{outcome.message}</p>
              {outcome.errors ? (
                <ul>
                  {Object.entries(outcome.errors).map(([field, message]) => (
                    <li key={field}>
                      <span className="g-mono">{field}</span> — {message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── list

function Row({
  item,
  form,
  selected,
  checked,
  fresh,
  onOpen,
  onCheck,
}: {
  item: FormSubmission;
  form: InboxFormSummary;
  selected: boolean;
  checked: boolean;
  fresh: boolean;
  onOpen: () => void;
  onCheck: (checked: boolean) => void;
}) {
  const summary = rowSummary(form.definition, item);
  const [first, ...rest] = summary.length ? summary : ["(no answers)"];
  return (
    <li className={cx("app-inbox__row", !item.read && !item.spam && "app-inbox__row--unread", fresh && "app-inbox__row--new")} aria-current={selected ? "true" : undefined}>
      <input type="checkbox" className="app-inbox__check" checked={checked} onChange={(event) => onCheck(event.target.checked)} aria-label={`Select ${first}`} />
      <button type="button" className="app-inbox__open" onClick={onOpen}>
        <span className="app-inbox__line">
          <span className="app-inbox__who">{first}</span>
          <time className="app-inbox__time" dateTime={item.at} title={absoluteTime(item.at)}>
            {relativeTime(item.at)}
          </time>
        </span>
        <span className="app-inbox__rest">
          {rest.join(" · ") || " "}
          {item.test ? <Badge mark={null}>Test</Badge> : null}
          {item.delivery?.some((entry) => !entry.ok) ? <Badge tone="warning">Not sent on</Badge> : null}
        </span>
      </button>
      {!item.read && !item.spam ? <span className="g-sr">Unread</span> : null}
    </li>
  );
}

// ─────────────────────────────────────────────────────────── detail

function Detail({
  siteId,
  form,
  submission,
  onChanged,
  onDelete,
}: {
  siteId: string;
  form: InboxFormSummary;
  submission: FormSubmission;
  onChanged: () => void;
  onDelete: (items: FormSubmission[]) => void;
}) {
  const answers = labelledAnswers(form.definition, submission);
  const arrived = arrival(form.definition, submission);
  const [retrying, setRetrying] = useState<string | null>(null);
  const title = rowSummary(form.definition, submission, 1)[0] ?? "Submission";

  const mark = async (flags: { read?: boolean; spam?: boolean }, done: string) => {
    try {
      await api("PATCH /api/sites/:siteId/inbox/:formId", { params: { siteId, formId: form.id }, body: { ids: [submission.id], ...flags } });
      notify({ tone: "success", title: done });
      onChanged();
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t change that", body: shape.message, detail: shape.detail });
    }
  };
  const retry = async (destination: number | "email") => {
    const key = String(destination);
    setRetrying(key);
    try {
      const next = await api("POST /api/sites/:siteId/inbox/:formId/:submissionId/retry", { params: { siteId, formId: form.id, submissionId: submission.id }, body: { destination } });
      const entry = next.delivery?.find((item) => (destination === "email" ? item.provider === "email" : item.destination === destination));
      notify(entry?.ok ? { tone: "success", title: "Sent" } : { tone: "warning", title: "Still not sent", body: entry?.detail });
      onChanged();
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t send it again", body: shape.message, detail: shape.detail });
    } finally {
      setRetrying(null);
    }
  };

  return (
    <article className="app-inbox__detail" aria-label={`Submission from ${title}`}>
      <header className="app-inbox__detail-head">
        <div>
          <h2 className="app-inbox__detail-title">{title}</h2>
          <p className="app-inbox__detail-meta">
            <time dateTime={submission.at}>{absoluteTime(submission.at)}</time>
            {submission.test ? <Badge mark={null}>Test</Badge> : null}
            {submission.spam ? <Badge tone="danger">Spam</Badge> : null}
          </p>
        </div>
        <div className="app-inbox__detail-actions">
          <Button size="sm" variant="quiet" onClick={() => void mark({ read: !submission.read }, submission.read ? "Marked unread" : "Marked read")}>
            {submission.read ? "Mark unread" : "Mark read"}
          </Button>
          <Button size="sm" variant="quiet" onClick={() => void mark({ spam: !submission.spam }, submission.spam ? "Moved to the inbox" : "Moved to Spam")}>
            {submission.spam ? "Not spam" : "Spam"}
          </Button>
          <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => onDelete([submission])}>
            Delete
          </Button>
        </div>
      </header>
      {submission.spam && submission.spamReason ? <p className="app-inbox__spam-note">{SPAM_REASONS[submission.spamReason] ?? "Caught by the spam checks"}. Real ones can be moved back with “Not spam”.</p> : null}

      <dl className="app-inbox__answers">
        {answers.map((row) => (
          <div key={row.id} className="app-inbox__answer">
            <dt>{row.label}</dt>
            <dd className={row.type === "textarea" ? "app-inbox__long" : undefined}>
              {row.type === "email" ? <a href={`mailto:${row.value}`}>{row.value}</a> : row.value}
            </dd>
          </div>
        ))}
        {answers.length === 0 ? <p className="g-faint">No answers were sent.</p> : null}
      </dl>

      {submission.page?.url || submission.page?.referrer ? (
        <section className="app-inbox__section">
          <h3 className="g-eyebrow">Sent from</h3>
          {submission.page.url ? (
            <p>
              <a href={submission.page.url} target="_blank" rel="noreferrer noopener">
                {submission.page.title || submission.page.url}
              </a>
              {submission.page.title ? <span className="g-faint g-mono app-inbox__url">{submission.page.url}</span> : null}
            </p>
          ) : null}
          {submission.page.referrer ? <p className="g-faint">Came from {submission.page.referrer}</p> : null}
        </section>
      ) : null}

      {arrived.length ? (
        <section className="app-inbox__section">
          <h3 className="g-eyebrow">How they arrived</h3>
          <dl className="app-inbox__utm">
            {arrived.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {submission.delivery?.length ? (
        <section className="app-inbox__section">
          <h3 className="g-eyebrow">Sent on</h3>
          <ul className="app-inbox__delivery">
            {submission.delivery.map((entry) => {
              const key = entry.provider === "email" ? "email" : String(entry.destination ?? "");
              return (
                <li key={`${entry.provider}-${entry.destination ?? "x"}`}>
                  <span className="app-inbox__delivery-name">{providerName(entry.provider)}</span>
                  {entry.ok ? <Badge tone="success">Sent</Badge> : <Badge tone="danger">Not sent</Badge>}
                  <span className="g-faint app-inbox__delivery-detail">
                    {entry.detail}
                    {entry.attempts && entry.attempts > 1 ? ` ${count(entry.attempts, "try", "tries")}.` : ""}
                  </span>
                  <Button size="sm" variant="quiet" icon="refresh" busy={retrying === key} busyLabel="Sending…" onClick={() => void retry(entry.provider === "email" ? "email" : (entry.destination ?? 0))}>
                    {entry.ok ? "Send again" : "Retry"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

// ─────────────────────────────────────────────────────────── screen

export function InboxScreen() {
  const { siteId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  useTopBar({ crumbs: [{ label: "Inbox" }] });
  const forms = useInboxForms(siteId);
  const capture = useCaptureSettings(siteId);
  const fresh = useFreshIds(siteId);
  const [filter, setFilter] = useState<InboxFilter>("inbox");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(1);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Who is told about submissions, and the keys behind that, are the install's settings: an owner's.
  const mayChangeCapture = useMay()("PATCH /api/sites/:siteId/capture");

  const list = forms.data?.forms ?? [];
  const formId = params.get("form") ?? list[0]?.id ?? null;
  const form = list.find((item) => item.id === formId) ?? null;
  const selectedId = params.get("id");

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setChecked(new Set());
    setPages(1);
  }, [formId, filter, q]);

  const submissions = useQuery(
    inboxKeys.list(siteId, formId ?? "", filter, q, pages),
    () => api("GET /api/sites/:siteId/inbox/:formId", { params: { siteId, formId: formId ?? "" }, query: { filter, ...(q ? { q } : {}), limit: PAGE * pages } }),
    { enabled: Boolean(formId) },
  );
  const items = submissions.data?.items ?? [];
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  // Only for a submission opened by link that isn't on the loaded page. A disabled query stays
  // subscribed, so when it isn't needed it sits under a key no inbox event invalidates.
  const needOne = Boolean(formId && selectedId && !selected && submissions.data);
  const single = useQuery(
    needOne ? ["site", siteId, "inbox", "one", formId ?? "", selectedId ?? ""] : ["inbox-one-idle"],
    () => (needOne ? api("GET /api/sites/:siteId/inbox/:formId/:submissionId", { params: { siteId, formId: formId ?? "", submissionId: selectedId ?? "" } }) : Promise.resolve(null)),
    { enabled: needOne },
  );
  const shown = selected ?? single.data ?? null;

  // Opening a submission marks it read, as a mail program does.
  useEffect(() => {
    if (!shown || shown.read || shown.spam || !formId) return;
    void api("PATCH /api/sites/:siteId/inbox/:formId", { params: { siteId, formId }, body: { ids: [shown.id], read: true } })
      .then(() => invalidate(inboxKeys.all(siteId)))
      .catch(() => undefined);
  }, [shown?.id, shown?.read, shown?.spam, formId, siteId]);

  const pick = (next: { form?: string; id?: string | null }) => {
    const search = new URLSearchParams(params);
    if (next.form !== undefined) {
      search.set("form", next.form);
      search.delete("id");
    }
    if (next.id === null) search.delete("id");
    else if (next.id) search.set("id", next.id);
    setParams(search, { replace: true });
  };

  const refresh = () => invalidate(inboxKeys.all(siteId));

  const remove = async (targets: FormSubmission[]) => {
    if (!formId || !targets.length) return;
    // Closed first: the live "deleted" event can refresh the list before the request returns.
    if (selectedId && targets.some((item) => item.id === selectedId)) pick({ id: null });
    try {
      const { deleted } = await api("POST /api/sites/:siteId/inbox/:formId/delete", { params: { siteId, formId }, body: { ids: targets.map((item) => item.id) } });
      setChecked(new Set());
      refresh();
      notify({
        tone: "neutral",
        title: `Deleted ${count(deleted.length, "submission")}`,
        body: "They’re gone from this app’s files.",
        action: {
          label: "Undo",
          onClick: () =>
            void api("POST /api/sites/:siteId/inbox/:formId/restore", { params: { siteId, formId }, body: { submissions: deleted } })
              .then(() => {
                refresh();
                notify({ tone: "success", title: `Restored ${count(deleted.length, "submission")}` });
              })
              .catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t restore them", body: errorShape(error).message })),
        },
      });
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t delete", body: `${shape.message} Nothing was removed.`, detail: shape.detail });
    }
  };

  const bulk = async (flags: { read?: boolean; spam?: boolean }, done: string) => {
    if (!formId || !checked.size) return;
    try {
      await api("PATCH /api/sites/:siteId/inbox/:formId", { params: { siteId, formId }, body: { ids: [...checked], ...flags } });
      setChecked(new Set());
      refresh();
      notify({ tone: "success", title: done });
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t change them", body: errorShape(error).message });
    }
  };

  const exportUrl = formId ? buildUrl("GET /api/sites/:siteId/inbox/:formId/export", { siteId, formId }, { filter }) : null;
  const header = (
    <PageHeader
      title="Inbox"
      description="What visitors send through the site’s forms. Kept by this app, not published with the site."
      actions={
        <>
          {exportUrl && form && form.total + form.spam > 0 ? (
            <a href={exportUrl} download className={buttonClass("secondary", "md")}>
              <Icon name="download" />
              Export
            </a>
          ) : null}
          {mayChangeCapture ? (
            <Button variant="secondary" icon="settings" disabled={!capture.data} onClick={() => setSettingsOpen(true)}>
              Capture settings…
            </Button>
          ) : null}
        </>
      }
    />
  );

  if (forms.loading) {
    return (
      <div className="app-screen">
        <div className="app-screen__inner app-screen__inner--wide" aria-busy="true">
          <Skeleton width={160} height={28} />
          <Skeleton lines={6} style={{ marginBlockStart: 24 }} />
        </div>
      </div>
    );
  }
  if (forms.status === "error" && !forms.data) {
    return (
      <div className="app-screen">
        <ErrorState title="Couldn’t open the inbox" error={forms.error} onRetry={() => void forms.refetch()} />
      </div>
    );
  }
  if (!list.length) {
    return (
      <div className="app-screen">
        <div className="app-screen__inner app-screen__inner--wide">{header}</div>
        <NoForms siteId={siteId} settings={capture.data} />
      </div>
    );
  }

  const allChecked = items.length > 0 && items.every((item) => checked.has(item.id));
  const noneYet = form && form.total === 0 && form.spam === 0 && !q;
  let middle;
  if (!form) middle = null;
  else if (noneYet) middle = <FirstSubmission siteId={siteId} form={form} settings={capture.data} />;
  else if (submissions.loading) middle = <Skeleton lines={8} />;
  else if (submissions.status === "error" && !submissions.data) middle = <ErrorState compact title="Couldn’t load the submissions" error={submissions.error} onRetry={() => void submissions.refetch()} />;
  else if (!items.length) {
    middle = q ? (
      <EmptyState compact title={`Nothing mentions “${q}”.`} body="Try a shorter word, or look in Spam." />
    ) : filter === "spam" ? (
      <EmptyState compact title="No spam." body="Submissions the spam checks catch land here, so you can rescue a real one." />
    ) : filter === "unread" ? (
      <EmptyState compact title="All read." body="New submissions show up here until you open them." />
    ) : (
      <EmptyState compact title="Nothing in the inbox." body="Everything for this form is in Spam." />
    );
  } else {
    middle = (
      <>
        <div className="app-inbox__bulk">
          <input
            type="checkbox"
            className="app-inbox__check"
            checked={allChecked}
            onChange={(event) => setChecked(event.target.checked ? new Set(items.map((item) => item.id)) : new Set())}
            aria-label="Select all shown"
          />
          {checked.size ? (
            <>
              <span className="app-inbox__bulk-count">{count(checked.size, "selected", "selected")}</span>
              <Button size="sm" variant="quiet" onClick={() => void bulk({ read: true }, "Marked read")}>
                Mark read
              </Button>
              <Button size="sm" variant="quiet" onClick={() => void bulk(filter === "spam" ? { spam: false } : { spam: true }, filter === "spam" ? "Moved to the inbox" : "Moved to Spam")}>
                {filter === "spam" ? "Not spam" : "Spam"}
              </Button>
              <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => void remove(items.filter((item) => checked.has(item.id)))}>
                {`Delete ${checked.size}`}
              </Button>
            </>
          ) : (
            <span className="g-faint">{count(submissions.data?.total ?? 0, filter === "spam" ? "spam submission" : "submission")}</span>
          )}
        </div>
        <ul className="app-inbox__rows">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              form={form}
              selected={item.id === shown?.id}
              checked={checked.has(item.id)}
              fresh={fresh.has(item.id)}
              onOpen={() => pick({ id: item.id })}
              onCheck={(on) => setChecked((current) => (on ? new Set([...current, item.id]) : new Set([...current].filter((id) => id !== item.id))))}
            />
          ))}
        </ul>
        {(submissions.data?.total ?? 0) > items.length ? (
          <Button variant="quiet" block onClick={() => setPages(pages + 1)}>
            Show more
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div className="app-screen app-inbox-screen">
      <div className="app-screen__inner app-screen__inner--wide app-inbox-wrap">
        {header}
        {capture.data && !capture.data.captureReachable && !noneYet ? (
          <div className="app-inbox__reach">
            <ReachText settings={capture.data} compact />
          </div>
        ) : null}
        <div className="app-inbox">
          <FormList forms={list} current={formId} onPick={(id) => pick({ form: id })} />
          <section className="app-inbox__list" aria-label={form ? `Submissions to ${form.name}` : "Submissions"}>
            {noneYet ? null : (
              <div className="app-inbox__tools">
                <Input size="sm" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search answers…" aria-label="Search answers" />
                <SegmentedControl
                  label="Show"
                  value={filter}
                  onChange={(value) => setFilter(value)}
                  options={[
                    { value: "inbox", label: "All" },
                    { value: "unread", label: form?.unread ? `Unread ${form.unread}` : "Unread" },
                    { value: "spam", label: form?.spam ? `Spam ${form.spam}` : "Spam" },
                  ]}
                />
              </div>
            )}
            {middle}
          </section>
          <section className="app-inbox__pane" aria-label="Submission">
            {form && shown ? (
              <Detail siteId={siteId} form={form} submission={shown} onChanged={refresh} onDelete={(targets) => void remove(targets)} />
            ) : (
              <div className="app-inbox__placeholder">
                <p className="g-faint">{noneYet ? "A submission opens here." : "Choose a submission to read it in full."}</p>
              </div>
            )}
          </section>
        </div>
      </div>
      {capture.data && mayChangeCapture ? <CaptureSettingsDialog siteId={siteId} open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={capture.data} forms={list} /> : null}
    </div>
  );
}
