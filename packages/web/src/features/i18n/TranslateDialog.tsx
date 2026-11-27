import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { I18nLocaleSummary, TranslationJobItemState, TranslationJobStatus, TranslationMode, TranslationPlan } from "@galley/core/i18n/types";
import { api } from "@/lib/api";
import { formatCredits, useManagedAi } from "@/lib/credits";
import { Badge, Button, buttonClass, Checkbox, Dialog, ErrorState, Field, Input, Select, Skeleton } from "@/ui";
import "./i18n.css";

export interface TranslateDialogProps {
  siteId: string;
  open: boolean;
  onClose: () => void;
  /** Available target locales (non-default). */
  locales: I18nLocaleSummary[];
  /** Optional pre-selected target locale codes. */
  initialLocales?: string[];
  /** Limit to specific source paths (single-page translate); omit for whole-site. */
  paths?: string[];
  /** Optional title override (e.g. page title for single-page translation). */
  scopeLabel?: string;
  defaultTranslateSlugs?: boolean;
  onFinished?: () => void;
}

const MODE_OPTIONS: Array<{ value: TranslationMode; label: string }> = [
  { value: "missing_and_outdated", label: "Missing & outdated pages" },
  { value: "missing_only", label: "Missing pages only" },
  { value: "all", label: "Re-translate all pages" },
];

const ITEM_STATE: Record<TranslationJobItemState, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  translated: { label: "Translated", tone: "success" },
  reused_tm: { label: "From memory (0 credits)", tone: "success" },
  skipped: { label: "Skipped", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};

function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `<$0.01`;
  return `~$${usd.toFixed(2)}`;
}

/**
 * Automatic single-page or whole-site translation dialog with upfront cost,
 * token, Translation Memory savings, and AI credits preview before any
 * request is sent. Everything written lands in Proof.
 */
