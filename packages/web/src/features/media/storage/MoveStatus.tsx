/**
 * A move of the site's files, on the Media screen: its progress while it
 * runs, then how it ended — how many files were copied, how many pages
 * changed, what stayed in the repository and what still uses it,
 * and the list of anything that went wrong. The ending stays until it is
 * dismissed or the next move replaces it, so it can be read on coming back.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { MediaStorageStatus } from "@galley/core/media-storage/contract";
import { useStoredState } from "@/features/preview/useStoredState";
import { relativeTime } from "@/lib/format";
import { useJob, useJobs, useShowingJob } from "@/lib/stores/jobs";
import { Button, IconButton, ProofMark, Spinner } from "@/ui";
import { moveTitle, stayedLabel, stayedLine } from "./moveWords";

export function MoveStatus({ siteId, status }: { siteId: string; status: MediaStorageStatus | null | undefined }) {
  const navigate = useNavigate();
  const started = status?.moving ?? null;
  const live = useJob(started?.id ?? null);
  const job = started ? (live ?? started) : null;
  const result = status?.lastMove ?? null;
  // Dismissed on this computer: the time of the move that was read.
  const [read, setRead] = useStoredState<number>(`galley.media.move-read.${siteId}`, 0);
  // Shown here, so the activity tray leaves it out while this screen is open.
  useShowingJob(job?.id ?? null);
  // How a move ended is read here too, so the tray doesn't say it a second time.
  const ended = useJobs((s) =>
    s.jobs
      .filter((candidate) => candidate.kind === "media" && candidate.siteId === siteId && candidate.state !== "running" && !s.dismissed.includes(candidate.id))
      .map((candidate) => candidate.id)
      .join(" ")
  );

  useEffect(() => {
    for (const id of ended.split(" ").filter(Boolean)) useJobs.getState().dismiss(id);
  }, [ended]);

  if (job) {
    const running = job.state === "running";
    const percent = running && job.progress !== undefined ? Math.round(job.progress * 100) : null;

    return (
      <div className="app-card app-card--pad media-move" role="status" aria-live="polite">
        <Spinner label="Working" />
        <div className="media-move__main">
          <p className="media-move__title">{job.label}</p>
          <p className="media-move__text">{running ? (job.detail ?? "Working…") : "Finishing…"}</p>
          <div className="app-progress" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
            <span className={percent === null ? "app-progress__bar app-progress__bar--indeterminate" : "app-progress__bar"} style={percent === null ? undefined : { inlineSize: `${percent}%` }} />
          </div>
        </div>
      </div>
    );
  }
  if (!result || read >= result.at) return null;
  return (
    <div className={`app-card app-card--pad media-move media-move--${result.state}`} role="status">
      <ProofMark kind={result.state === "done" ? "reg" : "bang"} />
      <div className="media-move__main">
        <p className="media-move__title">
          {moveTitle(result)} <span className="media-move__when">{relativeTime(result.at)}</span>
        </p>
        <p className="media-move__text">{result.summary}</p>
        {result.problems.length ? (
          <ul className="media-move__list" aria-label="What went wrong">
            {result.problems.map((problem) => (
              <li key={`${problem.path} ${problem.reason}`}>
                {problem.path}: {problem.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {result.stayedFiles ? (
          <details className="media-move__more">
            <summary>{stayedLabel(result)}</summary>
            <ul className="media-move__list">
              {result.stayed.map((item) => (
                <li key={item.path}>{stayedLine(item)}</li>
              ))}
              {result.stayedFiles > result.stayed.length ? <li>and {result.stayedFiles - result.stayed.length} more</li> : null}
            </ul>
          </details>
        ) : null}
        <div className="media-move__actions">
          <Button size="sm" variant="secondary" onClick={() => navigate(`/sites/${siteId}/proof`)}>
            Review in Proof
          </Button>
        </div>
      </div>
      <IconButton icon="close" label="Dismiss" tooltip={false} onClick={() => setRead(result.at)} />
    </div>
  );
}
