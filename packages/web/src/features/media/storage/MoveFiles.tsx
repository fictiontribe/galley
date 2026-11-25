/**
 * Moving the site's files between the repository and the bucket, and
 * changing the bucket's public address: each shows its plan first (how many
 * files, how many places in how many pages, what stays), then runs as a job
 * whose progress and ending show on the Media screen (MoveStatus), and in the
 * activity tray anywhere else. Safe to run again.
 */
import { useState } from "react";
import type { MediaMovePlan, MediaMoveRequest } from "@galley/core/media-storage/contract";
import { api, errorShape } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { useJobs } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { Button, Checkbox, ConfirmDialog, Field, Input } from "@/ui";
import { alsoMentionedWords, planWords } from "./moveWords";
import { storageKeys } from "./useMediaStorage";

export function MoveFiles({ siteId, bucket, images, onStarted }: { siteId: string; bucket: boolean; images: boolean; onStarted: () => void }) {
  const [request, setRequest] = useState<MediaMoveRequest | null>(null);
  const [plan, setPlan] = useState<MediaMovePlan | null>(null);
  const [keepCopies, setKeepCopies] = useState(false);
  const [address, setAddress] = useState("");
  const [planning, setPlanning] = useState<string | null>(null);

  const ask = async (next: MediaMoveRequest, label: string) => {
    setPlanning(label);
    try {
      setPlan(await api("POST /api/sites/:siteId/media/storage/move/plan", { params: { siteId }, body: next }));
      setRequest(next);
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t plan it", body: errorShape(error).message });
    } finally {
      setPlanning(null);
    }
  };

  const go = async () => {
    if (!request) return;
    const body = request.kind === "move" && request.from === "repository" ? { ...request, keepCopies } : request;
    const job = await api("POST /api/sites/:siteId/media/storage/move", { params: { siteId }, body });
    useJobs.getState().upsert(job);
    setRequest(null);
    // The Media screen shows its progress and how it ends; elsewhere the activity tray does.
    invalidate(storageKeys.status(siteId));
    onStarted();
  };

  return (
    <section className="media-storage__move" aria-label="Move files">
      <h3 className="g-eyebrow">Move files</h3>
      <div className="app-media-details__actions">
        {images ? (
          <Button size="sm" variant="secondary" busy={planning === "to-images"} onClick={() => void ask({ kind: "move", from: "repository", to: "images" }, "to-images")}>
            Move the repository’s pictures to Cloudflare Images…
          </Button>
        ) : null}
        {bucket ? (
          <Button size="sm" variant="secondary" busy={planning === "to"} onClick={() => void ask({ kind: "move", from: "repository", to: "bucket" }, "to")}>
            Move the repository’s files to the bucket…
          </Button>
        ) : null}
        {images ? (
          <Button size="sm" variant="secondary" busy={planning === "back-images"} onClick={() => void ask({ kind: "move", from: "images", to: "repository" }, "back-images")}>
            Bring the pictures in Images back…
          </Button>
        ) : null}
        {bucket ? (
          <Button size="sm" variant="secondary" busy={planning === "back"} onClick={() => void ask({ kind: "move", from: "bucket", to: "repository" }, "back")}>
            Bring the bucket’s files back…
          </Button>
        ) : null}
      </div>
      {bucket ? <form
        className="media-storage__address"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) void ask({ kind: "address", store: "bucket", publicUrl: address.trim() }, "address");
        }}
      >
        <Field label="Change the public address" hint="When the bucket gets a new address, such as a custom domain: every page is updated to it.">
          <Input mono size="sm" value={address} placeholder="https://media.example.com" onChange={(event) => setAddress(event.target.value)} />
        </Field>
        <Button size="sm" variant="secondary" type="submit" busy={planning === "address"} disabled={!address.trim()}>
          Check what changes…
        </Button>
      </form> : null}
      <ConfirmDialog
        open={request !== null && plan !== null}
        onClose={() => setRequest(null)}
        title={plan?.kind === "address" ? "Use the new address?" : plan?.to === "repository" ? "Bring the files back to the repository?" : plan?.to === "images" ? "Move the pictures to Cloudflare Images?" : "Move the files to the bucket?"}
        body={
          plan ? (
            <>
              <p>{planWords(plan)}</p>
              {alsoMentionedWords(plan) ? <p>{alsoMentionedWords(plan)}</p> : null}
              {plan.kind === "move" && plan.from === "repository" ? <Checkbox label="Keep the repository’s copies too" checked={keepCopies} onChange={setKeepCopies} /> : null}
            </>
          ) : null
        }
        confirmLabel={plan?.kind === "address" ? "Use it" : "Move them"}
        busyLabel="Starting"
        cancelLabel="Not now"
        errorTitle="Couldn’t start"
        onConfirm={go}
      />
    </section>
  );
}
