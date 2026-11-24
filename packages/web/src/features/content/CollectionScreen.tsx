import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { ChangeStatus, Collection, EntryQuery, EntrySummary } from "@galley/core/types";
import "@/styles/content.css";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { collectionNouns, count } from "@/lib/format";
import { invalidate, useQuery } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { usePreviewStatus } from "@/lib/stores/preview";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, ConfirmDialog, EmptyState, ErrorState, Icon, Input, PageHeader, SegmentedControl, Select, Skeleton } from "@/ui";
import { EntryRows, PAGE_SIZE } from "./collection/EntryRows";
import { collectionSiteTarget, openPreviewTarget } from "@/features/hosting/previewLinks";
import { needsEntry } from "@/features/preview/entry";
import { useMeta } from "@/lib/stores/meta";
import { NewEntryDialog } from "./collection/NewEntryDialog";
import { useWhoPublishes } from "@/lib/may";

type StatusFilter = "all" | Exclude<ChangeStatus, "deleted">;
type Sort = "title" | "date" | "modified";

const SEARCH_DELAY_MS = 250;

const STATUS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "modified", label: "Edited" },
  { value: "added", label: "New" },
  { value: "clean", label: "Unchanged" },
];

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function sortOptions(collection: Collection): Array<{ value: Sort; label: string }> {
  return [
    ...(collection.dateField ? [{ value: "date" as const, label: "Newest first" }] : []),
    { value: "title", label: "Title A–Z" },
    { value: "modified", label: "Recently changed" },
  ];
}

