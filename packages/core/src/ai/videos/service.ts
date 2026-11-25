/**
 * VideoService: the video counterpart of ImageService. Video generation is
 * asynchronous at every provider, so a request becomes a `Job` (kind
 * "video"): submit → poll with backoff → download each output into
 * `<home>/tmp/videos/` as a candidate (swept after two hours) → the person
 * saves the one they want into the site's media through `site.saveMedia`.
 *
 * Providers come from plugins (OpenRouter is the first); with none
 * registered the list is empty and generating says how to get one.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GalleyError } from "../../errors";
import { isProviderError } from "../../plugins/define";
import type { VideoProviderHandle } from "../../plugins/adapt";
import { createJobTracker } from "../../site/jobs";
import type { ChangeOrigin, EventBus, Job, MediaItem, SettingsService, SiteService, VideoCandidate, VideoGenRequest, VideoJobStatus, VideoProviderInfo, VideoSaveRequest, VideoService } from "../../types";
import { safeDetail } from "../errors";
import { keyConfigured, readKey } from "../images/providers";
import { filenameFromPrompt } from "../images/service";
import { mayBeShown } from "../../workspace/policy";

export const VIDEO_CANDIDATE_TTL_MS = 2 * 60 * 60 * 1000;
/**
 * Polling: providers say generation takes from half a minute to several
 * minutes and suggest polling every ~30 s. Start sooner (short clips finish
 * fast), back off to that, and give up after 20 minutes.
 */
export const VIDEO_POLL = { firstMs: 5_000, maxMs: 30_000, factor: 1.6, timeoutMs: 20 * 60_000 };
/** What the media library accepts (workspace/media.ts): MP4 only, up to 25 MB. */
const ACCEPTED: Record<string, string> = { "video/mp4": "mp4" };
const FRAME_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const CANDIDATE_ID = /^[a-f0-9-]{36}$/;

export interface VideoServiceOptions {
  home: string;
  settings: Pick<SettingsService, "readSecret" | "get" | "recordUsage">;
  events: EventBus;
  /** The video providers — the plugin registry's. Default: none. */
  providers?: () => readonly VideoProviderHandle[];
  fetch?: typeof fetch;
  poll?: Partial<typeof VIDEO_POLL>;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface GalleyVideoService extends VideoService {
  /** Remove expired candidates now. */
  sweep(): Promise<number>;
  /** Resolves when the job has finished (tests, and `galley` commands that wait). */
  settled(jobId: string): Promise<VideoJobStatus | null>;
  /** Stops every running generation. */
  dispose(): Promise<void>;
}

interface CandidateMeta {
  id: string;
  mime: string;
  size: number;
  prompt: string;
  provider: string;
  model: string;
  cost?: number;
  createdAt: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("stopped"));
    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("stopped"));
      },
      { once: true }
    );
  });
}

