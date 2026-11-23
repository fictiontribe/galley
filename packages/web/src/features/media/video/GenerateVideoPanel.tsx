import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Job, MediaItem, VideoAspect } from "@galley/core/types";
import { api, errorShape, isApiFailure, rawFileUrl } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useMeta } from "@/lib/stores/meta";
import { keys } from "@/lib/sync";
import { Button, ErrorState, Field, IconButton, ProofMark, SegmentedControl, Select, Skeleton, Textarea, Toggle, buttonClass } from "@/ui";
import { MediaGrid } from "../MediaGrid";
import { CANDIDATE_HOURS, choices, costLine, defaultDuration, modelFacts } from "./cost";
import { useVideoJobs } from "./jobs";
import { preferredProvider, useVideoPrefs } from "./prefs";
import { BrandDirectionNote } from "@/features/brand/BrandDirectionNote";
import { useImageryDirection } from "@/features/brand/useBrand";
import "./video.css";

const ASPECTS: readonly VideoAspect[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
/** What the engine accepts as a first frame (ai/videos/service.ts). */
const FRAME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface GenerateVideoPanelProps {
  siteId: string;
  /** Close without starting. */
  onCancel?: () => void;
  /** The job started: the dialog can close; the video is followed on the Media screen. */
  onStarted: (job: Job) => void;
}

/** Picks a picture from the site's media for the video to start from. */
function FirstFrame({ siteId, value, onChange }: { siteId: string; value: MediaItem | null; onChange: (item: MediaItem | null) => void }) {
  const [open, setOpen] = useState(false);
  const media = useQuery(keys.media(siteId), () => api("GET /api/sites/:siteId/media", { params: { siteId } }));
  const pictures = (media.data?.items ?? []).filter((item) => FRAME_TYPES.has(item.type));
  return (
    <Field label="Start from a picture" group hint="Optional. The video begins on this picture — PNG, JPEG or WebP from media.">
      <div className="vid-frame">
        {value ? (
          <span className="vid-frame__chosen">
            <img src={rawFileUrl(siteId, value.path)} alt="" />
            <span className="vid-frame__name">{value.name}</span>
            <IconButton icon="close" label={`Don’t start from ${value.name}`} onClick={() => onChange(null)} />
          </span>
        ) : null}
        <Button size="sm" variant="secondary" icon="image" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close the pictures" : value ? "Choose another…" : "Choose a picture…"}
        </Button>
      </div>
      {open ? (
        media.loading ? (
          <Skeleton height={120} />
        ) : pictures.length === 0 ? (
          <p className="g-hint">There are no PNG, JPEG or WebP pictures in media yet. Upload one first.</p>
        ) : (
          <div className="vid-frame__grid">
            <MediaGrid
              siteId={siteId}
              items={pictures}
              selected={value?.path ?? null}
              label="Pictures to start from"
              onSelect={(item) => onChange(item)}
              onActivate={(item) => {
                onChange(item);
                setOpen(false);
              }}
            />
          </div>
        )
      ) : null}
    </Field>
  );
}

/** Describe a video → choose what the model offers → see the cost → start. The video is made in the background. */
export function GenerateVideoPanel({ siteId, onStarted, onCancel }: GenerateVideoPanelProps) {
  const providers = useQuery(keys.videoProviders(), () => api("GET /api/videos/providers"));
  const prefs = useVideoPrefs();
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const list = useMemo(() => providers.data?.providers ?? [], [providers.data]);
  // The site's imagery direction rides along with the request, as it does for images.
  const brandDirection = useImageryDirection(siteId);

  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [resolution, setResolution] = useState("");
  const [aspect, setAspect] = useState<VideoAspect | "">("");
  const [audio, setAudio] = useState(true);
  const [frame, setFrame] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Start from the service and model chosen in Settings, else the first set up.
  useEffect(() => {
    if (providerId || list.length === 0 || !prefs.ready) return;
    const provider = preferredProvider(list, prefs.provider);
    if (!provider) return;
    setProviderId(provider.id);
    setModelId(prefs.provider === provider.id && prefs.model && provider.models.some((model) => model.id === prefs.model) ? prefs.model : provider.defaultModel);
  }, [list, providerId, prefs.provider, prefs.model, prefs.ready]);

  const provider = list.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId) ?? provider?.models.find((item) => item.id === provider.defaultModel) ?? provider?.models[0];
  const durations = choices(model?.durations);
  const resolutions = choices(model?.resolutions);
  const aspects = choices(model?.aspects).filter((value): value is VideoAspect => (ASPECTS as readonly string[]).includes(value));

  // A new model resets the options to what it offers.
  useEffect(() => {
    setDuration(defaultDuration(model)?.toString() ?? "");
    setResolution(model?.resolutions?.[0] ?? "");
    setAspect((model?.aspects?.find((value) => (ASPECTS as readonly string[]).includes(value)) as VideoAspect | undefined) ?? "");
    setAudio(Boolean(model?.audio));
    if (!model?.supportsFirstFrame) setFrame(null);
  }, [model]);

  if (providers.loading) {
    return (
      <div className="vid-generate" aria-busy="true">
        <Skeleton height={76} />
        <Skeleton width={260} height={28} />
      </div>
    );
  }
  if (providers.status === "error" && !providers.data) {
    const missing = isApiFailure(providers.error) && providers.error.status === 404;
    return missing ? (
      <p className="g-margin-note">
        <ProofMark kind="stet" />
        <span>This server doesn’t make videos. A newer version of the app does, with a video plugin turned on.</span>
      </p>
    ) : (
      <ErrorState compact title="Couldn’t load the video services" error={providers.error} onRetry={() => void providers.refetch()} />
    );
  }
  if (list.length === 0) {
    return (
      <div className="vid-generate">
        <div className="vid-setup">
          <p className="vid-setup__title">No video service is set up yet.</p>
          <p className="vid-setup__body">Videos are made by a plugin. OpenRouter comes with the app: turn it on in Plugins and add its API key, then come back here.</p>
          <Link className={buttonClass("primary", "sm")} to="/plugins">
            Open plugins
          </Link>
        </div>
      </div>
    );
  }

  const seconds = duration ? Number(duration) : undefined;
  const ready = Boolean(provider?.configured && model && prompt.trim().length >= 3);

  const start = async () => {
    if (!provider || !model) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api("POST /api/sites/:siteId/videos/generate", {
        params: { siteId },
        body: {
          prompt: prompt.trim(),
          provider: provider.id,
          model: model.id,
          ...(seconds ? { durationSeconds: seconds } : {}),
          ...(resolution && resolutions.length ? { resolution } : {}),
          ...(aspect && aspects.length ? { aspect } : {}),
          ...(model.audio ? { audio } : {}),
          ...(frame && model.supportsFirstFrame ? { firstFramePath: frame.path } : {}),
          ...(brandDirection ? { brandDirection } : {}),
        },
      });
      useVideoJobs.getState().track({ jobId: job.id, siteId, prompt: prompt.trim(), startedAt: job.startedAt });
      onStarted(job);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const unconfigured = isApiFailure(error) && error.shape.code === "unconfigured";
  return (
    <div className="vid-generate">
      {provider && !provider.configured ? (
        <div className="vid-setup" role="status">
          <p className="vid-setup__title">{provider.label} needs its API key before it can make videos.</p>
          <p className="vid-setup__body">Add the key on the Plugins screen. It’s kept on this {hosted ? "server" : "computer"} with the app’s other keys, and never shown again.</p>
          <Link className={buttonClass("primary", "sm")} to="/plugins">
            Add the key
          </Link>
        </div>
      ) : null}
      <Field label="Describe the video" hint="What happens, where, and how the camera moves. A sentence or two is plenty.">
        <Textarea value={prompt} rows={3} maxRows={8} placeholder="Slow push-in on a loaf being sliced on a floured board, morning light from the left…" onChange={(event) => setPrompt(event.target.value)} />
      </Field>
      <BrandDirectionNote direction={brandDirection} />
      <div className="app-form-row">
        {list.length > 1 ? (
          <Field label="Service">
            <Select
              value={providerId}
              onChange={(next) => {
                setProviderId(next);
                setModelId(list.find((item) => item.id === next)?.defaultModel ?? "");
              }}
              options={list.map((item) => ({ value: item.id, label: item.configured ? item.label : `${item.label} — needs its key` }))}
            />
          </Field>
        ) : null}
        {provider ? (
          <Field label="Model" hint={model ? modelFacts(model) : undefined}>
            <Select value={model?.id ?? ""} onChange={setModelId} options={provider.models.map((item) => ({ value: item.id, label: item.price ? `${item.label} — ${item.price}` : item.label }))} />
          </Field>
        ) : null}
      </div>
      {durations.length > 0 || resolutions.length > 0 || aspects.length > 0 ? (
        <div className="vid-generate__row">
          {durations.length > 0 ? (
            <Field label="Length" group>
              <SegmentedControl label="Length in seconds" options={durations.map((value) => ({ value: String(value), label: `${value} s`, title: `${value} seconds` }))} value={duration} onChange={setDuration} />
            </Field>
          ) : null}
          {resolutions.length > 1 ? (
            <Field label="Resolution" group>
              <SegmentedControl label="Resolution" options={resolutions.map((value) => ({ value, label: value }))} value={resolution} onChange={setResolution} />
            </Field>
          ) : null}
          {aspects.length > 1 ? (
            <Field label="Shape" group>
              <SegmentedControl label="Shape" options={aspects.map((value) => ({ value, label: value }))} value={aspect} onChange={(value) => setAspect(value as VideoAspect)} />
            </Field>
          ) : null}
        </div>
      ) : null}
      {model?.audio ? <Toggle checked={audio} onChange={setAudio} label="With sound" description="The model adds sound to match the picture." /> : null}
      {model?.supportsFirstFrame ? <FirstFrame siteId={siteId} value={frame} onChange={setFrame} /> : null}

      <div className="vid-cost" aria-live="polite">
        <ProofMark kind="reg" />
        <span>{costLine(model, seconds, provider?.label ?? "the service")}</span>
      </div>
      <p className="g-hint vid-generate__limits">
        It takes a few minutes, and you can leave this screen while it’s made. Media keeps MP4 videos up to 25 MB; a finished video waits {CANDIDATE_HOURS} hours for you to save it.
      </p>

      {error ? (
        <ErrorState
          compact
          title={unconfigured ? "The video service needs attention" : "Couldn’t start the video"}
          message={`${errorShape(error).message} Nothing was charged.`}
          detail={errorShape(error).detail}
          actions={
            unconfigured ? (
              <Link className={buttonClass("secondary", "sm")} to="/plugins">
                Open plugins
              </Link>
            ) : undefined
          }
        />
      ) : null}

      <div className="vid-generate__go">
        {onCancel ? (
          <Button variant="quiet" onClick={onCancel}>
            Not now
          </Button>
        ) : null}
        <Button variant="primary" busy={busy} busyLabel="Starting" disabled={!ready} onClick={() => void start()}>
          Make the video
        </Button>
      </div>
    </div>
  );
}
