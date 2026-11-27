import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  GlossaryFile,
  GlossaryTerm,
  I18nLocaleSummary,
  I18nOverview,
  I18nPageRow,
  TranslationMemoryEntry,
  TranslationMemoryFile,
  TranslationState,
} from "@galley/core/i18n/types";
import type { I18nLocaleConfig, I18nStrategy } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { api } from "@/lib/api";
import { useMay } from "@/lib/may";
import { invalidate } from "@/lib/query";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
  Tag,
  Toggle,
} from "@/ui";
import { TranslateDialog } from "./TranslateDialog";
import { i18nKeys, useI18nGlossary, useI18nMemory, useI18nOverview } from "./useI18n";
import "./i18n.css";

type TabId = "pages" | "memory" | "glossary" | "setup";
type PageFilter = "all" | "needs" | "outdated" | "translated";

const QUICK_LOCALES: I18nLocaleConfig[] = [
  { code: "es", label: "Español", direction: "ltr" },
  { code: "fr", label: "Français", direction: "ltr" },
  { code: "de", label: "Deutsch", direction: "ltr" },
  { code: "it", label: "Italiano", direction: "ltr" },
  { code: "pt-BR", label: "Português (Brasil)", prefix: "pt-br", direction: "ltr" },
  { code: "ja", label: "日本語", direction: "ltr" },
  { code: "nl", label: "Nederlands", direction: "ltr" },
  { code: "ar", label: "العربية", direction: "rtl" },
];

const STATE_BADGE: Record<TranslationState, { label: string; tone: "success" | "warning" | "neutral" }> = {
  translated: { label: "Translated", tone: "success" },
  outdated: { label: "Outdated", tone: "warning" },
  missing: { label: "Missing", tone: "neutral" },
};

