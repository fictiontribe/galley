import { useState } from "react";
import type { I18nCounterpart, I18nEntryDetail, I18nLocaleSummary } from "@galley/core/i18n/types";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { Badge, Button, Tag } from "@/ui";
import { TranslateDialog } from "./TranslateDialog";
import { i18nKeys } from "./useI18n";
import "./i18n.css";

export interface EditorLocaleBarProps {
  siteId: string;
  detail: I18nEntryDetail;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onSwitchPath: (path: string) => void;
  onRefresh: () => void;
}

/**
 * Compact locale switcher bar rendered above the entry form on multilingual
 * sites: switches between counterparts, scaffolds missing drafts, highlights
 * outdated translations, toggles side-by-side original language reference, and
 * launches single-page AI translation with upfront cost preview.
 */
export function EditorLocaleBar({
  siteId,
  detail,
  showOriginal,
  onToggleOriginal,
  onSwitchPath,
  onRefresh,
}: EditorLocaleBarProps) {
  const [creatingLocale, setCreatingLocale] = useState<string | null>(null);
  const [translateOpen, setTranslateOpen] = useState(false);

  if (!detail.configured || detail.counterparts.length < 2) return null;

  const switchTo = async (counterpart: I18nCounterpart) => {
    if (counterpart.path) {
      onSwitchPath(counterpart.path);
      return;
    }
    setCreatingLocale(counterpart.locale);
    try {
      const created = await api("POST /api/sites/:siteId/i18n/entry/create", {
        params: { siteId },
        body: { sourcePath: detail.sourcePath, targetLocale: counterpart.locale, applyMemory: true },
      });

      invalidate(i18nKeys.overview(siteId));
      invalidate(i18nKeys.entry(siteId, detail.path));
      onSwitchPath(created.path);
    } finally {
      setCreatingLocale(null);
    }
  };

  const dialogLocales: I18nLocaleSummary[] = detail.counterparts.map((c) => ({
    code: c.locale,
    label: c.label,
    prefix: c.prefix,
    direction: c.direction,
    isDefault: c.isDefault,
    translated: c.state === "translated" ? 1 : 0,
    outdated: c.state === "outdated" ? 1 : 0,
    missing: c.state === "missing" ? 1 : 0,
    total: 1,
    percent: c.state === "translated" ? 100 : 0,
    urlPattern: c.isDefault ? "/…" : `/${c.prefix}/…`,
  }));

  const initialTargetLocales = detail.isDefault
    ? detail.counterparts.filter((c) => !c.isDefault).map((c) => c.locale)
    : [detail.locale];

  return (
    <>
      <div className="i18n-editor-bar" aria-label="Page languages">
        <div className="i18n-editor-bar__row">
          <div className="i18n-editor-bar__pills" role="group" aria-label="Switch language">
            {detail.counterparts.map((cp) => {
              const active = cp.locale.toLowerCase() === detail.locale.toLowerCase();
              const missing = cp.state === "missing";

              return (
                <button
                  key={cp.locale}
                  type="button"
                  disabled={creatingLocale === cp.locale}
                  className={`i18n-locale-pill ${active ? "i18n-locale-pill--active" : ""} ${missing ? "i18n-locale-pill--missing" : ""}`}
                  onClick={() => void switchTo(cp)}
                  title={
                    cp.isDefault
                      ? `${cp.label} (Default)`
                      : missing
                        ? `Create ${cp.label} draft`
                        : `${cp.label} · ${cp.state}`
                  }
                >
                  {!missing && !cp.isDefault ? (
                    <span
                      className={`i18n-locale-dot ${cp.state === "outdated" ? "i18n-locale-dot--outdated" : ""}`}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>
                    {missing ? `+ ${cp.locale.toUpperCase()}` : cp.locale.toUpperCase()}
                    {cp.isDefault ? " (Default)" : ""}
                  </span>
                </button>
              );
            })}
          </div>
          <Button variant="secondary" size="sm" icon="languages" onClick={() => setTranslateOpen(true)}>
            Translate page…
          </Button>
        </div>

        <div className="i18n-editor-bar__meta">
          <div className="i18n-editor-bar__row">
            {detail.currentUrl ? <Tag variant="mono">{detail.currentUrl}</Tag> : null}
            {detail.outdated ? <Badge tone="warning">Outdated — source changed</Badge> : null}
          </div>
          {!detail.isDefault && detail.sourceData ? (
            <Button variant={showOriginal ? "primary" : "quiet"} size="sm" onClick={onToggleOriginal}>
              {showOriginal ? `Hide original (${detail.defaultLocale.toUpperCase()})` : `Show original (${detail.defaultLocale.toUpperCase()})`}
            </Button>
          ) : null}
        </div>
      </div>

      <TranslateDialog
        siteId={siteId}
        open={translateOpen}
        onClose={() => setTranslateOpen(false)}
        locales={dialogLocales}
        initialLocales={initialTargetLocales}
        paths={[detail.sourcePath]}
        scopeLabel={detail.sourceTitle}
        onFinished={() => {
          invalidate(i18nKeys.overview(siteId));
          invalidate(i18nKeys.entry(siteId, detail.path));
          onRefresh();
        }}
      />
    </>
  );
}

/** Original default-language Markdown body shown above BodyEditor during side-by-side manual translation. */
export function OriginalBodyReference({
  defaultLocale,
  sourceBody,
}: {
  defaultLocale: string;
  sourceBody: string;
}) {
  if (!sourceBody.trim()) return null;
  return (
    <div className="i18n-field-ref" aria-label={`Original ${defaultLocale} body`}>
      <div className="i18n-field-ref__head">
        <span className="i18n-field-ref__label">Original body ({defaultLocale.toUpperCase()})</span>
      </div>
      <p className="i18n-field-ref__text">{sourceBody}</p>
    </div>
  );
}
