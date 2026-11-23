/**
 * A field whose values come from a plugin's data source (`"dataSource"` in
 * galley.config.json): products in a shop, collections, people. The file
 * keeps only the item's `value` — a plain string — so the picker shows what
 * that value stands for (looked up with `?value=`), searches the source as
 * the person types, and writes nothing but the value. When the plugin that
 * offers the source is off, the field is the plain text box it would
 * otherwise be, with a note saying why.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { DataSourceOption, DataSourceSummary, PluginCatalog } from "@galley/core/api";
import type { Field, JsonValue } from "@galley/core/types";
import { api, errorShape, rawFileUrl } from "@/lib/api";
import { setQueryData, useQuery } from "@/lib/query";
import { usePreviewStatus } from "@/lib/stores/preview";
import { keys } from "@/lib/sync";
import { Button, Icon, IconButton, Input, ProofMark, Skeleton, Spinner, cx } from "@/ui";
import { useForm } from "../form/context";
import { asText, useBinding } from "./binding";
import { placeholderFor, type FieldProps } from "./common";
import { goneLine, moveActive, pickImageSrc, PICK_DELAY_MS, PICK_LIMIT } from "./dataSource";
import { FieldShell } from "./FieldShell";

/** The site's catalogue, shared with every other screen that reads it. */
function useSourceInfo(siteId: string, sourceId: string): { loading: boolean; source: DataSourceSummary | null } {
  const catalog = useQuery<PluginCatalog>(keys.catalog(siteId), () => api("GET /api/sites/:siteId/catalog", { params: { siteId } }));
  const source = catalog.data?.dataSources?.find((candidate) => candidate.id === sourceId) ?? null;
  // A catalogue that can't be read is treated like a source that's off: the text box still works.
  return { loading: catalog.loading, source };
}

const lookupKey = (siteId: string, sourceId: string, value: string) => ["site", siteId, "data-source", sourceId, "value", value] as const;

/** What a saved value stands for: the item, `null` when the source no longer has it, `undefined` while unknown. */
function useLookup(siteId: string, sourceId: string, value: string): { item: DataSourceOption | null | undefined; error: unknown } {
  const result = useQuery(
    lookupKey(siteId, sourceId, value),
    async () => {
      const answer = await api("GET /api/sites/:siteId/data-sources/:sourceId", { params: { siteId, sourceId }, query: { value } });
      return "item" in answer ? answer.item : null;
    },
    { enabled: Boolean(value) },
  );
  return { item: result.status === "success" ? (result.data ?? null) : undefined, error: result.status === "error" ? result.error : undefined };
}

/** Search results for what's typed, debounced, the newest answer winning. */
function useSearch(siteId: string, sourceId: string, query: string, open: boolean) {
  const [state, setState] = useState<{ items: DataSourceOption[]; loading: boolean; error: string | null; query: string | null }>({ items: [], loading: false, error: null, query: null });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: null }));
    const timer = setTimeout(() => {
      api("GET /api/sites/:siteId/data-sources/:sourceId", { params: { siteId, sourceId }, query: { q: query.trim(), limit: PICK_LIMIT }, signal: controller.signal })
        .then((answer) => setState({ items: "items" in answer ? answer.items : [], loading: false, error: null, query }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ items: [], loading: false, error: errorShape(error).message, query });
        });
    }, PICK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [siteId, sourceId, query, open]);
  return state;
}

function Thumb({ image, compact }: { image: string | undefined; compact?: boolean }) {
  const { siteId, media } = useForm();
  const preview = usePreviewStatus(siteId);
  // The file in the site's media folders first (same origin as the app), then the running preview, which serves
  // every path from the site's root as visitors get it — pictures outside the media folders included.
  const sources = [pickImageSrc(image, null, media, (path) => rawFileUrl(siteId, path)), pickImageSrc(image, preview?.state === "ready" ? preview.url : null, null, (path) => rawFileUrl(siteId, path))].filter(
    (src, index, all): src is string => Boolean(src) && all.indexOf(src) === index,
  );
  const [failed, setFailed] = useState(0);
  const key = sources.join(" ");
  useEffect(() => setFailed(0), [key]);
  const src = sources[failed];
  return (
    <span className={cx("app-pick__thumb", compact && "app-pick__thumb--sm")} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" onError={() => setFailed((count) => count + 1)} /> : <Icon name="image" />}
    </span>
  );
}

