/**
 * Moving the site's files between the repository and the bucket, and
 * changing the bucket's public address: each shows its plan first (how many
 * files, how many places in how many pages, what stays), then runs as a job
 * whose progress shows with the app's other jobs. Safe to run again.
 */
import { useState } from "react";
import type { MediaMovePlan, MediaMoveRequest } from "@galley/core/media-storage/contract";
import { api, errorShape } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useJobs } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { Button, Checkbox, ConfirmDialog, Field, Input } from "@/ui";

function describe(plan: MediaMovePlan): string {
  if (plan.kind === "address") {
    return `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"} will use ${plan.publicUrl} instead. Galley first checks the new address serves the bucket’s files; nothing changes if it doesn’t.`;
  }
  const where = plan.to === "repository" ? "the repository" : "the bucket";
  const parts = [
    `${plan.files} ${plan.files === 1 ? "file" : "files"} (${bytes(plan.bytes)}) will be copied to ${where}${plan.done ? `, ${plan.done} of them already there from an earlier run` : ""}.`,
    `${plan.references} ${plan.references === 1 ? "place" : "places"} in ${plan.pages} ${plan.pages === 1 ? "page" : "pages"} will point at ${plan.to === "repository" ? "the site’s own addresses" : "their full addresses"}.`,
  ];
  if (plan.to !== "repository") parts.push(plan.keepCopies ? "The repository keeps its copies." : "Then the repository’s copies are removed; they leave the site when you publish. A file a page Galley can’t update still uses stays where it is.");
  else parts.push("The bucket keeps its files; remove them once the pages are published.");
  if (plan.staying) parts.push(`${plan.staying.files} stay where they are: ${plan.staying.reason}`);
  if (plan.problems.length) parts.push(`${plan.problems.length} can’t be moved: ${plan.problems.map((problem) => `${problem.path} (${problem.reason})`).join("; ")}.`);
  return parts.join(" ");
}

export function MoveFiles({ siteId, onStarted }: { siteId: string; onStarted: () => void }) {
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
    onStarted();
    notify({ tone: "neutral", title: job.label, body: "Its progress shows at the bottom of the window. Pages it changes wait in Proof." });
  };

  return (
    <section className="media-storage__move" aria-label="Move files">
      <h3 className="g-eyebrow">Move files</h3>
      <div className="app-media-details__actions">
        <Button size="sm" variant="secondary" busy={planning === "to"} onClick={() => void ask({ kind: "move", from: "repository", to: "bucket" }, "to")}>
          Move the repository’s files to the bucket…
        </Button>
        <Button size="sm" variant="secondary" busy={planning === "back"} onClick={() => void ask({ kind: "move", from: "bucket", to: "repository" }, "back")}>
          Bring the bucket’s files back…
        </Button>
      </div>
      <form
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
      </form>
      <ConfirmDialog
        open={request !== null && plan !== null}
        onClose={() => setRequest(null)}
        title={plan?.kind === "address" ? "Use the new address?" : plan?.to === "repository" ? "Bring the files back to the repository?" : "Move the files to the bucket?"}
        body={
          plan ? (
            <>
              <p>{describe(plan)}</p>
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
