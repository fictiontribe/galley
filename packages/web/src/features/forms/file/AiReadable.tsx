/**
 * One quiet line for a site that got the site kit before it could publish
 * the version AI assistants read (markdown copies of the pages, llms.txt):
 * a button that runs only that step of "Set it up for me" — the kit's build
 * step in astro.config and src/data/visibility.json, as pending changes.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Job } from "@galley/core/types";
import { errorShape } from "@/lib/api";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { Button } from "@/ui";
import { BUILD_MODE_LEVEL } from "@galley/core/install/route-access";
import { useMayBuild, whoMayFirst } from "@/lib/may";
import { startKitSetup, useKitStatus } from "./kit";

/** In place of "Turn it on", for someone whose role doesn't include changing the site's code. */
export const AI_READABLE_BY_OTHERS = `${whoMayFirst(BUILD_MODE_LEVEL)} can turn it on.`;

export function AiReadableOffer() {
  const navigate = useNavigate();
  const siteId = useSite((s) => s.detail?.id ?? "");
  const status = useKitStatus(siteId);
  const [busy, setBusy] = useState(false);
  const mayBuild = useMayBuild();
  const step = status.data?.steps.find((candidate) => candidate.id === "visibility");
  if (!status.data?.kit || !status.data.buildAllowed || step?.state !== "ready") return null;
  const ended = (done: Job) => {
    setBusy(false);
    if (done.state === "error") notify({ tone: "danger", title: "Couldn’t turn it on", body: done.detail ?? "Nothing was changed." });
    else notify({ tone: done.output ? "warning" : "success", title: "The AI-readable version is on", body: done.detail, ...(done.output ? { detail: done.output } : {}), action: { label: "Open Proof", onClick: () => navigate(`/sites/${siteId}/proof`) }, duration: 12000 });
  };
  const run = async () => {
    setBusy(true);
    try {
      await startKitSetup(siteId, ended, "visibility");
    } catch (error) {
      setBusy(false);
      notify({ tone: "danger", title: "Couldn’t turn it on", body: errorShape(error).message });
    }
  };
  return (
    <p className="kit-quiet">
      <span>Also publish a version AI assistants can read: a plain copy of each page and a contents file for them.</span>
      {/* Turning it on writes the site's code (build mode). */}
      {mayBuild ? (
        <Button size="sm" variant="quiet" busy={busy} busyLabel="Turning it on…" onClick={() => void run()}>
          Turn it on
        </Button>
      ) : (
        <span className="g-hint">{AI_READABLE_BY_OTHERS}</span>
      )}
    </p>
  );
}