function AddLanguageDialog({
  open,
  onClose,
  existingCodes,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  existingCodes: Set<string>;
  onAdd: (locale: I18nLocaleConfig) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [prefix, setPrefix] = useState("");
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setLabel("");
    setPrefix("");
    setDirection("ltr");
    setError(null);
  }, [open]);

  const pickQuick = (item: I18nLocaleConfig) => {
    setCode(item.code);
    setLabel(item.label);
    setPrefix(item.prefix ?? "");
    setDirection(item.direction ?? "ltr");
    setError(null);
  };

  const submit = async () => {
    const cleanCode = code.trim();
    const cleanLabel = label.trim();

    if (!cleanCode || !cleanLabel) {
      setError("Enter both a language code (like “es” or “fr-CA”) and a label.");
      return;
    }
    if (existingCodes.has(cleanCode.toLowerCase())) {
      setError(`“${cleanCode}” is already configured on this site.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        code: cleanCode,
        label: cleanLabel,
        ...(prefix.trim() ? { prefix: prefix.trim().toLowerCase() } : {}),
        ...(direction === "rtl" ? { direction: "rtl" } : {}),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = QUICK_LOCALES.filter((item) => !existingCodes.has(item.code.toLowerCase()));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a language"
      description="Adds the language to galley.config.json in Proof. Nothing is published until you publish."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} busyLabel="Adding…" onClick={() => void submit()}>
            Add language
          </Button>
        </>
      }
    >
      <div className="i18n-inline-stack">
        {error ? <ErrorState compact title="Couldn’t add language" error={error} /> : null}
        {suggestions.length > 0 ? (
          <Field label="Common languages">
            <div className="i18n-quick-picks">
              {suggestions.map((item) => (
                <Button key={item.code} variant="secondary" size="sm" onClick={() => pickQuick(item)}>
                  {item.label} ({item.code})
                </Button>
              ))}
            </div>
          </Field>
        ) : null}
        <div className="i18n-setup-grid">
          <Field label="Language code (BCP-47)" hint="For example: es, fr, de, pt-BR, ja, ar.">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="es" />
          </Field>
          <Field label="Display label" hint="Shown in language selectors and the editor.">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Español" />
          </Field>
        </div>
        <div className="i18n-setup-grid">
          <Field label="URL prefix (optional)" hint="Defaults to the lowercase language code.">
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={code ? code.toLowerCase() : "es"} />
          </Field>
          <Field label="Text direction">
            <Select
              aria-label="Text direction"
              options={[
                { value: "ltr", label: "Left to right (LTR)" },
                { value: "rtl", label: "Right to left (RTL)" },
              ]}
              value={direction}
              onChange={(value) => setDirection(value as "ltr" | "rtl")}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function PagesMatrixTab({
  siteId,
  overview,
  onTranslatePage,
}: {
  siteId: string;
  overview: I18nOverview;
  onTranslatePage: (page: I18nPageRow, localeCode: string) => void;
}) {
  const navigate = useNavigate();
  const targetLocales = overview.locales.filter((l) => !l.isDefault);
  const [selectedLocale, setSelectedLocale] = useState<string>(targetLocales[0]?.code ?? "");
  const [filter, setFilter] = useState<PageFilter>("all");
  const [search, setSearch] = useState("");
  const [scaffoldingKey, setScaffoldingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  useEffect(() => {
    if (targetLocales.length > 0 && !targetLocales.some((l) => l.code === selectedLocale)) {
      setSelectedLocale(targetLocales[0]!.code);
    }
  }, [targetLocales, selectedLocale]);

  const openManual = async (page: I18nPageRow, localeCode: string) => {
    const variant = page.variants[localeCode];

    if (variant?.path) {
      navigate(`/sites/${encodeURIComponent(siteId)}/edit?path=${encodeURIComponent(variant.path)}&original=1`);
      return;
    }
    setScaffoldingKey(`${page.sourcePath}:${localeCode}`);
    setActionError(null);
    try {
      const created = await api("POST /api/sites/:siteId/i18n/entry/create", {
        params: { siteId },
        body: { sourcePath: page.sourcePath, targetLocale: localeCode, applyMemory: true },
      });

      invalidate(i18nKeys.overview(siteId));
      navigate(`/sites/${encodeURIComponent(siteId)}/edit?path=${encodeURIComponent(created.path)}&original=1`);
    } catch (reason) {
      setActionError(reason);
    } finally {
      setScaffoldingKey(null);
    }
  };

  if (targetLocales.length === 0) {
    return (
      <EmptyState
        title="Add a second language to start translating"
        body="Once you add another language, every page on the site appears here with its translation status, localized URL slug, and one-click manual or automatic translation."
      />
    );
  }

  const activeLocale = targetLocales.find((l) => l.code === selectedLocale) ?? targetLocales[0]!;
  const query = search.trim().toLowerCase();
  const rows = overview.pages.filter((page) => {
    const variant = page.variants[activeLocale.code];
    const st: TranslationState = variant?.state ?? "missing";

    if (filter === "needs" && st === "translated") return false;
    if (filter === "outdated" && st !== "outdated") return false;
    if (filter === "translated" && st !== "translated") return false;
    if (query) {
      const hay = `${page.title} ${page.sourceUrl ?? ""} ${variant?.url ?? ""} ${page.collectionLabel}`.toLowerCase();

      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return (
    <div className="i18n-inline-stack">
      {actionError ? <ErrorState compact title="Couldn’t open translation" error={actionError} /> : null}
      <div className="i18n-toolbar">
        <Select
          aria-label="Target language"
          options={targetLocales.map((l) => ({ value: l.code, label: `${l.label} (${l.code})` }))}
          value={activeLocale.code}
          onChange={(value) => setSelectedLocale(value)}
        />
        <Select
          aria-label="Status filter"
          options={[
            { value: "all", label: "All pages" },
            { value: "needs", label: "Needs translation" },
            { value: "outdated", label: "Outdated" },
            { value: "translated", label: "Translated" },
          ]}
          value={filter}
          onChange={(value) => setFilter(value as PageFilter)}
        />
        <div className="i18n-toolbar__search">
          <Input
            type="search"
            aria-label="Filter pages"
            placeholder="Search pages or URLs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState compact title="No pages match this filter" body="Try switching the status filter or clearing the search box." />
      ) : (
        <div className="i18n-table-wrap">
          <table className="i18n-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Default URL ({overview.config.defaultLocale})</th>
                <th>Localized URL ({activeLocale.code})</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((page) => {
                const variant = page.variants[activeLocale.code];
                const state: TranslationState = variant?.state ?? "missing";
                const badge = STATE_BADGE[state];
                const rowKey = `${page.sourcePath}:${activeLocale.code}`;

                return (
                  <tr key={page.sourcePath}>
                    <td>
                      <div className="i18n-page-cell">
                        <span className="i18n-page-cell__title">{page.title}</span>
                        <span className="i18n-page-cell__col">{page.collectionLabel}</span>
                      </div>
                    </td>
                    <td>
                      <span className="i18n-url">{page.sourceUrl ?? page.sourceSlug}</span>
                    </td>
                    <td>
                      <span className="i18n-url">
                        {variant?.url ?? `/${activeLocale.prefix}/${page.sourceSlug === "index" ? "" : `${page.sourceSlug}/`}`}
                      </span>
                    </td>
                    <td>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                    <td>
                      <div className="i18n-row-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          busy={scaffoldingKey === rowKey}
                          busyLabel="Opening…"
                          onClick={() => void openManual(page, activeLocale.code)}
                        >
                          Edit manually
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => onTranslatePage(page, activeLocale.code)}
                        >
                          Translate
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TranslationMemoryTab({ siteId, overview }: { siteId: string; overview: I18nOverview }) {
  const { data, loading, error, refetch } = useI18nMemory(siteId, true);
  const targetLocales = overview.locales.filter((l) => !l.isDefault);
  const [search, setSearch] = useState("");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [newTargetLocale, setNewTargetLocale] = useState(targetLocales[0]?.code ?? "es");
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  useEffect(() => {
    if (targetLocales.length && !targetLocales.some((l) => l.code === newTargetLocale)) {
      setNewTargetLocale(targetLocales[0]!.code);
    }
  }, [targetLocales, newTargetLocale]);

  const persist = async (entries: TranslationMemoryEntry[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: TranslationMemoryFile = { version: 1, entries };

      await api("PUT /api/sites/:siteId/i18n/memory", { params: { siteId }, body: payload });
      invalidate(i18nKeys.memory(siteId));
      invalidate(i18nKeys.overview(siteId));
      await refetch();
    } catch (reason) {
      setSaveError(reason);
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!newSource.trim() || !newTarget.trim()) return;
    const current = data?.entries ?? [];
    const next: TranslationMemoryEntry = {
      id: `tm-${Date.now().toString(36)}`,
      sourceLocale: overview.config.defaultLocale,
      targetLocale: newTargetLocale,
      source: newSource.trim(),
      target: newTarget.trim(),
      updatedAt: new Date().toISOString(),
    };

    await persist([next, ...current]);
    setNewSource("");
    setNewTarget("");
  };

  const removeEntry = async (id: string) => {
    await persist((data?.entries ?? []).filter((item) => item.id !== id));
  };

  if (loading && !data) return <Skeleton lines={5} />;
  if (error && !data) return <ErrorState compact title="Couldn’t load Translation Memory" error={error} onRetry={() => void refetch()} />;

  const entries = data?.entries ?? [];
  const q = search.trim().toLowerCase();
  const visible = entries.filter((item) => {
    if (localeFilter !== "all" && item.targetLocale.toLowerCase() !== localeFilter.toLowerCase()) return false;
    if (q && !item.source.toLowerCase().includes(q) && !item.target.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="i18n-inline-stack">
      {saveError ? <ErrorState compact title="Couldn’t save Translation Memory" error={saveError} /> : null}
      <p className="i18n-panel__lede">
        Stored in <span className="g-mono">galley/i18n/memory.json</span>. Exact matches are reused automatically for <strong>0 AI credits ($0.00)</strong> and offered as one-click pills while editing manually.
      </p>

      <div className="i18n-add-form">
        <Field label={`Source (${overview.config.defaultLocale})`}>
          <Input value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder="Get in touch" />
        </Field>
        <Field label="Target language">
          <Select
            aria-label="Target language for new memory entry"
            options={(targetLocales.length ? targetLocales : overview.locales).map((l) => ({ value: l.code, label: `${l.label} (${l.code})` }))}
            value={newTargetLocale}
            onChange={(value) => setNewTargetLocale(value)}
          />
        </Field>
        <Field label="Translation">
          <Input value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="Ponte en contacto" />
        </Field>
        <Button variant="primary" busy={saving} busyLabel="Saving…" disabled={!newSource.trim() || !newTarget.trim()} onClick={() => void addEntry()}>
          Add segment
        </Button>
      </div>

      <div className="i18n-toolbar">
        <Select
          aria-label="Filter memory by language"
          options={[{ value: "all", label: "All languages" }, ...targetLocales.map((l) => ({ value: l.code, label: `${l.label} (${l.code})` }))]}
          value={localeFilter}
          onChange={(value) => setLocaleFilter(value)}
        />
        <div className="i18n-toolbar__search">
          <Input type="search" aria-label="Search memory" placeholder="Search saved segments…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tag variant="outline">{entries.length.toLocaleString()} saved segments</Tag>
      </div>

      {visible.length === 0 ? (
        <EmptyState compact title="No saved memory segments yet" body="Automatic translations fill Translation Memory automatically, or add recurring phrases above." />
      ) : (
        <div className="i18n-table-wrap">
          <table className="i18n-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Source</th>
                <th>Translation</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <Tag variant="mono">
                      {entry.sourceLocale} → {entry.targetLocale}
                    </Tag>
                  </td>
                  <td>{entry.source}</td>
                  <td>{entry.target}</td>
                  <td>
                    <div className="i18n-row-actions">
                      <Button variant="quiet" size="sm" icon="trash" disabled={saving} onClick={() => void removeEntry(entry.id)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GlossaryTab({ siteId, overview }: { siteId: string; overview: I18nOverview }) {
  const { data, loading, error, refetch } = useI18nGlossary(siteId, true);
  const targetLocales = overview.locales.filter((l) => !l.isDefault);
  const [term, setTerm] = useState("");
  const [doNotTranslate, setDoNotTranslate] = useState(true);
  const [note, setNote] = useState("");
  const [preferredLocale, setPreferredLocale] = useState(targetLocales[0]?.code ?? "es");
  const [preferredText, setPreferredText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const persist = async (terms: GlossaryTerm[]) => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: GlossaryFile = { version: 1, terms };

      await api("PUT /api/sites/:siteId/i18n/glossary", { params: { siteId }, body: payload });
      invalidate(i18nKeys.glossary(siteId));
      invalidate(i18nKeys.overview(siteId));
      await refetch();
    } catch (reason) {
      setSaveError(reason);
    } finally {
      setSaving(false);
    }
  };

  const addTerm = async () => {
    if (!term.trim()) return;
    const next: GlossaryTerm = {
      id: `term-${Date.now().toString(36)}`,
      term: term.trim(),
      ...(doNotTranslate ? { doNotTranslate: true } : {}),
      ...(!doNotTranslate && preferredText.trim() ? { translations: { [preferredLocale]: preferredText.trim() } } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    await persist([...(data?.terms ?? []), next]);
    setTerm("");
    setPreferredText("");
    setNote("");
  };

  const toggleDnt = async (id: string) => {
    await persist(
      (data?.terms ?? []).map((item) => (item.id === id ? { ...item, doNotTranslate: !item.doNotTranslate } : item))
    );
  };

  const removeTerm = async (id: string) => {
    await persist((data?.terms ?? []).filter((item) => item.id !== id));
  };

  if (loading && !data) return <Skeleton lines={4} />;
  if (error && !data) return <ErrorState compact title="Couldn’t load glossary" error={error} onRetry={() => void refetch()} />;

  const terms = data?.terms ?? [];

  return (
    <div className="i18n-inline-stack">
      {saveError ? <ErrorState compact title="Couldn’t save glossary" error={saveError} /> : null}
      <p className="i18n-panel__lede">
        Stored in <span className="g-mono">galley/i18n/glossary.json</span>. Brand names and preferred translations are injected into every automatic translation prompt.
      </p>

      <div className="i18n-add-form">
        <Field label="Term">
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Galley" />
        </Field>
        <Field label="Rule">
          <Checkbox checked={doNotTranslate} onChange={setDoNotTranslate} label="Do not translate" />
        </Field>
        {!doNotTranslate && targetLocales.length > 0 ? (
          <>
            <Field label="Language">
              <Select
                aria-label="Glossary preferred language"
                options={targetLocales.map((l) => ({ value: l.code, label: `${l.label} (${l.code})` }))}
                value={preferredLocale}
                onChange={(value) => setPreferredLocale(value)}
              />
            </Field>
            <Field label="Preferred translation">
              <Input value={preferredText} onChange={(e) => setPreferredText(e.target.value)} placeholder="Prueba" />
            </Field>
          </>
        ) : null}
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Product name" />
        </Field>
        <Button variant="primary" busy={saving} busyLabel="Saving…" disabled={!term.trim()} onClick={() => void addTerm()}>
          Add term
        </Button>
      </div>

      {terms.length === 0 ? (
        <EmptyState compact title="No glossary terms yet" body="Add brand names, product names, or terminology rules to keep translations consistent." />
      ) : (
        <div className="i18n-table-wrap">
          <table className="i18n-table">
            <thead>
              <tr>
                <th>Term</th>
                <th>Rule</th>
                <th>Note</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {terms.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.term}</strong>
                  </td>
                  <td>
                    {item.doNotTranslate ? (
                      <Badge tone="info">Do not translate</Badge>
                    ) : item.translations && Object.keys(item.translations).length > 0 ? (
                      <div className="i18n-quick-picks">
                        {Object.entries(item.translations).map(([loc, val]) => (
                          <Tag key={loc} variant="mono">
                            {loc}: {val}
                          </Tag>
                        ))}
                      </div>
                    ) : (
                      <Badge tone="neutral">Context note</Badge>
                    )}
                  </td>
                  <td>{item.note ?? "—"}</td>
                  <td>
                    <div className="i18n-row-actions">
                      <Button variant="secondary" size="sm" disabled={saving} onClick={() => void toggleDnt(item.id)}>
                        {item.doNotTranslate ? "Allow translation" : "Keep verbatim"}
                      </Button>
                      <Button variant="quiet" size="sm" icon="trash" disabled={saving} onClick={() => void removeTerm(item.id)}>
                        Remove
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RoutingSetupTab({
  siteId,
  overview,
  canManage,
  onSaved,
}: {
  siteId: string;
  overview: I18nOverview;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [strategy, setStrategy] = useState<I18nStrategy>(overview.config.strategy ?? "folder");
  const [prefixDefault, setPrefixDefault] = useState(Boolean(overview.config.prefixDefaultLocale));
  const [localizeSlugs, setLocalizeSlugs] = useState(overview.config.localizeSlugs !== false);
  const [saving, setSaving] = useState(false);
  const [syncingAstro, setSyncingAstro] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setStrategy(overview.config.strategy ?? "folder");
    setPrefixDefault(Boolean(overview.config.prefixDefaultLocale));
    setLocalizeSlugs(overview.config.localizeSlugs !== false);
  }, [overview.config]);

  const save = async (syncAstroConfig: boolean) => {
    if (syncAstroConfig) setSyncingAstro(true);
    else setSaving(true);
    setError(null);
    try {
      await api("PUT /api/sites/:siteId/i18n/config", {
        params: { siteId },
        body: {
          defaultLocale: overview.config.defaultLocale,
          locales: overview.config.locales,
          strategy,
          prefixDefaultLocale: prefixDefault,
          localizeSlugs,
          syncAstroConfig,
        },
      });
      onSaved();
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
      setSyncingAstro(false);
    }
  };

  const snippet = `---\nimport { LocaleHead, LanguageSelector } from "@galleycms/astro/components";\n---\n<head>\n  <LocaleHead />\n</head>\n<header>\n  <LanguageSelector />\n</header>`;

  const copySnippet = () => {
    void navigator.clipboard?.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="i18n-setup-grid">
      <section className="i18n-panel">
        <h2 className="i18n-panel__title">URL slugs & file layout</h2>
        <p className="i18n-panel__lede">
          Controls how translated files are stored in Git and how localized URLs are built. Changes land in Proof.
        </p>
        {error ? <ErrorState compact title="Couldn’t update language settings" error={error} /> : null}
        <Field label="File organization">
          <Select
            aria-label="File organization strategy"
            disabled={!canManage}
            options={[
              { value: "folder", label: "Folder per language (es/precios.md)" },
              { value: "suffix", label: "Filename suffix (precios.es.md)" },
            ]}
            value={strategy}
            onChange={(value) => setStrategy(value as I18nStrategy)}
          />
        </Field>
        <Toggle
          checked={localizeSlugs}
          disabled={!canManage}
          onChange={setLocalizeSlugs}
          label="Localize URL slugs"
          description="Translate page slugs per language (/pricing/ ↔ /es/precios/). Home pages always stay at /<locale>/."
        />
        <Toggle
          checked={prefixDefault}
          disabled={!canManage}
          onChange={setPrefixDefault}
          label={`Prefix default language (/${overview.config.defaultLocale}/…)`}
          description="Off keeps the default language at the root (/pricing/); on puts every language under its own prefix."
        />
        {canManage ? (
          <div className="i18n-quick-picks">
            <Button variant="primary" busy={saving} busyLabel="Saving…" onClick={() => void save(false)}>
              Save URL settings
            </Button>
            {overview.hasAstroConfig ? (
              <Button variant="secondary" busy={syncingAstro} busyLabel="Syncing…" onClick={() => void save(true)}>
                Sync Astro i18n config
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="i18n-panel">
        <h2 className="i18n-panel__title">Language selector & hreflang tags</h2>
        <p className="i18n-panel__lede">
          Drop <span className="g-mono">&lt;LocaleHead /&gt;</span> into your layout <span className="g-mono">&lt;head&gt;</span> for automatic <span className="g-mono">hreflang</span> links (including <span className="g-mono">x-default</span>) and <span className="g-mono">&lt;LanguageSelector /&gt;</span> into your header or footer. Both read <span className="g-mono">galley/i18n/manifest.json</span> so translated slugs link directly to their counterparts.
        </p>
        <pre className="i18n-code">
          <code>{snippet}</code>
        </pre>
        <div>
          <Button variant="secondary" size="sm" icon="copy" onClick={copySnippet}>
            {copied ? "Copied" : "Copy Astro snippet"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** /sites/:siteId/languages — Languages, coverage matrix, TM, Glossary & Astro selector setup. */
export function LanguagesScreen() {
  const { siteId = "" } = useParams();
  const may = useMay();
  const canManage = may("PUT /api/sites/:siteId/i18n/config");
  const { data: overview, loading, error, refetch } = useI18nOverview(siteId);
  const [tab, setTab] = useState<TabId>("pages");
  const [addOpen, setAddOpen] = useState(false);
  const [translateState, setTranslateState] = useState<{
    open: boolean;
    locales?: string[];
    paths?: string[];
    scopeLabel?: string;
  }>({ open: false });

  useTopBar({ crumbs: [{ label: "Languages" }] });

  const refreshAll = () => {
    invalidate(i18nKeys.overview(siteId));
    void refetch();
  };

  const handleAddLocale = async (locale: I18nLocaleConfig) => {
    if (!overview) return;
    await api("PUT /api/sites/:siteId/i18n/config", {
      params: { siteId },
      body: {
        ...overview.config,
        locales: [...overview.config.locales, locale],
      },
    });
    refreshAll();
  };

  const handleRemoveLocale = async (code: string) => {
    if (!overview) return;
    await api("PUT /api/sites/:siteId/i18n/config", {
      params: { siteId },
      body: {
        ...overview.config,
        locales: overview.config.locales.filter((l) => l.code.toLowerCase() !== code.toLowerCase()),
      },
    });
    refreshAll();
  };

  if (loading && !overview) {
    return (
      <div className="g-page app-page">
        <PageHeader title="Languages" />
        <Skeleton lines={6} />
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="g-page app-page">
        <PageHeader title="Languages" />
        <ErrorState title="Couldn’t load languages" error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!overview) return null;

  const targetLocales = overview.locales.filter((l) => !l.isDefault);
  const existingCodes = new Set(overview.locales.map((l) => l.code.toLowerCase()));
  const needsAttentionCount = targetLocales.reduce((sum, l) => sum + l.missing + l.outdated, 0);

  return (
    <div className="g-page app-page">
      <PageHeader
        title="Languages"
        description="Translate individual pages or the whole site automatically, edit side by side with the original language, and keep localized URL slugs and hreflang tags in sync."
        actions={
          <>
            {canManage ? (
              <Button variant="secondary" icon="plus" onClick={() => setAddOpen(true)}>
                Add language
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon="languages"
              disabled={targetLocales.length === 0}
              onClick={() => setTranslateState({ open: true })}
            >
              Translate site…
            </Button>
          </>
        }
      />

      <div className="i18n-screen">
        {overview.astroDetected ? (
          <p className="i18n-panel__lede">
            Detected {overview.locales.length} languages automatically from <span className="g-mono">astro.config.*</span>.
          </p>
        ) : null}

        <section className="i18n-cards" aria-label="Configured languages">
          {overview.locales.map((locale: I18nLocaleSummary) => {
            const translatedPct = locale.total > 0 ? Math.round((locale.translated / locale.total) * 100) : 100;
            const outdatedPct = locale.total > 0 ? Math.round((locale.outdated / locale.total) * 100) : 0;
            const pendingCount = locale.missing + locale.outdated;

            return (
              <article key={locale.code} className={`i18n-card ${locale.isDefault ? "i18n-card--default" : ""}`}>
                <div className="i18n-card__head">
                  <div className="i18n-card__title">
                    <span className="i18n-card__label">{locale.label}</span>
                    <div className="i18n-card__meta">
                      <span className="g-mono">{locale.code}</span>
                      <span>·</span>
                      <span className="g-mono">{locale.urlPattern}</span>
                      {locale.direction === "rtl" ? <Tag variant="outline">RTL</Tag> : null}
                    </div>
                  </div>
                  {locale.isDefault ? <Badge tone="info">Default</Badge> : <Badge tone={pendingCount === 0 ? "success" : "neutral"}>{locale.percent}%</Badge>}
                </div>

                <div className="i18n-card__bar" aria-hidden="true">
                  <span className="i18n-card__bar-fill" style={{ inlineSize: `${translatedPct}%` }} />
                  {outdatedPct > 0 ? <span className="i18n-card__bar-outdated" style={{ inlineSize: `${outdatedPct}%` }} /> : null}
                </div>

                <div className="i18n-card__stats">
                  <span>{locale.translated} translated</span>
                  {!locale.isDefault && locale.outdated > 0 ? <span>· {locale.outdated} outdated</span> : null}
                  {!locale.isDefault && locale.missing > 0 ? <span>· {locale.missing} missing</span> : null}
                </div>

                {!locale.isDefault ? (
                  <div className="i18n-card__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setTranslateState({ open: true, locales: [locale.code] })}
                    >
                      {pendingCount > 0 ? `Translate ${pendingCount} missing…` : "Re-translate…"}
                    </Button>
                    {canManage ? (
                      <Button variant="quiet" size="sm" onClick={() => void handleRemoveLocale(locale.code)}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        <div>
          <Tabs
            label="Language workspace"
            idBase="i18n"
            value={tab}
            onChange={(next) => setTab(next as TabId)}
            items={[
              { id: "pages", label: "Pages", count: needsAttentionCount > 0 ? needsAttentionCount : overview.totalSourcePages, quietCount: needsAttentionCount === 0 },
              { id: "memory", label: "Translation memory", count: overview.memoryCount, quietCount: true },
              { id: "glossary", label: "Glossary", count: overview.glossaryCount, quietCount: true },
              { id: "setup", label: "Language selector & URLs" },
            ]}
          />

          <TabPanel idBase="i18n" id="pages" value={tab}>
            <PagesMatrixTab
              siteId={siteId}
              overview={overview}
              onTranslatePage={(page, localeCode) =>
                setTranslateState({
                  open: true,
                  locales: [localeCode],
                  paths: [page.sourcePath],
                  scopeLabel: page.title,
                })
              }
            />
          </TabPanel>

          <TabPanel idBase="i18n" id="memory" value={tab}>
            <TranslationMemoryTab siteId={siteId} overview={overview} />
          </TabPanel>

          <TabPanel idBase="i18n" id="glossary" value={tab}>
            <GlossaryTab siteId={siteId} overview={overview} />
          </TabPanel>

          <TabPanel idBase="i18n" id="setup" value={tab}>
            <RoutingSetupTab siteId={siteId} overview={overview} canManage={canManage} onSaved={refreshAll} />
          </TabPanel>
        </div>
      </div>

      <AddLanguageDialog open={addOpen} onClose={() => setAddOpen(false)} existingCodes={existingCodes} onAdd={handleAddLocale} />

      <TranslateDialog
        siteId={siteId}
        open={translateState.open}
        onClose={() => setTranslateState({ open: false })}
        locales={overview.locales}
        initialLocales={translateState.locales}
        paths={translateState.paths}
        scopeLabel={translateState.scopeLabel}
        defaultTranslateSlugs={overview.config.localizeSlugs !== false}
        onFinished={refreshAll}
      />
    </div>
  );
}
