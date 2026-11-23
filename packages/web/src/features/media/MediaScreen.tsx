import { useState } from "react";
import { useParams } from "react-router-dom";
import type { MediaItem } from "@galley/core/types";
import "@/styles/media.css";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, ConfirmDialog, Dialog, PageHeader, SegmentedControl } from "@/ui";
import { GeneratePanel } from "./GeneratePanel";
import { MediaDetails } from "./MediaDetails";
import { MediaLibraryPane } from "./MediaLibraryPane";
import type { MediaKind } from "./mediaPaths";
import { GenerateVideoPanel } from "./video/GenerateVideoPanel";
import { VideoJobs } from "./video/VideoJobs";

const KINDS: Array<{ value: MediaKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "document", label: "Documents" },
];

/** /sites/:siteId/media — every image on the site: search, upload, generate, details, delete. */
export function MediaScreen() {
  const { siteId = "" } = useParams();
  useTopBar({ crumbs: [{ label: "Media" }] });
  const media = useQuery(keys.media(siteId), () => api("GET /api/sites/:siteId/media", { params: { siteId } }));
  const [kind, setKind] = useState<MediaKind>("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [makingVideo, setMakingVideo] = useState(false);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const selected = media.data?.items.find((item) => item.path === selectedPath) ?? null;

  /**
   * Delete, then offer Undo — which discards the deletion, exactly as Proof
   * would, so it works until the deletion is published. A file that was never
   * published can't come back, so that one asks first instead.
   */
  const remove = async (item: MediaItem) => {
    await api("DELETE /api/sites/:siteId/media", { params: { siteId }, query: { path: item.path } });
    invalidate(keys.media(siteId));
    setSelectedPath((current) => (current === item.path ? null : current));
    if (item.status === "added") {
      notify({ tone: "neutral", title: `${item.name} deleted` });
      return;
    }
    notify({
      tone: "neutral",
      title: `${item.name} deleted`,
      body: item.status === "modified" ? "It leaves the site when you publish. Until then, Undo brings back the published version." : "It leaves the site when you publish. Until then, Undo brings it back.",
      action: {
        label: "Undo",
        onClick: () =>
          void useChanges
            .getState()
            .discard([item.path])
            .then(() => {
              invalidate(keys.media(siteId));
              setSelectedPath(item.path);
              notify({ tone: "neutral", title: `${item.name} is back` });
            })
            .catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t bring it back", body: errorShape(error).message })),
      },
    });
  };
  // Published files go at once (Undo brings them back); files with unpublished work ask first.
  const requestDelete = (item: MediaItem) => {
    if (item.status === "clean") void remove(item).catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t delete the file", body: errorShape(error).message, detail: errorShape(error).detail }));
    else setDeleting(item);
  };

  return (
    <div className="app-screen app-media">
      <PageHeader
        title="Media"
        description="Images and files the site uses. Drop files anywhere here, or paste an image."
        actions={
          <>
            <Button variant="secondary" icon="play" onClick={() => setMakingVideo(true)}>
              Generate a video
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setGenerating(true)}>
              Generate an image
            </Button>
          </>
        }
      />
      <VideoJobs
        siteId={siteId}
        onSaved={(item) => {
          setSelectedPath(item.path);
          notify({ tone: "success", title: "Video saved", body: `“${item.name}” is in media, ready to use.` });
        }}
      />
      <div className="app-media__layout">
        <MediaLibraryPane
          siteId={siteId}
          kind={kind}
          selected={selectedPath}
          onSelect={(item) => setSelectedPath(item?.path ?? null)}
          onGenerate={() => setGenerating(true)}
          toolbar={<SegmentedControl label="Show" options={KINDS} value={kind} onChange={setKind} />}
        />
        <MediaDetails siteId={siteId} item={selected} onDelete={requestDelete} />
      </div>
      <Dialog open={generating} onClose={() => setGenerating(false)} title="Generate an image" size="xl">
        {generating ? (
          <GeneratePanel
            siteId={siteId}
            onSaved={(item) => {
              setGenerating(false);
              setSelectedPath(item.path);
              notify({ tone: "success", title: "Image saved", body: `“${item.name}” is in media, ready to use.` });
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={makingVideo} onClose={() => setMakingVideo(false)} title="Generate a video" size="lg">
        {makingVideo ? (
          <GenerateVideoPanel
            siteId={siteId}
            onCancel={() => setMakingVideo(false)}
            onStarted={() => {
              setMakingVideo(false);
              notify({ tone: "neutral", title: "Making the video", body: "It takes a few minutes. It waits at the top of Media when it’s ready — you can leave this screen." });
            }}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        body={
          deleting?.status === "added"
            ? "It hasn’t been published, so once it’s deleted it can’t be brought back. Pages that use it will show a missing image."
            : "Its unpublished changes are lost; Undo brings back only the published version. Pages that use it will show a missing image once this is published."
        }
        confirmLabel="Delete file"
        busyLabel="Deleting"
        cancelLabel="Keep it"
        errorTitle="Couldn’t delete the file"
        onConfirm={() => (deleting ? remove(deleting) : undefined)}
      />
    </div>
  );
}