export interface DataSourcePickerProps {
  sourceId: string;
  source: DataSourceSummary;
  value: string;
  /** The new value, or `undefined` to clear the field. */
  onChange: (next: string | undefined) => void;
  /** What one value is called, for buttons and screen readers: "Product". */
  noun: string;
  onFocus?: () => void;
  /** Smaller, for one row of a list. */
  compact?: boolean;
  autoFocus?: boolean;
  /** Spoken name of the search box when no label is tied to it (list rows). */
  ariaLabel?: string;
}

/** The picker itself: the chosen item as a card, or a search box with results under it. */
export function DataSourcePicker({ sourceId, source, value, onChange, noun, onFocus, compact, autoFocus, ariaLabel }: DataSourcePickerProps) {
  const { siteId } = useForm();
  const [editing, setEditing] = useState(!value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const { item, error: lookupError } = useLookup(siteId, sourceId, value);
  const results = useSearch(siteId, sourceId, query, open);
  const lower = noun.toLowerCase();

  // Another edit (the assistant, Put back, Undo) can set or clear the value under the picker.
  useEffect(() => {
    if (!value) setEditing(true);
  }, [value]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => setActive(results.items.length > 0 ? 0 : -1), [results.items]);

  const choose = (option: DataSourceOption) => {
    // The card shows the choice at once; the look-up would only say the same.
    setQueryData(lookupKey(siteId, sourceId, option.value), option);
    onChange(option.value);
    setOpen(false);
    setQuery("");
    setEditing(false);
    requestAnimationFrame(() => change.current?.focus());
  };
  const stopEditing = () => {
    setOpen(false);
    setQuery("");
    if (value) {
      setEditing(false);
      requestAnimationFrame(() => change.current?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open || value) {
        event.preventDefault();
        event.stopPropagation();
        if (open && !value) setOpen(false);
        else stopEditing();
      }
      return;
    }
    if (event.key === "Enter") {
      const option = results.items[active];
      if (open && option) {
        event.preventDefault();
        choose(option);
      }
      return;
    }
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    const next = moveActive(event.key, active, results.items.length);
    if (next !== null && open) {
      event.preventDefault();
      setActive(next);
    }
  };

  if (value && !editing) {
    const gone = item === null;
    const title = item?.title ?? value;
    return (
      <div className={cx("app-pick__chosen", compact && "app-pick__chosen--sm", gone && "app-pick__chosen--gone")}>
        <Thumb image={item?.image} compact={compact} />
        <span className="app-pick__text">
          {item === undefined && !lookupError ? (
            <Skeleton width={140} height={14} />
          ) : (
            <span className="app-pick__title">{title}</span>
          )}
          {gone ? (
            // In a list row there's only room for the fact; the field on its own also says what follows from it.
            <span className="app-pick__gone" title={compact ? "The page leaves it out until you choose another." : undefined}>
              <ProofMark kind="bang" />
              {compact ? goneLine(source.label) : `${goneLine(source.label)}. The page leaves it out until you choose another.`}
            </span>
          ) : item?.detail ? (
            <span className="app-pick__detail">{item.detail}</span>
          ) : lookupError ? (
            <span className="app-pick__detail">{`Couldn’t check it just now: ${errorShape(lookupError).message}`}</span>
          ) : null}
          {item && item.title !== value && !compact ? <span className="app-pick__value">{value}</span> : null}
        </span>
        <span className="app-pick__actions">
          <Button
            ref={change}
            size="sm"
            variant="secondary"
            aria-label={`Change ${lower}, now “${title}”`}
            onClick={() => {
              setEditing(true);
              setOpen(true);
              onFocus?.();
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Change
          </Button>
          {compact ? null : <IconButton icon="close" label={`Clear ${lower}`} onClick={() => onChange(undefined)} />}
        </span>
      </div>
    );
  }

  const showList = open && (results.loading || results.error !== null || results.query !== null);
  const typed = query.trim();
  return (
    <div className={cx("app-pick", compact && "app-pick--sm")}>
      <span className="app-pick__box">
        <Icon name="search" className="app-pick__icon" />
        <Input
          ref={input}
          size={compact ? "sm" : "md"}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results.items[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={`Search ${source.label.toLowerCase()}…`}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onBlur={() => {
            setOpen(false);
            // Leaving without typing anything keeps the current choice on show.
            if (value && !query.trim()) setEditing(false);
          }}
          onKeyDown={onKeyDown}
        />
        {value ? (
          <Button size="sm" variant="quiet" onMouseDown={(event) => event.preventDefault()} onClick={stopEditing}>
            Keep current
          </Button>
        ) : null}
      </span>
      <div className="app-pick__pop" hidden={!showList}>
        <ul className="app-pick__list" id={listId} role="listbox" aria-label={source.label}>
          {results.items.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cx("app-pick__option", index === active && "app-pick__option--active", option.value === value && "app-pick__option--current")}
              // Keep focus in the box, so the list doesn't close before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <Thumb image={option.image} compact />
              <span className="app-pick__text">
                <span className="app-pick__title">{option.title}</span>
                {option.detail ? <span className="app-pick__detail">{option.detail}</span> : null}
              </span>
              {option.value === value ? <Icon name="check" className="app-pick__mark" label="Chosen now" /> : null}
            </li>
          ))}
        </ul>
        <p className="app-pick__status" role="status">
          {results.loading ? (
            <>
              <Spinner label="Searching" /> Searching…
            </>
          ) : results.error ? (
            results.error
          ) : results.items.length === 0 ? (
            typed ? `Nothing in ${source.label.toLowerCase()} matches “${typed}”.` : `${source.label} has nothing to offer yet.`
          ) : results.items.length >= PICK_LIMIT ? (
            `Showing the first ${PICK_LIMIT}. Type more to narrow it down.`
          ) : (
            <span className="g-sr">{`${results.items.length} ${results.items.length === 1 ? "result" : "results"}`}</span>
          )}
        </p>
      </div>
    </div>
  );
}

/** The note a field shows when the plugin behind its choices is off. */
export function DataSourceOffNote({ sourceId }: { sourceId: string }) {
  const { siteId } = useForm();
  return (
    <>
      {/* The source's own id is the one name known while its plugin is off; it rides along for whoever sets plugins up. */}
      <span title={`Data source: ${sourceId}`}>Its choices come from a plugin that’s switched off here, so type the value. </span>
      <Link to={`/sites/${siteId}/plugins`}>Open Plugins</Link>
    </>
  );
}

/** One value picked from a data source. */
export function DataSourceField({ field, path, showKey }: FieldProps) {
  const { siteId } = useForm();
  const sourceId = field.dataSource ?? "";
  const { loading, source } = useSourceInfo(siteId, sourceId);
  const { value, change, commit, focus } = useBinding(field, path, Boolean(source));
  const text = asText(value);

  if (loading) {
    return (
      <FieldShell field={field} path={path} showKey={showKey}>
        <Skeleton height={32} />
      </FieldShell>
    );
  }
  if (!source) {
    return (
      <FieldShell field={field} path={path} showKey={showKey} note={<DataSourceOffNote sourceId={sourceId} />}>
        <Input value={text} placeholder={placeholderFor(field)} onChange={(event) => change(event.target.value)} onBlur={commit} onFocus={focus} />
      </FieldShell>
    );
  }
  return (
    <FieldShell field={field} path={path} showKey={showKey}>
      <DataSourcePicker sourceId={sourceId} source={source} value={text} noun={field.label} onFocus={focus} onChange={(next) => change(next)} />
    </FieldShell>
  );
}

/** For lists: whether the items pick from a source, and that source once known. */
export function useListSource(of: Field | undefined): { sourceId: string | null; loading: boolean; source: DataSourceSummary | null } {
  const { siteId } = useForm();
  const sourceId = of?.dataSource ?? null;
  const info = useSourceInfo(siteId, sourceId ?? "");
  return sourceId ? { sourceId, ...info } : { sourceId: null, loading: false, source: null };
}

/** One row of a list whose items pick from a source: the picker, compact. */
export function DataSourceRowPicker({ sourceId, source, value, onChange, noun, label, onFocus, autoFocus }: { sourceId: string; source: DataSourceSummary; value: JsonValue | undefined; onChange: (next: string | undefined) => void; noun: string; label: string; onFocus: () => void; autoFocus: boolean }) {
  return <DataSourcePicker compact sourceId={sourceId} source={source} value={asText(value)} onChange={onChange} noun={noun} ariaLabel={label} onFocus={onFocus} autoFocus={autoFocus} />;
}
