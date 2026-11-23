import { useState } from "react";
import type { MediaItem, VideoCandidate } from "@galley/core/types";
import { api, errorShape, isApiFailure } from "@/lib/api";
import { bytes, money } from "@/lib/format";
import { invalidate } from "@/lib/query";
import { useJob, useShowingJob } from "@/lib/stores/jobs";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, Field, IconButton, Input, ProofMark, Spinner } from "@/ui";
import { suggestSlug } from "@/features/content/collection/slug";
import { CANDIDATE_HOURS, VIDEO_SIZE_LIMIT } from "./cost";
import { discardVideo, useVideoJob, useVideoJobs, videoCandidateUrl, type TrackedVideo } from "./jobs";
import "./video.css";

/** One made video: play it, name it, save it into media — or throw it away. */
function Candidate({ siteId, candidate, onSaved, onGone }: { siteId: string; candidate: VideoCandidate; onSaved: (item: MediaItem) => void; onGone: () => void }) {
  const [name, setName] = useState(() => suggestSlug(candidate.prompt).split("-").slice(0, 6).join("-"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playable, setPlayable] = useState(true);
  const tooBig = candidate.size > VIDEO_SIZE_LIMIT;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const item = await api("POST /api/sites/:siteId/videos/save", { params: { siteId }, body: { candidateId: candidate.id, ...(name.trim() ? { filename: name.trim() } : {}) } });
      invalidate(keys.media(siteId));
      onSaved(item);
    } catch (caught) {
      setError(errorShape(caught).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vid-candidate">
      <div className="vid-candidate__player">
        {playable ? (
          // A made video has no captions to offer: it's the person's own clip, previewed before saving.
          <video src={videoCandidateUrl(candidate.id)} controls preload="metadata" playsInline onError={() => setPlayable(false)} aria-label={`The video made from “${candidate.prompt}”`} />
        ) : (
          <p className="vid-candidate__unplayable">This preview can’t be played in the browser. Save it to see it in media, or discard it.</p>
        )}
      </div>
      <div className="vid-candidate__side">
        <p className="vid-candidate__facts">
          <span>{bytes(candidate.size)}</span>
          {candidate.cost !== undefined ? <span>Cost {money(candidate.cost)}</span> : null}
        </p>
        {tooBig ? (
          <p className="g-margin-note vid-candidate__warn">
            <ProofMark kind="bang" />
            <span>It’s larger than 25 MB, the most media keeps, so it can’t be saved. Make a shorter or lower-resolution one.</span>
          </p>
        ) : (
          <Field label="Name it" hint="Lowercase words with hyphens; .mp4 is added for you." error={error ?? undefined}>
            <Input value={name} mono onChange={(event) => setName(event.target.value)} placeholder="loaf-being-sliced" />
          </Field>
        )}
        <div className="vid-candidate__actions">
          <Button
            variant="quiet"
            onClick={() => {
              void discardVideo(candidate.id);
              onGone();
            }}
          >
            Discard
          </Button>
          <Button variant="primary" busy={saving} busyLabel="Saving" disabled={tooBig} onClick={() => void save()}>
            Save to media
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One video being made, or made: progress while it runs, the result when it's done. */
function VideoJobRow({ video, onSaved }: { video: TrackedVideo; onSaved: (item: MediaItem) => void }) {
  const status = useVideoJob(video.jobId);
  const live = useJob(video.jobId);
  const forget = useVideoJobs((s) => s.forget);
  const [gone, setGone] = useState<string[]>([]);
  // Shown here, so the activity tray leaves it out while this screen is open.
  useShowingJob(video.jobId);
  const job = live ?? status.data?.job ?? null;
  const candidates = (status.data?.candidates ?? []).filter((candidate) => !gone.includes(candidate.id));

  if (status.status === "error" && !status.data) {
    const unknown = isApiFailure(status.error) && status.error.status === 404;
    return (
      <li className="vid-job vid-job--error">
        <div className="vid-job__head">
          <ProofMark kind="bang" />
          <span className="vid-job__prompt">“{video.prompt}”</span>
          <IconButton icon="close" label="Dismiss" onClick={() => forget(video.jobId)} />
        </div>
        <p className="vid-job__detail">{unknown ? "This video isn’t known any more — the app was restarted or it expired. Nothing more will be charged for it." : errorShape(status.error).message}</p>
      </li>
    );
  }
  if (!job) {
    return (
      <li className="vid-job">
        <div className="vid-job__head">
          <Spinner label="Reading" />
          <span className="vid-job__prompt">“{video.prompt}”</span>
        </div>
      </li>
    );
  }

  const percent = job.progress !== undefined ? Math.round(job.progress * 100) : null;
  const done = job.state === "done";
  const left = done && status.data && !status.fetching && candidates.length === 0;

  return (
    <li className={`vid-job vid-job--${job.state}`}>
      <div className="vid-job__head">
        {job.state === "running" ? <Spinner label="Making the video" /> : <ProofMark kind={done ? "reg" : "bang"} />}
        <span className="vid-job__prompt">“{video.prompt}”</span>
        {job.state !== "running" ? <IconButton icon="close" label={done && candidates.length ? "Discard and dismiss" : "Dismiss"} onClick={() => {
          for (const candidate of candidates) void discardVideo(candidate.id);
          forget(video.jobId);
        }} /> : null}
      </div>
      <p className="vid-job__detail" role="status">
        {job.detail ?? (job.state === "running" ? "Working…" : done ? "The video is ready." : "Stopped.")}
        {job.state === "error" ? " Nothing was added to media." : ""}
      </p>
      {job.state === "running" ? (
        <div className="app-progress" role="progressbar" aria-label={`Making “${video.prompt}”`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          <span className={percent === null ? "app-progress__bar app-progress__bar--indeterminate" : "app-progress__bar"} style={percent === null ? undefined : { inlineSize: `${percent}%` }} />
        </div>
      ) : null}
      {done && candidates.length > 0 ? (
        <>
          {candidates.map((candidate) => (
            <Candidate
              key={candidate.id}
              siteId={video.siteId}
              candidate={candidate}
              onGone={() => {
                const rest = candidates.filter((other) => other.id !== candidate.id);
                setGone((ids) => [...ids, candidate.id]);
                if (rest.length === 0) forget(video.jobId);
              }}
              onSaved={(item) => {
                const rest = candidates.filter((other) => other.id !== candidate.id);
                setGone((ids) => [...ids, candidate.id]);
                if (rest.length === 0) forget(video.jobId);
                onSaved(item);
              }}
            />
          ))}
          <p className="g-hint">Kept for {CANDIDATE_HOURS} hours from when it was made, unless you save it.</p>
        </>
      ) : null}
      {left ? <p className="g-hint">Nothing left to save from this one.</p> : null}
    </li>
  );
}

/** The site's videos being made and waiting to be saved, at the top of Media. Nothing when there are none. */
export function VideoJobs({ siteId, onSaved }: { siteId: string; onSaved: (item: MediaItem) => void }) {
  const tracked = useVideoJobs((s) => s.tracked).filter((video) => video.siteId === siteId);
  if (tracked.length === 0) return null;
  return (
    <section className="vid-jobs" aria-label="Videos">
      <h2 className="g-eyebrow vid-jobs__title">{tracked.length === 1 ? "Video" : "Videos"}</h2>
      <ul className="vid-jobs__list">
        {tracked.map((video) => (
          <VideoJobRow key={video.jobId} video={video} onSaved={onSaved} />
        ))}
      </ul>
    </section>
  );
}