export function createVideoService(options: VideoServiceOptions): GalleyVideoService {
  const dir = join(options.home, "tmp", "videos");
  const jobs = createJobTracker(options.events);
  const handles = options.providers ?? (() => []);
  const poll = { ...VIDEO_POLL, ...options.poll };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const results = new Map<string, VideoCandidate[]>();
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

  async function configured(handle: VideoProviderHandle): Promise<boolean> {
    return keyConfigured(handle, async (secret) => (await options.settings.readSecret(secret)) !== null);
  }

  async function meta(id: string): Promise<CandidateMeta | null> {
    if (!CANDIDATE_ID.test(id)) return null;
    try {
      const value = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as CandidateMeta;

      return now() - value.createdAt > VIDEO_CANDIDATE_TTL_MS ? null : value;
    } catch {
      return null;
    }
  }

  async function sweep(): Promise<number> {
    let names: string[];

    try {
      names = await readdir(dir);
    } catch {
      return 0;
    }
    let removed = 0;

    for (const name of names) {
      try {
        if (now() - (await stat(join(dir, name))).mtimeMs > VIDEO_CANDIDATE_TTL_MS) {
          await rm(join(dir, name), { force: true });
          removed += 1;
        }
      } catch {
        // Already gone.
      }
    }
    return removed;
  }

  async function firstFrame(site: SiteService, path: string | undefined) {
    if (!path) return undefined;
    const mime = FRAME_MIME[path.split(".").pop()?.toLowerCase() ?? ""];

    if (!mime) throw new GalleyError("invalid", "The starting picture must be a PNG, JPG or WebP file.", path);
    // What is read here is sent to the video provider: never a secrets file or one of the version history's own, whatever its name ends in.
    if (!mayBeShown(path)) throw new GalleyError("forbidden", "That file can't be used as the starting picture.", path);
    try {
      return { data: new Uint8Array(await readFile(site.resolvePath(path))), mime };
    } catch (error) {
      if (error instanceof GalleyError) throw error;
      throw new GalleyError("not-found", "The starting picture couldn't be found in the site's media.", path);
    }
  }

  function plainFailure(label: string, error: unknown): { message: string; detail: string } {
    if (isProviderError(error)) return { message: error.plain, detail: safeDetail(error.detail ?? "") };
    if (error instanceof GalleyError) return { message: error.message, detail: safeDetail(error.detail ?? "") };
    return { message: `${label} couldn't make the video. Try again.`, detail: safeDetail(error) };
  }

  const service: GalleyVideoService = {
    async providers(): Promise<VideoProviderInfo[]> {
      return Promise.all(
        handles().map(async (handle) => ({
          id: handle.id,
          label: handle.label,
          configured: await configured(handle),
          models: (await handle.models()).map((model) => ({ ...model })),
          defaultModel: handle.defaultModel,
        }))
      );
    },

    async generate(site, request: VideoGenRequest): Promise<Job> {
      void sweep();
      const prompt = request.prompt?.trim() ?? "";

      if (prompt.length < 3) throw new GalleyError("invalid", "Describe the video you want in a few words.");
      if (prompt.length > 4000) throw new GalleyError("invalid", "That description is too long. Keep it under 4,000 characters.");
      if (request.aspect !== undefined && !ASPECTS.includes(request.aspect)) throw new GalleyError("invalid", "Choose one of the listed video shapes.", String(request.aspect));
      if (request.durationSeconds !== undefined && (!Number.isInteger(request.durationSeconds) || request.durationSeconds < 1 || request.durationSeconds > 60)) {
        throw new GalleyError("invalid", "Choose a length between 1 and 60 seconds.");
      }
      const all = handles();

      if (all.length === 0) throw new GalleyError("unconfigured", "No video service is set up here. Turn on a plugin that makes videos on the Plugins screen, then add its key.");
      // A request that names no service uses the one chosen in Settings while it is still there, else the first.
      const chosen = request.provider ? null : ((await options.settings.get().catch(() => null))?.videos ?? null);
      const preferred = chosen?.provider ? all.find((candidate) => candidate.id === chosen.provider) : undefined;
      const handle = request.provider ? all.find((candidate) => candidate.id === request.provider) : (preferred ?? all[0]);

      if (!handle) throw new GalleyError("invalid", "That video service isn't available.", request.provider);
      const key = await readKey(handle, (secret) => options.settings.readSecret(secret));

      if (handle.key && !key) throw new GalleyError("unconfigured", `Add ${handle.key.phrase} in Settings to make videos with ${handle.label}.`);
      const model = request.model ?? (preferred && chosen?.model ? chosen.model : handle.defaultModel);
      const frame = await firstFrame(site, request.firstFramePath);
      const brand = request.brandDirection?.trim().slice(0, 800);
      const job = jobs.start("video", `Making a video: ${prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt}`);
      const controller = new AbortController();

      job.update({ siteId: site.id, detail: `Sending it to ${handle.label}…` });
      const work = (async () => {
        try {
          const { jobId } = await handle.call(key, options.fetch, controller.signal, (provider, ctx) =>
            provider.start(
              {
                // The site's imagery direction, from its brand, as a brief after the request itself (as for images).
                prompt: brand ? `${prompt}\n\nBrand direction: ${brand}` : prompt,
                model,
                ...(request.aspect ? { aspect: request.aspect } : {}),
                ...(request.durationSeconds ? { durationSeconds: request.durationSeconds } : {}),
                ...(request.resolution ? { resolution: request.resolution } : {}),
                ...(request.audio !== undefined ? { audio: request.audio } : {}),
                ...(frame ? { firstFrame: frame } : {}),
              },
              ctx
            )
          );
          const started = now();
          let wait = poll.firstMs;
          let outputs = 0;
          let cost: number | undefined;

          for (;;) {
            await sleep(wait, controller.signal);
            const state = await handle.call(key, options.fetch, controller.signal, (provider, ctx) => provider.poll(jobId, ctx));

            if (state.state === "done") {
              outputs = Math.max(1, Math.min(4, state.outputs));
              cost = state.cost;
              break;
            }
            if (state.state === "failed") {
              throw Object.assign(new Error(state.message), { providerError: true, name: "ProviderError", kind: state.kind, plain: state.message, detail: state.detail ?? "" });
            }
            job.update({ detail: state.detail ?? `${handle.label} is making it…`, ...(state.progress !== undefined ? { progress: Math.max(0, Math.min(1, state.progress)) } : {}) });
            if (now() - started > poll.timeoutMs) {
              throw new GalleyError("ai", `${handle.label} is taking longer than ${Math.round(poll.timeoutMs / 60_000)} minutes, so the app stopped waiting. It may still finish there; try again later.`);
            }
            wait = Math.min(poll.maxMs, Math.round(wait * poll.factor));
          }
          job.update({ detail: "Downloading it…", progress: 1 });
          await mkdir(dir, { recursive: true });
          const candidates: VideoCandidate[] = [];

          for (let index = 0; index < outputs; index += 1) {
            const file = await handle.call(key, options.fetch, controller.signal, (provider, ctx) => provider.download(jobId, index, ctx));
            const mime = file.mime.split(";")[0]!.trim().toLowerCase();

            if (!ACCEPTED[mime]) {
              throw new GalleyError("ai", `${handle.label} sent a kind of video the media library can't keep (${mime || "unknown"}). Only MP4 videos can be added.`);
            }
            const id = randomUUID();
            const record: CandidateMeta = {
              id,
              mime,
              size: file.data.byteLength,
              prompt,
              provider: handle.id,
              model,
              // The provider reports the job's cost once; it is kept with the first output.
              ...(index === 0 && cost !== undefined ? { cost } : {}),
              createdAt: now(),
            };

            await writeFile(join(dir, `${id}.${ACCEPTED[mime]}`), file.data);
            await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
            candidates.push({ id, mime, size: record.size, previewUrl: `/api/videos/candidates/${id}`, prompt, provider: handle.id, model, ...(record.cost !== undefined ? { cost: record.cost } : {}) });
          }
          results.set(job.id, candidates);
          await options.settings.recordUsage({
            siteId: site.id,
            at: now(),
            model: `${handle.id}:${model}`,
            requests: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: cost ?? null,
            videos: candidates.length,
          });
          job.finish("done", { detail: candidates.length === 1 ? "The video is ready." : `${candidates.length} videos are ready.` });
        } catch (error) {
          if (controller.signal.aborted) {
            job.finish("error", { detail: "Stopped." });
            return;
          }
          const failure = plainFailure(handle.label, error);

          job.finish("error", { detail: failure.message });
        } finally {
          running.delete(job.id);
        }
      })();

      running.set(job.id, { controller, done: work });
      return job.snapshot();
    },

    async status(jobId) {
      const job = jobs.get(jobId);

      return job ? { job, candidates: results.get(jobId) ?? [] } : null;
    },

    async settled(jobId) {
      await running.get(jobId)?.done;
      return service.status(jobId);
    },

    async read(candidateId) {
      const value = await meta(candidateId);

      if (!value) return null;
      try {
        return { data: new Uint8Array(await readFile(join(dir, `${candidateId}.${ACCEPTED[value.mime] ?? "bin"}`))), mime: value.mime };
      } catch {
        return null;
      }
    },

    async save(site, request: VideoSaveRequest, origin: ChangeOrigin = "user"): Promise<MediaItem> {
      const value = await meta(request.candidateId);
      const bytes = value ? await service.read(request.candidateId) : null;

      if (!value || !bytes) throw new GalleyError("not-found", "That generated video has expired. Make it again.", request.candidateId);
      const base = request.filename?.trim() ? filenameFromPrompt(request.filename.replace(/\.[a-z0-9]{2,5}$/i, "")) : filenameFromPrompt(value.prompt);
      const ext = ACCEPTED[value.mime] ?? "mp4";
      const item = await site.saveMedia({ filename: `${base || "video"}.${ext}`, ...(request.directory ? { directory: request.directory } : {}), data: bytes.data }, { origin });

      await service.discard(request.candidateId);
      return item;
    },

    async discard(candidateId) {
      const value = await meta(candidateId);

      if (!CANDIDATE_ID.test(candidateId)) return;
      await rm(join(dir, `${candidateId}.json`), { force: true });
      if (value) await rm(join(dir, `${candidateId}.${ACCEPTED[value.mime] ?? "bin"}`), { force: true });
    },

    sweep,

    async dispose() {
      for (const { controller } of running.values()) controller.abort();
      await Promise.all([...running.values()].map((run) => run.done.catch(() => undefined)));
      jobs.dispose();
    },
  };

  return service;
}