function CollectionList({ siteId, collection }: { siteId: string; collection: Collection }) {
  const navigate = useNavigate();
  const media = useSite((s) => s.detail?.model.media ?? null);
  const production = useSite((s) => s.detail?.model.urls.production ?? s.detail?.model.urls.staging ?? null);
  const preview = usePreviewStatus(siteId);
  const publishes = useWhoPublishes();
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed.trim(), SEARCH_DELAY_MS);
  const [sort, setSort] = useState<Sort>(collection.dateField ? "date" : "title");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EntrySummary | null>(null);

  const query = useMemo<EntryQuery>(
    () => ({ sort, order: sort === "title" ? "asc" : "desc", ...(search ? { search } : {}), ...(status !== "all" ? { status } : {}) }),
    [sort, search, status],
  );
  const queryKey = useMemo(() => [...keys.entries(siteId, collection.id), JSON.stringify(query)] as const, [siteId, collection.id, query]);
  const fetchPage = useCallback(
    (offset: number, limit: number) => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: collection.id, ...query, offset, limit } }),
    [siteId, collection.id, query],
  );
  const first = useQuery([...queryKey, 0], () => fetchPage(0, PAGE_SIZE));
  const everything = useQuery([...keys.entries(siteId, collection.id), "total"], () => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: collection.id, limit: 1 } }));
  const total = first.data?.total ?? 0;
  const filtered = Boolean(search) || status !== "all";

  const siteUrl = useCallback(
    (path: string) => {
      const base = preview?.state === "ready" && preview.url ? preview.url : production;
      return base ? new URL(path, base).toString() : null;
    },
    [preview?.state, preview?.url, production],
  );
  // A hosted install's preview answers only a browser let in through its entry: the row opens it that way.
  const meta = useMeta((s) => s.meta);
  const openSite = useMemo(() => {
    if (!needsEntry(meta)) return undefined;
    return (path: string) => {
      const target = collectionSiteTarget(meta, preview?.state === "ready" && preview.url ? preview.url : null, production, path);
      if (target) openPreviewTarget(siteId, target);
    };
  }, [meta, siteId, preview?.state, preview?.url, production]);

  // An author column appears when the entries carry one.
  const hasAuthor = Boolean(first.data?.items.some((entry) => entry.author));
  const columns = useMemo(() => ({ thumb: Boolean(collection.imageField), author: hasAuthor, date: Boolean(collection.dateField) }), [collection, hasAuthor]);
  const cols = [columns.thumb ? "48px" : "", "minmax(0, 1fr)", columns.author ? "minmax(0, 160px)" : "", columns.date ? "112px" : "", "auto", "28px"].filter(Boolean).join(" ");
  const noun = collection.label.toLowerCase();

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    await api("DELETE /api/sites/:siteId/entry", { params: { siteId }, query: { path: target.path } });
    invalidate(keys.entries(siteId, collection.id));
    notify({
      tone: "neutral",
      title: `${target.title} deleted`,
      body: `It leaves the site when ${publishes}. Until then, Undo brings it back.`,
      action: {
        label: "Undo",
        onClick: () =>
          void useChanges
            .getState()
            .discard([target.path])
            .then(() => invalidate(keys.entries(siteId, collection.id)))
            .catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t bring it back", body: errorShape(error).message })),
      },
    });
  };

  let body;
  if (first.loading) {
    body = (
      <div className="app-rows" aria-busy="true" style={{ ["--row-cols" as string]: cols }}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="app-row app-row--skeleton" style={{ top: index * 52 }}>
            {columns.thumb ? <Skeleton width={48} height={36} /> : null}
            <Skeleton width={`${70 - index * 6}%`} height={13} />
            {columns.date ? <Skeleton width={72} height={11} /> : null}
            <span />
            <span />
          </div>
        ))}
      </div>
    );
  } else if (first.status === "error" && !first.data) {
    body = <ErrorState title={`Couldn’t load ${noun}`} error={first.error} onRetry={() => void first.refetch()} />;
  } else if (total === 0 && !filtered) {
    body = (
      <EmptyState
        className="app-rows__empty"
        title={`No ${noun} yet.`}
        body={`${collection.label} you add show up here${collection.url ? " and on the site" : ""}.`}
        actions={
          collection.create ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New {collection.singular}
            </Button>
          ) : null
        }
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        className="app-rows__empty"
        compact
        title={search ? `No ${noun} mention “${search}”.` : `No ${noun} are ${STATUS.find((item) => item.value === status)?.label.toLowerCase()}.`}
        body={search ? "Try a shorter word, or clear the search." : "Show all of them instead."}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setTyped("");
              setStatus("all");
            }}
          >
            Show all
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="app-rows__frame" style={{ ["--row-cols" as string]: cols }}>
        <EntryRows siteId={siteId} queryKey={queryKey} fetchPage={fetchPage} total={total} columns={columns} media={media} label={collection.label} onDelete={setDeleting} siteUrl={siteUrl} openSite={openSite} />
      </div>
    );
  }

  return (
    <div className="app-screen app-collection">
      <PageHeader
        title={collection.label}
        description={collection.description ?? (everything.data ? count(everything.data.total, collection.singular, collectionNouns(collection).many) : undefined)}
        actions={
          collection.create ? (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New {collection.singular}
            </Button>
          ) : null
        }
      />
      <div className="app-collection__tools">
        <span className="app-collection__search">
          <Icon name="search" />
          <Input type="search" value={typed} placeholder={`Search ${noun}…`} aria-label={`Search ${noun}`} onChange={(event) => setTyped(event.target.value)} />
        </span>
        <Select aria-label="Sort" value={sort} options={sortOptions(collection)} onChange={(value) => setSort(value as Sort)} />
        <SegmentedControl label="Show" options={STATUS} value={status} onChange={setStatus} />
        <span className="app-collection__count" aria-live="polite">
          {first.data && filtered ? `${count(total, "match", "matches")}` : ""}
        </span>
      </div>
      {body}
      <NewEntryDialog
        siteId={siteId}
        collection={collection}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(entry) => {
          setCreating(false);
          invalidate(keys.entries(siteId, collection.id));
          notify({ tone: "success", title: `${collection.singular.charAt(0).toUpperCase()}${collection.singular.slice(1)} created`, body: `It’s waiting in Proof until ${publishes}.` });
          navigate(`/sites/${siteId}/edit?path=${encodeURIComponent(entry.path)}`);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        body={`It comes off the site when ${publishes}. Until then you can undo this — the ${collection.singular} stays in Proof as a deletion you can discard.`}
        confirmLabel={`Delete ${collection.singular}`}
        busyLabel="Deleting"
        cancelLabel={`Keep ${collection.singular}`}
        errorTitle={`Couldn’t delete the ${collection.singular}`}
        onConfirm={remove}
      />
    </div>
  );
}

/**
 * /sites/:siteId/c/:collectionId — a calm, searchable, sortable list of a
 * collection's entries with "New …". Settings files skip the list.
 */
export function CollectionScreen() {
  const { siteId = "", collectionId = "" } = useParams();
  const collection = useSite((s) => s.detail?.model.collections.find((c) => c.id === collectionId));
  const siteStatus = useSite((s) => s.status);
  useTopBar({ crumbs: [{ label: collection?.label ?? "Collection" }] });

  if (!collection) {
    if (siteStatus !== "ready") {
      return (
        <div className="app-screen" aria-busy="true">
          <Skeleton width={220} height={34} />
        </div>
      );
    }
    return (
      <div className="app-screen app-screen--center">
        <EmptyState title="This collection isn’t on this site." body="It may have been renamed or hidden in the site’s settings." mark="dele" />
      </div>
    );
  }
  if (collection.kind === "data") return <Navigate replace to={`/sites/${siteId}/edit?path=${encodeURIComponent(collection.path)}`} />;
  return <CollectionList key={collection.id} siteId={siteId} collection={collection} />;
}
