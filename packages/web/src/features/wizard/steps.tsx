import { useState, type RefObject } from "react";
import type { StarterInfo } from "@galley/core/types";
import { joinWords } from "@/lib/format";
import type { QueryResult } from "@/lib/query";
import { ErrorState, Field, IconButton, Input, ProofMark, Skeleton, Textarea, cx } from "@/ui";
import { DEFAULT_COLOR, MAX_PAGES, TONES, addPage, isHexColor, type BriefDraft } from "./brief";

interface StepProps {
  draft: BriefDraft;
  update: (patch: Partial<BriefDraft>) => void;
  heading: RefObject<HTMLHeadingElement | null>;
}

function Head({ heading, title, lede }: { heading: RefObject<HTMLHeadingElement | null>; title: string; lede: string }) {
  return (
    <header className="wizard-head">
      <h1 ref={heading} tabIndex={-1} className="wizard-title">
        {title}
      </h1>
      <p className="wizard-lede">{lede}</p>
    </header>
  );
}

export function NameStep({ draft, update, heading }: StepProps) {
  return (
    <>
      <Head heading={heading} title="What’s the site called?" lede="Usually the organisation’s name. You can change it later." />
      <Field label="Site name">
        <Input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Harbour Dental" autoComplete="organization" maxLength={100} data-autofocus />
      </Field>
    </>
  );
}

export function StarterStep({ draft, update, heading, starters }: StepProps & { starters: QueryResult<StarterInfo[]> }) {
  return (
    <>
      <Head heading={heading} title="Start from…" lede="A starter is a complete site with sample pages. The assistant rewrites it for you." />
      {starters.loading ? (
        <div aria-busy="true" className="wizard-starters">
          <Skeleton height={96} />
        </div>
      ) : !starters.data ? (
        <ErrorState compact title="Couldn’t list the starters" error={starters.error} onRetry={() => void starters.refetch()} />
      ) : (
        <fieldset className="app-fieldset wizard-starters">
          <legend className="g-sr">Starter</legend>
          {starters.data.map((starter) => (
            <label key={starter.id} className={cx("app-model wizard-starter", draft.starter === starter.id && "app-model--checked")}>
              <input type="radio" name="starter" className="app-model__radio" checked={draft.starter === starter.id} onChange={() => update({ starter: starter.id })} />
              <span className="app-model__text">
                <span className="app-model__name">{starter.name}</span>
                <span className="app-model__blurb">{starter.description}</span>
              </span>
              {starter.previewUrl ? <img className="wizard-starter__image" src={starter.previewUrl} alt="" /> : <span className="g-tag">{starter.framework}</span>}
            </label>
          ))}
        </fieldset>
      )}
      <label className={cx("app-model wizard-starter wizard-from-wp", draft.fromWordPress && "app-model--checked")}>
        <input type="checkbox" className="wizard-from-wp__check" checked={Boolean(draft.fromWordPress)} onChange={(event) => update({ fromWordPress: event.target.checked })} />
        <span className="app-model__text">
          <span className="app-model__name">Start from my WordPress site</span>
          <span className="app-model__blurb">The starter gives the design; your WordPress posts, pages and images are brought into it next, as changes you check before anything goes live.</span>
        </span>
      </label>
    </>
  );
}

export function AboutStep({ draft, update, heading }: StepProps) {
  return (
    <>
      <Head heading={heading} title={`What does ${draft.name.trim() || "the organisation"} do?`} lede="A few plain sentences are enough. The assistant writes every page from them." />
      <Field label="What it is and does" hint="Who you are, what you offer, where">
        <Textarea
          value={draft.description}
          onChange={(event) => update({ description: event.target.value })}
          rows={4}
          maxRows={10}
          placeholder="e.g. A family dental practice in the town centre, open six days a week, with early and late appointments."
          data-autofocus
        />
      </Field>
      <Field label="Who it’s for" hint="Optional">
        <Input value={draft.audience} onChange={(event) => update({ audience: event.target.value })} placeholder="e.g. Families nearby looking for a new dentist" />
      </Field>
    </>
  );
}

