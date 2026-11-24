import { useMemo, useRef, useState, type ReactNode } from "react";
import type { MediaItem } from "@galley/core/types";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Button, EmptyState, ErrorState, Icon, Input, Skeleton, cx } from "@/ui";
import { MediaGrid } from "./MediaGrid";
import { filterMedia, sortMedia, type MediaKind } from "./mediaPaths";
import { UploadList, useFileDrop } from "./UploadList";
import { useUploads } from "./useUploads";
import { isStored, placeWords } from "./storage/useMediaStorage";
import { notify } from "@/lib/stores/toasts";

export interface MediaLibraryPaneProps {
  siteId: string;
  kind: MediaKind;
  selected: string | null;
  onSelect: (item: MediaItem | null) => void;
  onActivate?: (item: MediaItem) => void;
  /** Offered in the empty state ("Generate one"). */
  onGenerate?: () => void;
  /** Extra controls beside search (the type filter on the Media screen). */
  toolbar?: ReactNode;
  /** Only files kept in the bucket or Cloudflare Images that no page uses. */
  unusedOnly?: boolean;
  className?: string;
}

/** Search, upload (button, drop, paste) and the grid — shared by the Media screen and the picker. */
export function MediaLibraryPane({ siteId, kind, selected, onSelect, onActivate, onGenerate, toolbar, unusedOnly, className }: MediaLibraryPaneProps) {
  const media = useQuery(keys.media(siteId), () => api("GET /api/sites/:siteId/media", { params: { siteId } }));
  const [query, setQuery] = useState("");
  const { tasks, upload, dismiss } = useUploads(siteId);
  const fileInput = useRef<HTMLInputElement>(null);
  const items = useMemo(() => filterMedia(sortMedia(media.data?.items ?? []), query, kind).filter((item) => !unusedOnly || (isStored(item) && item.used === false)), [media.data, query, kind, unusedOnly]);
  const problems = Object.values(media.data?.storeProblems ?? {});

  const add = async (files: File[]) => {
    const saved = await upload(files);
    const last = saved[saved.length - 1];
    if (last) onSelect(last);
    // Say plainly where each file went once any went outside the repository, or not where it would have.
    if (saved.some((item) => isStored(item) || item.placement)) {
      const lines = saved.map((item) => item.placement ?? `${item.name} is in ${placeWords(item)}.`);
      notify({ tone: "neutral", title: saved.length === 1 ? `${saved[0]!.name} uploaded` : `${saved.length} files uploaded`, body: lines.join(" ") });
    }
  };
  const { over, handlers } = useFileDrop((files) => void add(files));
  const total = media.data?.items.length ?? 0;

  let body;
  if (media.loading) {
    body = (
      <div className="app-media-grid" aria-busy="true">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="app-media-tile__skeleton" />
        ))}
      </div>
    );
  } else if (media.status === "error" && !media.data) {
    body = <ErrorState title="Couldn’t load the media" error={media.error} onRetry={() => void media.refetch()} />;
  } else if (total === 0) {
    body = (
      <EmptyState
        compact
        title="No images yet."
        body="Drop images here, or describe one and the assistant will make it."
        actions={
          <>
            <Button variant="primary" icon="upload" onClick={() => fileInput.current?.click()}>
              Upload
            </Button>
            {onGenerate ? (
              <Button variant="secondary" onClick={onGenerate}>
                Generate
              </Button>
            ) : null}
          </>
        }
      />
    );
  } else if (items.length === 0 && unusedOnly) {
    body = <EmptyState compact title="Every file in the bucket is used on a page." body="Files no page uses show here, so they can be removed." />;
  } else if (items.length === 0) {
    body = <EmptyState compact title={query ? `Nothing in media matches “${query}”.` : "Nothing of this kind in media."} body="Try a shorter word, or show everything." actions={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>} />;
  } else {
    body = <MediaGrid siteId={siteId} items={items} selected={selected} onSelect={onSelect} onActivate={onActivate} label="Media" />;
  }

  return (
    <div className={cx("app-library", over && "app-library--over", className)} {...handlers}>
      <div className="app-library__bar">
        <span className="app-library__search">
          <Icon name="search" />
          <Input size="sm" type="search" value={query} placeholder="Search media…" aria-label="Search media" onChange={(event) => setQuery(event.target.value)} />
        </span>
        {toolbar}
        <span className="g-toolbar__spacer" />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,video/mp4,application/pdf"
          className="g-sr"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (files.length) void add(files);
          }}
        />
        <Button size="sm" variant="secondary" icon="upload" onClick={() => fileInput.current?.click()}>
          Upload
        </Button>
      </div>
      <UploadList tasks={tasks} onDismiss={dismiss} />
      {problems.length ? (
        <p className="media-storage__note" role="status">
          <Icon name="warning" /> {problems.join(" ")}
        </p>
      ) : null}
      <div className="app-library__body">{body}</div>
      {over ? (
        <div className="app-library__drop" aria-hidden="true">
          <span>Drop to add to media</span>
        </div>
      ) : null}
    </div>
  );
}
