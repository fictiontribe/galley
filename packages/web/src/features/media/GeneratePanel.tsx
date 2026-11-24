import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ImageAspect, ImageCandidate, MediaItem } from "@galley/core/types";
import { api, candidateUrl, errorShape, isApiFailure } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Button, ErrorState, Field, Input, ProofMark, SegmentedControl, Select, Skeleton, Textarea, buttonClass, cx } from "@/ui";
import { fileNameFromPrompt } from "@/features/media/fileName";
import { imageModelFacts, modelOptionLabel } from "./video/cost";
import { BrandDirectionNote } from "@/features/brand/BrandDirectionNote";
import { useImageryDirection } from "@/features/brand/useBrand";
import { SettingsLink } from "@/features/accounts/SettingsLink";
import { useMay } from "@/lib/may";

/** The built-in generator: labelled placeholder artwork, no key needed. */
const PLACEHOLDER = "mock";
const ASPECTS: ImageAspect[] = ["16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
const COUNTS = ["1", "2", "3", "4"] as const;

export interface GeneratePanelProps {
  siteId: string;
  /** A saved image, ready to use. */
  onSaved: (item: MediaItem) => void;
  /** Start from this description (e.g. the field's label). */
  initialPrompt?: string;
}

function discard(candidates: readonly ImageCandidate[], keep?: string): void {
  for (const candidate of candidates) {
    if (candidate.id !== keep) void api("DELETE /api/images/candidates/:candidateId", { params: { candidateId: candidate.id } }).catch(() => undefined);
  }
}

/** Describe an image → a few candidates → pick one, name it, save it into media. The rest are thrown away. */
export function GeneratePanel({ siteId, onSaved, initialPrompt = "" }: GeneratePanelProps) {
  const providers = useQuery(["images", "providers"], () => api("GET /api/images/providers"));
  const settings = useQuery(keys.settings(), () => api("GET /api/settings"));
  const mayChooseService = useMay()("PATCH /api/settings");
  const configured = useMemo(() => (providers.data?.providers ?? []).filter((provider) => provider.configured), [providers.data]);
  // The site's imagery direction rides along with every request, as it does when the assistant makes an image.
  const brandDirection = useImageryDirection(siteId);

  const [prompt, setPrompt] = useState(initialPrompt);
  const [style, setStyle] = useState("");
  const [aspect, setAspect] = useState<ImageAspect>("16:9");
  const [howMany, setHowMany] = useState<(typeof COUNTS)[number]>("2");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // Default to what Settings says is used: the chosen service, or (none chosen) the built-in placeholders.
  useEffect(() => {
    if (providerId || configured.length === 0 || !settings.data) return;
    const preferred = configured.find((provider) => provider.id === settings.data?.images.provider) ?? configured.find((provider) => provider.id === PLACEHOLDER) ?? configured[0];
    if (preferred) {
      setProviderId(preferred.id);
      setModelId(settings.data?.images.provider === preferred.id && settings.data.images.model ? settings.data.images.model : preferred.defaultModel);
    }
  }, [configured, settings.data, providerId]);

  // Leaving with unsaved candidates throws them away.
  const unsaved = useRef(candidates);
  unsaved.current = candidates;
  useEffect(() => () => discard(unsaved.current), []);

  const provider = configured.find((item) => item.id === providerId);
  const allProviders = providers.data?.providers ?? [];

  const generate = async () => {
    setBusy(true);
    setError(null);
    discard(candidates);
    setCandidates([]);
    setChosen(null);
    try {
      const result = await api("POST /api/sites/:siteId/images/generate", {
        params: { siteId },
        body: {
          prompt: prompt.trim(),
          aspect,
          count: Number(howMany),
          ...(style.trim() ? { style: style.trim() } : {}),
          ...(providerId ? { provider: providerId } : {}),
          ...(modelId ? { model: modelId } : {}),
          ...(brandDirection ? { brandDirection } : {}),
        },
      });
      setCandidates(result.candidates);
      setChosen(result.candidates[0]?.id ?? null);
      setName(fileNameFromPrompt(prompt));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!chosen) return;
    setSaving(true);
    setError(null);
    try {
      const item = await api("POST /api/sites/:siteId/images/save", { params: { siteId }, body: { candidateId: chosen, ...(name.trim() ? { filename: name.trim() } : {}) } });
      discard(candidates, chosen);
      setCandidates([]);
      setChosen(null);
      invalidate(keys.media(siteId));
      onSaved(item);
    } catch (caught) {
      setError(caught);
    } finally {
      setSaving(false);
    }
  };

  if (providers.loading || (settings.loading && !settings.data)) {
    return (
      <div className="app-generate" aria-busy="true">
        <Skeleton height={76} />
        <Skeleton width={240} height={28} />
      </div>
    );
  }
  if (providers.status === "error" && !providers.data) return <ErrorState compact title="Couldn’t load the image providers" error={providers.error} onRetry={() => void providers.refetch()} />;

  const unconfigured = isApiFailure(error) && error.shape.code === "unconfigured";
  return (
    <div className="app-generate">
      {providerId === PLACEHOLDER ? (
        <p className="g-margin-note app-generate__note">
          <ProofMark kind="stet" />
          <span>
            {mayChooseService ? (
              <>
                These will be placeholders: simple artwork labelled with your description. Choosing an image service in{" "}
                <Link className="g-link" to="/settings#images">
                  Settings
                </Link>{" "}
                makes real images. You can still try everything here.
              </>
            ) : (
              "These will be placeholders: simple artwork labelled with your description. An owner of this editor can choose an image service for real images. You can still try everything here."
            )}
          </span>
        </p>
      ) : null}
      <Field label="Describe the image" hint="What’s in it, the mood, the setting. A sentence or two is plenty.">
        <Textarea value={prompt} rows={3} maxRows={8} placeholder="A sunlit kitchen extension with a long rooflight, timber worktop, plants…" onChange={(event) => setPrompt(event.target.value)} />
      </Field>
      <BrandDirectionNote direction={brandDirection} />
      <div className="app-form-row">
        <Field label="Style" hint="Optional">
          <Input value={style} placeholder="Flat editorial illustration" onChange={(event) => setStyle(event.target.value)} />
        </Field>
        <Field label="Provider">
          <Select
            value={providerId}
            onChange={(next) => {
              setProviderId(next);
              setModelId(allProviders.find((item) => item.id === next)?.defaultModel ?? "");
            }}
            options={allProviders.map((item) => ({
              value: item.id,
              label: item.id === PLACEHOLDER ? "Built-in placeholders" : item.configured ? item.label : `${item.label} — connect in Settings`,
              disabled: !item.configured,
            }))}
          />
        </Field>
        {provider && provider.models.length > 1 ? (
          <Field label="Model" hint={imageModelFacts(provider, provider.models.find((model) => model.id === modelId)) || undefined}>
            <Select value={modelId} onChange={setModelId} options={provider.models.map((model) => ({ value: model.id, label: modelOptionLabel(model) }))} />
          </Field>
        ) : null}
      </div>
      <div className="app-generate__row">
        <Field label="Shape" group>
          <SegmentedControl label="Shape" options={ASPECTS.map((value) => ({ value, label: value }))} value={aspect} onChange={setAspect} />
        </Field>
        <Field label="How many" group>
          <SegmentedControl label="How many" options={COUNTS.map((value) => ({ value, label: value }))} value={howMany} onChange={setHowMany} />
        </Field>
        <Button variant={candidates.length ? "secondary" : "primary"} icon="refresh" busy={busy} busyLabel="Making images" disabled={prompt.trim().length < 3 || !providerId} onClick={() => void generate()} className="app-generate__go">
          {candidates.length ? "Make new ones" : "Make images"}
        </Button>
      </div>

      {error ? (
        <ErrorState
          compact
          title={unconfigured ? "The image provider needs attention" : "Couldn’t make that image"}
          message={`${errorShape(error).message} Nothing was added to media.`}
          detail={errorShape(error).detail}
          actions={
            unconfigured ? (
              <SettingsLink route="PATCH /api/settings" className={buttonClass("secondary", "sm")} to="/settings#images">
                Open settings
              </SettingsLink>
            ) : undefined
          }
        />
      ) : null}

      {busy ? (
        <div className="app-candidates" aria-busy="true">
          {Array.from({ length: Number(howMany) }, (_, index) => (
            <Skeleton key={index} className="app-candidate__skeleton" />
          ))}
        </div>
      ) : null}

      {candidates.length > 0 && !busy ? (
        <>
          <div className="app-candidates" role="radiogroup" aria-label="Choose one">
            {candidates.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={chosen === candidate.id}
                aria-label={`Image ${index + 1}${candidate.width ? `, ${candidate.width} × ${candidate.height}` : ""}`}
                className={cx("app-candidate", chosen === candidate.id && "app-candidate--chosen")}
                onClick={() => setChosen(candidate.id)}
              >
                <img src={candidateUrl(candidate.id)} alt="" />
              </button>
            ))}
          </div>
          <div className="app-generate__save">
            <Field label="Name it" hint="Lowercase words with hyphens; the file type is added for you.">
              <Input value={name} mono onChange={(event) => setName(event.target.value)} placeholder="kitchen-extension" />
            </Field>
            <Button
              variant="quiet"
              onClick={() => {
                discard(candidates);
                setCandidates([]);
                setChosen(null);
              }}
            >
              Discard all
            </Button>
            <Button variant="primary" busy={saving} busyLabel="Saving" disabled={!chosen} onClick={() => void save()}>
              Save to media
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