export function StyleStep({ draft, update, heading }: StepProps) {
  const [page, setPage] = useState("");
  const add = () => {
    update({ pages: addPage(draft.pages, page) });
    setPage("");
  };
  const color = isHexColor(draft.brandColor) ? draft.brandColor : DEFAULT_COLOR;
  return (
    <>
      <Head heading={heading} title="How should it sound and look?" lede="Pick what fits; everything here can be changed later." />
      <Field label="Tone of voice" group>
        <div className="g-quick-replies wizard-tones">
          {TONES.map((tone) => (
            <button key={tone} type="button" className="g-chip" aria-pressed={draft.tone === tone} onClick={() => update({ tone: draft.tone === tone ? "" : tone })}>
              {draft.tone === tone ? <ProofMark kind="caret" tone="insert" /> : null}
              {tone}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Pages" group hint={`Up to ${MAX_PAGES}. Remove any you don’t need.`}>
        <div className="wizard-pages">
          <ul className="wizard-pages__list" aria-label="Pages">
            {draft.pages.map((name) => (
              <li key={name} className="wizard-page">
                <span>{name}</span>
                <IconButton icon="close" label={`Remove ${name}`} size="sm" tooltip={false} onClick={() => update({ pages: draft.pages.filter((existing) => existing !== name) })} />
              </li>
            ))}
          </ul>
          <span className="wizard-pages__add">
            <Input
              size="sm"
              value={page}
              aria-label="Add a page"
              placeholder="Add a page"
              onChange={(event) => setPage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <IconButton icon="plus" label="Add page" onClick={add} disabled={!page.trim()} />
          </span>
        </div>
      </Field>
      <Field label="Brand colour" hint="A hex value, like #2F5D50">
        <span className="wizard-color">
          <input type="color" className="wizard-color__swatch" value={color} aria-label="Pick the brand colour" onChange={(event) => update({ brandColor: event.target.value.toUpperCase() })} />
          <Input mono value={draft.brandColor} onChange={(event) => update({ brandColor: event.target.value })} maxLength={7} />
        </span>
      </Field>
      <Field label="Anything else" hint="Optional: opening hours, things to avoid, a site you like">
        <Textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} rows={2} maxRows={6} />
      </Field>
    </>
  );
}

export function CreateStep({ draft, heading, keyReady }: Omit<StepProps, "update"> & { keyReady: boolean | null }) {
  return (
    <>
      <Head
        heading={heading}
        title={`Ready to create ${draft.name.trim()}.`}
        lede={keyReady === false ? "One thing first: the assistant isn’t connected yet." : "The starter is copied, then the assistant builds the site from your brief while the preview fills in."}
      />
      <dl className="wizard-summary">
        <dt>About</dt>
        <dd>{draft.description.trim()}</dd>
        {draft.audience.trim() ? (
          <>
            <dt>For</dt>
            <dd>{draft.audience.trim()}</dd>
          </>
        ) : null}
        {draft.tone ? (
          <>
            <dt>Tone</dt>
            <dd>{draft.tone}</dd>
          </>
        ) : null}
        <dt>Pages</dt>
        <dd>{joinWords(draft.pages)}</dd>
        {isHexColor(draft.brandColor) ? (
          <>
            <dt>Colour</dt>
            <dd className="wizard-summary__color">
              <span className="wizard-summary__swatch" style={{ background: draft.brandColor }} aria-hidden="true" />
              <span className="g-mono">{draft.brandColor}</span>
            </dd>
          </>
        ) : null}
      </dl>
      {keyReady === false ? (
        <div className="wizard-nokey" role="note">
          <ProofMark kind="reg" />
          <p>
            Without it, the site is created exactly as the starter is, and you edit it by hand — in the form, or by clicking text on the page. Add an API key in Settings first and
            the assistant will build it from this brief. The brief is kept while you’re away.
          </p>
        </div>
      ) : null}
    </>
  );
}