export function TranslateDialog({
  siteId,
  open,
  onClose,
  locales,
  initialLocales,
  paths,
  scopeLabel,
  defaultTranslateSlugs = true,
  onFinished,
}: TranslateDialogProps) {
  const { managed, disabled: aiDisabled, manageUrl } = useManagedAi();
  const nonDefault = useMemo(() => locales.filter((loc) => !loc.isDefault), [locales]);
  const [selectedLocales, setSelectedLocales] = useState<string[]>([]);
  const [mode, setMode] = useState<TranslationMode>("missing_and_outdated");
  const [translateSlugs, setTranslateSlugs] = useState(defaultTranslateSlugs);
  const [cap, setCap] = useState<number>(0);
  const [confirmedHighSpend, setConfirmedHighSpend] = useState(false);

  const [plan, setPlan] = useState<TranslationPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<TranslationJobStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const pathKey = paths?.join("\n") ?? "";
  const initialKey = initialLocales?.join(",") ?? "";

  useEffect(() => {
    if (!open) return;
    const defaults = initialLocales?.length ? initialLocales : nonDefault.map((l) => l.code);

    setSelectedLocales(defaults);
    setMode(paths?.length ? "all" : "missing_and_outdated");
    setTranslateSlugs(defaultTranslateSlugs);
    setCap(0);
    setConfirmedHighSpend(false);
    setStatus(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by initialKey/pathKey
  }, [open, initialKey, pathKey, defaultTranslateSlugs]);

  const localesKey = selectedLocales.join(",");

  useEffect(() => {
    if (!open || status) return;
    if (selectedLocales.length === 0) {
      setPlan(null);
      return;
    }
    let alive = true;

    setPlanLoading(true);
    setError(null);
    setConfirmedHighSpend(false);
    api("POST /api/sites/:siteId/i18n/translate/plan", {
      params: { siteId },
      body: {
        ...(paths?.length ? { paths } : {}),
        targetLocales: selectedLocales,
        mode,
        translateSlugs,
        ...(cap > 0 ? { limit: cap } : {}),
      },
    })
      .then((next) => {
        if (!alive) return;
        setPlan(next);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason);
      })
      .finally(() => {
        if (alive) setPlanLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tracked via localesKey/pathKey
  }, [open, siteId, localesKey, mode, translateSlugs, cap, pathKey, Boolean(status)]);

  const running = status?.job.state === "running";

  useEffect(() => {
    if (!status || status.job.state !== "running") return;
    const timer = setInterval(() => {
      void api("GET /api/sites/:siteId/i18n/translate/:jobId", {
        params: { siteId, jobId: status.job.id },
      })
        .then((next) => {
          setStatus(next);
          if (next.job.state !== "running") onFinished?.();
        })
        .catch(() => undefined);
    }, 650);

    return () => clearInterval(timer);
  }, [status, siteId, onFinished]);

  const toggleLocale = (code: string) => {
    setSelectedLocales((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code]
    );
  };

  const start = async () => {
    if (!plan || plan.totalItems === 0) return;
    setStarting(true);
    setError(null);
    try {
      const started = await api("POST /api/sites/:siteId/i18n/translate", {
        params: { siteId },
        body: {
          ...(paths?.length ? { paths } : {}),
          targetLocales: selectedLocales,
          mode,
          translateSlugs,
          ...(cap > 0 ? { limit: cap } : {}),
        },
      });

      setStatus(started);
    } catch (reason) {
      setError(reason);
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    if (status) {
      void api("POST /api/sites/:siteId/i18n/translate/:jobId/cancel", {
        params: { siteId, jobId: status.job.id },
      });
    }
  };

  const tmOnly = Boolean(plan && plan.totalItems > 0 && plan.requests === 0);
  const blockedByAi = Boolean(plan && plan.requests > 0 && (!plan.connected || aiDisabled));
  const needsHighSpendConfirm = Boolean(plan && plan.requiresConfirmation && !confirmedHighSpend);
  const translatedCount = status?.items.filter((i) => i.jobState === "translated" || i.jobState === "reused_tm").length ?? 0;

  return (
    <Dialog
      open={open}
      onClose={running ? () => undefined : onClose}
      size="lg"
      title={scopeLabel ? `Translate “${scopeLabel}”` : paths?.length ? "Translate page" : "Translate site"}
      description="Upfront cost and Translation Memory savings are calculated before anything is sent. Every translation lands in Proof for review."
      footer={
        status && !running ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {translatedCount > 0 ? (
              <Link className={buttonClass("primary")} to={`/sites/${encodeURIComponent(siteId)}/proof`} onClick={onClose}>
                Review {translatedCount} {translatedCount === 1 ? "translation" : "translations"} in Proof
              </Link>
            ) : null}
          </>
        ) : running ? (
          <Button variant="secondary" onClick={stop}>
            Stop after this page
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="languages"
              busy={starting}
              busyLabel="Starting…"
              disabled={!plan || planLoading || plan.totalItems === 0 || blockedByAi || needsHighSpendConfirm}
              onClick={() => void start()}
            >
              {tmOnly
                ? `Apply ${plan!.totalItems} from memory (0 credits)`
                : plan && plan.totalItems > 0
                  ? managed
                    ? `Translate ${plan.totalItems} ${plan.totalItems === 1 ? "page" : "pages"} (~${formatCredits(plan.estimatedCredits)})`
                    : `Translate ${plan.totalItems} ${plan.totalItems === 1 ? "page" : "pages"} (${formatUsd(plan.estimatedUsd)})`
                  : "Translate"}
            </Button>
          </>
        )
      }
    >
      <div className="i18n-dialog">
        {error ? <ErrorState compact title="Couldn’t run translation" error={error} /> : null}

        {!status ? (
          <>
            <div className="i18n-dialog__controls">
              <Field label="Target languages">
                <div className="i18n-locale-picks" role="group" aria-label="Target languages">
                  {nonDefault.map((loc) => {
                    const checked = selectedLocales.includes(loc.code);

                    return (
                      <label key={loc.code} className={`i18n-locale-pick ${checked ? "i18n-locale-pick--selected" : ""}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleLocale(loc.code)} />
                        <span>{loc.label}</span>
                        <span className="g-mono">{loc.code}</span>
                      </label>
                    );
                  })}
                </div>
              </Field>

              <div className="i18n-setup-grid">
                <Field label="Pages to include">
                  <Select
                    aria-label="Pages to include"
                    options={MODE_OPTIONS}
                    value={mode}
                    onChange={(value) => setMode(value as TranslationMode)}
                  />
                </Field>
                {!paths?.length ? (
                  <Field label="Page cap (optional)" hint="0 translates all matching pages.">
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      value={cap}
                      onChange={(event) => setCap(Math.max(0, Number(event.target.value) || 0))}
                    />
                  </Field>
                ) : null}
              </div>

              <Checkbox
                checked={translateSlugs}
                onChange={(next) => setTranslateSlugs(next)}
                label="Translate URL slugs (e.g. /pricing/ → /es/precios/)"
                description="Home pages always stay at /<locale>/ (index)."
              />
            </div>

            {selectedLocales.length === 0 ? (
              <p className="i18n-panel__lede">Select at least one target language to calculate the translation estimate.</p>
            ) : planLoading && !plan ? (
              <Skeleton lines={4} />
            ) : plan && plan.totalItems === 0 ? (
              <div className="i18n-cost-card">
                <span className="i18n-cost-card__headline">Everything selected is already up to date</span>
                <p className="i18n-cost-card__sub">Switch to “Re-translate all pages” if you want to refresh existing translations.</p>
              </div>
            ) : plan ? (
              <div
                className={`i18n-cost-card ${
                  tmOnly ? "i18n-cost-card--free" : managed ? "i18n-cost-card--managed" : ""
                }`}
                data-testid="i18n-cost-preview"
              >
                <div className="i18n-cost-card__top">
                  <div>
                    {tmOnly ? (
                      <div className="i18n-cost-card__headline">0 credits ($0.00) — 100% matched from Translation Memory</div>
                    ) : managed ? (
                      <div className="i18n-cost-card__headline">Estimated cost: ~{formatCredits(plan.estimatedCredits)}</div>
                    ) : (
                      <div className="i18n-cost-card__headline">Estimated cost: {formatUsd(plan.estimatedUsd)}</div>
                    )}
                    <div className="i18n-cost-card__sub">
                      {tmOnly
                        ? "No AI call required — ready to apply immediately even without an AI key."
                        : managed
                          ? `Billed from workspace AI credits · ${plan.requests} AI ${plan.requests === 1 ? "request" : "requests"} · ${plan.model}`
                          : `~${plan.estimatedInputTokens.toLocaleString()} input / ~${plan.estimatedOutputTokens.toLocaleString()} output tokens · ~${formatCredits(plan.estimatedCredits)} equivalent · ${plan.model}`}
                    </div>
                  </div>
                  <Badge tone={tmOnly ? "success" : managed ? "accent" : "neutral"}>
                    {tmOnly ? "Free via TM" : managed ? "Galley AI credits" : "BYOK estimate"}
                  </Badge>
                </div>

                <dl className="i18n-cost-facts">
                  <div>
                    <dt>Translations</dt>
                    <dd>{plan.totalItems.toLocaleString()} {plan.totalItems === 1 ? "page" : "pages"}</dd>
                  </div>
                  <div>
                    <dt>Source words</dt>
                    <dd>{plan.sourceWords.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Segments to translate</dt>
                    <dd>{plan.segmentsToTranslate.toLocaleString()} of {plan.totalSegments.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>AI requests</dt>
                    <dd>{plan.requests.toLocaleString()}</dd>
                  </div>
                </dl>

                {plan.tmHits > 0 ? (
                  <div className="i18n-cost-tm">
                    <Badge tone="success">Translation Memory</Badge>
                    <span>
                      {managed
                        ? `${plan.tmHits.toLocaleString()} ${plan.tmHits === 1 ? "segment" : "segments"} reused for 0 credits (saving ~${formatCredits(plan.tmSavedCredits)}).`
                        : `Saved ${formatUsd(plan.tmSavedUsd)} (~${plan.tmSavedTokens.toLocaleString()} tokens) from ${plan.tmHits.toLocaleString()} memory ${plan.tmHits === 1 ? "match" : "matches"}.`}
                    </span>
                  </div>
                ) : null}

                {plan.requiresConfirmation ? (
                  <Checkbox
                    checked={confirmedHighSpend}
                    onChange={(next) => setConfirmedHighSpend(next)}
                    label={
                      managed
                        ? `Confirm large batch (~${formatCredits(plan.estimatedCredits)} exceeds 600 credits)`
                        : `Confirm large batch (${formatUsd(plan.estimatedUsd)} / ~${formatCredits(plan.estimatedCredits)})`
                    }
                  />
                ) : null}

                {blockedByAi ? (
                  <p className="i18n-cost-card__sub">
                    {managed ? (
                      <>
                        AI is switched off for this site. A workspace manager can turn it on in{" "}
                        {manageUrl ? (
                          <a className="g-link" href={manageUrl} target="_blank" rel="noopener noreferrer">
                            Galley Cloud
                          </a>
                        ) : (
                          "Galley Cloud"
                        )}
                        .
                      </>
                    ) : (
                      "Connect an Anthropic key in App settings to run automatic AI translation. Manual translation and 100% Translation Memory matches still work without a key."
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="i18n-progress" role="status" aria-live="polite">
            <progress max={1} value={status.job.progress ?? 0} aria-label="Translation progress" />
            <div className="i18n-progress__meta">
              <span>{status.job.detail}</span>
              <span>
                {managed
                  ? `Spent: ${formatCredits(status.actualCredits)}`
                  : `Spent: ${formatUsd(status.actualUsd)} (${(status.actualInputTokens + status.actualOutputTokens).toLocaleString()} tokens)`}
                {status.tmReusedSegments > 0 ? ` · ${status.tmReusedSegments} TM reused` : ""}
              </span>
            </div>
            <ol className="i18n-job-items" aria-label="Translation progress items">
              {status.items.map((item) => (
                <li key={`${item.sourcePath}:${item.targetLocale}`} className="i18n-job-item">
                  <div className="i18n-job-item__left">
                    <span className="i18n-job-item__title">
                      {item.title} · {item.targetLabel} ({item.targetLocale})
                    </span>
                    <span className="i18n-url">
                      {item.writtenUrl ?? `/${item.targetLocale}/${item.localizedSlug}/`}
                      {item.reason ? ` — ${item.reason}` : ""}
                    </span>
                  </div>
                  <Badge tone={ITEM_STATE[item.jobState].tone}>{ITEM_STATE[item.jobState].label}</Badge>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Dialog>
  );
}
