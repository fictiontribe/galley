/**
 * The brand sheet: set like a designer's specimen, not a settings form.
 * Every value is editable in place and says where it came from and how sure
 * it is. Colours are shown big with their role and value; contrast pairs in
 * their own colours with a plain verdict; the type scale in the real fonts
 * with the site's real words; logos on light and dark; sections with their
 * pictures; the voice with its quotes and before/after.
 */
import { useMemo, useState } from "react";
import type { EntrySummary } from "@galley/core/types";
import type { BrandColor, BrandFont, SiteBrandFile, SiteBrandState, TypeStyle } from "@galley/core/sitebrand/types";
import { api, rawFileUrl } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { Badge, Icon, Tag, Tooltip } from "@/ui";
import { useFontViews } from "./fonts";
import { COLOR_ROLE_ORDER, CONFIDENCE_HINT, CONFIDENCE_LABEL, contrastWords, inkFor, pairWords, quotePlace, ROLE_LABEL, whereFrom } from "./words";

interface SheetProps {
  siteId: string;
  state: SiteBrandState;
  brand: SiteBrandFile;
  onChange: (brand: SiteBrandFile) => void;
  editable: boolean;
}

function Band({ number, title, children, aside }: { number: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  const id = `brand-band-${number}`;

  return (
    <section className="brand-band" aria-labelledby={id}>
      <header className="brand-band__label">
        <span className="brand-band__number" aria-hidden="true">
          {number}
        </span>
        <h2 id={id} className="brand-band__title">
          {title}
        </h2>
        {aside ? <div className="brand-band__aside">{aside}</div> : null}
      </header>
      <div className="brand-band__body">{children}</div>
    </section>
  );
}

function Source({ confidence, evidence }: { confidence: BrandColor["confidence"]; evidence: BrandColor["evidence"] }) {
  const where = whereFrom(evidence);

  return (
    <p className="brand-source-line">
      <Tooltip content={CONFIDENCE_HINT[confidence]}>
        <span className={`brand-confidence brand-confidence--${confidence}`} tabIndex={0}>
          {CONFIDENCE_LABEL[confidence]}
        </span>
      </Tooltip>
      {where ? <span className="brand-source-line__where">{where}</span> : null}
    </p>
  );
}

/** Text that edits in place: looks like the sheet until focused. */
function Inline({ value, onCommit, label, className, disabled, mono }: { value: string; onCommit: (value: string) => void; label: string; className?: string; disabled?: boolean; mono?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      className={`brand-inline${mono ? " brand-inline--mono" : ""}${className ? ` ${className}` : ""}`}
      value={draft ?? value}
      aria-label={label}
      disabled={disabled}
      spellCheck={!mono}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft.trim() && draft !== value) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Swatch({ color, onChange, editable }: { color: BrandColor; onChange: (color: BrandColor) => void; editable: boolean }) {
  const ink = inkFor(color.value);
  const [invalid, setInvalid] = useState(false);

  return (
    <li className="brand-swatch">
      <div className="brand-swatch__chip" style={{ background: color.value, color: ink }}>
        <span className="brand-swatch__role">{ROLE_LABEL[color.role]}</span>
        {editable ? (
          <label className="brand-swatch__pick" style={{ color: ink }}>
            <span className="g-sr">Change {color.name}</span>
            <input type="color" value={color.value.slice(0, 7).toLowerCase()} onChange={(event) => onChange({ ...color, value: event.target.value.toUpperCase(), confidence: "inferred", evidence: [{ kind: "source", sourceName: "Changed by hand" }] })} />
            <Icon name="registration" size={14} />
          </label>
        ) : null}
        <Inline
          mono
          className={`brand-swatch__hex${invalid ? " brand-swatch__value--invalid" : ""}`}
          value={color.value}
          label={`Value of ${color.name}`}
          disabled={!editable}
          onCommit={(value) => {
            const hex = /^#?[0-9a-f]{6}$/i.test(value) ? `#${value.replace("#", "").toUpperCase()}` : null;

            setInvalid(!hex);
            if (hex) onChange({ ...color, value: hex, confidence: "inferred", evidence: [{ kind: "source", sourceName: "Changed by hand" }] });
          }}
        />
      </div>
      <div className="brand-swatch__text">
        <Inline className="brand-swatch__name" value={color.name} label={`Name of the ${ROLE_LABEL[color.role].toLowerCase()} colour`} onCommit={(name) => onChange({ ...color, name })} disabled={!editable} />
        <div className="brand-swatch__codes">
          {color.token ? <code className="brand-swatch__token">{color.token}</code> : null}
        </div>
        {color.usage ? <p className="brand-swatch__usage">{color.usage}</p> : null}
        <Source confidence={color.confidence} evidence={color.evidence} />
      </div>
    </li>
  );
}

const CORE_TEXT = new Set(["text", "text-muted", "accent", "accent-text", "inverse-text"]);

function Contrast({ brand }: { brand: SiteBrandFile }) {
  const [all, setAll] = useState(false);
  const byId = new Map(brand.colors.map((c) => [c.id, c]));
  const known = brand.contrast.filter((p) => byId.has(p.text) && byId.has(p.background));
  // The pairs people set text in first, and every failing one; the rest on request.
  const core = known.filter((p) => p.result === "fail" || (CORE_TEXT.has(byId.get(p.text)!.role) && byId.get(p.background)!.role !== "other"));
  const pairs = all ? known : core.slice(0, 10);

  if (!pairs.length) return null;
  return (
    <div className="brand-contrast">
      <h3 className="brand-subhead">How text reads</h3>
      <ul className="brand-contrast__list">
        {pairs.map((pair) => {
          const text = byId.get(pair.text)!;
          const ground = byId.get(pair.background)!;
          const tone = pair.result === "fail" ? "danger" : pair.result === "large" ? "warning" : "success";

          return (
            <li key={`${pair.text}-${pair.background}`} className="brand-contrast__row">
              <span className="brand-contrast__sample" style={{ background: ground.value, color: text.value }} aria-hidden="true">
                Aa
              </span>
              <span className="brand-contrast__words">
                {pairWords(text.role, ground.role)}
                {pair.measuredOn?.length ? <span className="brand-contrast__seen">seen on {pair.measuredOn.slice(0, 3).join(", ")}</span> : null}
              </span>
              <span className="brand-contrast__ratio">{pair.ratio.toFixed(1)}:1</span>
              <Badge tone={tone}>{contrastWords(pair.result)}</Badge>
            </li>
          );
        })}
      </ul>
      {known.length > pairs.length || all ? (
        <button type="button" className="app-link-button brand-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${known.length} pairs the pages use`}
        </button>
      ) : null}
    </div>
  );
}

const ROLE_SAMPLE: Record<string, string> = { h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", body: "Body", small: "Small", button: "Button", link: "Link", lead: "Lead", label: "Label", h5: "Heading 5", h6: "Heading 6" };

function TypeScale({ brand, state, copy, onChange, editable }: { brand: SiteBrandFile; state: SiteBrandState; copy: { heading: string; body: string; button: string }; onChange: (brand: SiteBrandFile) => void; editable: boolean }) {
  const fonts = brand.typography.fonts;
  const views = useFontViews(
    fonts.map((f) => f.family),
    state.webFonts
  );
  const fontFor = (style: TypeStyle) => fonts.find((f) => f.id === style.font);
  // Without measured sizes (material only), show each font at a few plain sizes.
  const scale: Array<TypeStyle & { sample: string }> = brand.typography.scale.length
    ? brand.typography.scale.map((style) => ({ ...style, sample: style.role.startsWith("h") ? copy.heading : style.role === "button" || style.role === "link" ? copy.button : copy.body }))
    : fonts.flatMap((font): Array<TypeStyle & { sample: string }> =>
        font.role === "display"
          ? [{ id: `${font.id}-d`, role: "h1", font: font.id, size: "48px", px: 48, weight: 500, lineHeight: "1.05", confidence: "inferred", evidence: [], sample: copy.heading }]
          : font.role === "mono"
            ? [{ id: `${font.id}-m`, role: "label", font: font.id, size: "13px", px: 13, weight: 400, lineHeight: "1.4", confidence: "inferred", evidence: [], sample: "galley/brand/brand.json · 0123456789" }]
            : [{ id: `${font.id}-b`, role: "body", font: font.id, size: "17px", px: 17, weight: 400, lineHeight: "1.55", confidence: "inferred", evidence: [], sample: copy.body }]
      );
  const changeFont = (font: BrandFont, family: string) => onChange({ ...brand, typography: { ...brand.typography, fonts: fonts.map((f) => (f.id === font.id ? { ...f, family, confidence: "inferred" } : f)) } });

  return (
    <>
      <ul className="brand-fonts">
        {fonts.map((font) => {
          const view = views[font.family];

          return (
            <li key={font.id} className="brand-font">
              <span className="brand-font__aa" style={{ fontFamily: view?.css }} aria-hidden="true">
                Aa
              </span>
              <div className="brand-font__text">
                <span className="g-eyebrow">{font.role === "display" ? "Headings" : font.role === "body" ? "Body" : font.role === "mono" ? "Code and labels" : "Other"}</span>
                <Inline className="brand-font__family" value={font.family} label={`${font.role} font`} onCommit={(family) => changeFont(font, family)} disabled={!editable} />
                <p className="brand-font__state">
                  {view === undefined ? "Loading the font…" : view.real ? "Shown in the real font." : "This computer doesn't have it, so it's named here and shown in a stand-in."}
                  {font.source.kind === "package" && font.source.ref ? (
                    <>
                      {" "}
                      <code>{font.source.ref}</code>
                    </>
                  ) : font.source.kind === "embedded" ? ` Found inside ${font.source.ref ?? "a PDF"}.` : ""}
                </p>
                <Source confidence={font.confidence} evidence={font.evidence} />
              </div>
            </li>
          );
        })}
      </ul>
      {scale.length ? (
        <ol className="brand-scale">
          {scale.map((style) => {
            const font = fontFor(style);
            const view = font ? views[font.family] : undefined;
            const px = style.px ?? (parseFloat(style.size) || 16);

            return (
              <li key={style.id} className="brand-scale__row">
                <div className="brand-scale__meta">
                  <span className="g-eyebrow">{ROLE_SAMPLE[style.role] ?? style.role}</span>
                  <span className="brand-scale__spec">
                    {font?.family ?? "—"} · {Math.round(px)}/{Math.round(px * (parseFloat(style.lineHeight) || 1.2))} · {style.weight}
                  </span>
                </div>
                <p className="brand-scale__sample" style={{ fontFamily: view?.css, fontSize: `min(${px}px, 9vw)`, fontWeight: style.weight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing }}>
                  {style.sample}
                </p>
              </li>
            );
          })}
        </ol>
      ) : null}
      {!brand.typography.scale.length && fonts.length ? <p className="brand-note">The material doesn’t set sizes, so each font is shown at a typical size. Read the site once it has pages to measure the real ones.</p> : null}
    </>
  );
}

function logoSrc(siteId: string, file: string): string | null {
  const source = /^source:(.+)$/.exec(file)?.[1];

  if (source) return `/api/sites/${encodeURIComponent(siteId)}/brand/sources/${source}/file`;
  if (/^(https?:|inline )/.test(file)) return null;
  if (file.startsWith("/")) return rawFileUrl(siteId, `public${file}`);
  return rawFileUrl(siteId, file);
}

function Logos({ siteId, brand }: { siteId: string; brand: SiteBrandFile }) {
  const light = brand.colors.find((c) => c.role === "background")?.value ?? "#FFFFFF";
  const dark = brand.colors.find((c) => c.role === "inverse-background")?.value ?? brand.colors.find((c) => c.role === "text")?.value ?? "#141210";

  return (
    <ul className="brand-logos">
      {brand.logos.map((logo) => {
        const src = logoSrc(siteId, logo.file);
        const grounds = logo.background === "dark" ? [dark] : logo.background === "light" ? [light] : [light, dark];

        return (
          <li key={logo.id} className={`brand-logo${logo.doNotUse ? " brand-logo--retired" : ""}`}>
            <div className="brand-logo__grounds">
              {grounds.map((ground) => (
                <div key={ground} className="brand-logo__ground" style={{ background: ground }}>
                  {src ? <img src={src} alt={`${logo.variant} logo`} /> : <span className="brand-logo__none" style={{ color: inkFor(ground) }}>Drawn straight into the page’s header, so there’s no file to show. Add the logo file as material to keep it with the brand.</span>}
                </div>
              ))}
            </div>
            <div className="brand-logo__text">
              <span className="brand-logo__variant">{logo.variant}</span>
              {logo.doNotUse ? <Badge tone="danger">Don’t use</Badge> : null}
              {logo.clearSpace ? <span>Clear space: {logo.clearSpace}</span> : null}
              {logo.minSize ? <span>Smallest: {logo.minSize}</span> : null}
              {logo.notes ? <span className="brand-logo__notes">{logo.notes}</span> : null}
              {logo.colors.length ? (
                <span className="brand-logo__colors" aria-label={`Colours: ${logo.colors.join(", ")}`}>
                  {logo.colors.map((c) => (
                    <i key={c} style={{ background: c }} title={c} />
                  ))}
                </span>
              ) : null}
              <Source confidence={logo.confidence} evidence={logo.evidence} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Components({ siteId, brand }: { siteId: string; brand: SiteBrandFile }) {
  return (
    <ul className="brand-components">
      {brand.components.map((component) => (
        <li key={component.type} className="brand-component">
          <div className="brand-component__thumb">{component.thumbnail ? <img src={rawFileUrl(siteId, component.thumbnail)} alt="" loading="lazy" /> : <span className="g-eyebrow">{component.type}</span>}</div>
          <div className="brand-component__text">
            <span className="brand-component__label">{component.label}</span>
            {component.whenToUse ? <span className="brand-component__when">{component.whenToUse}</span> : null}
            <span className="brand-component__used">{component.usedOn.length ? `On ${component.usedOn.length === 1 ? "1 page" : `${component.usedOn.length} pages`}` : component.count ? `${component.count} in the content` : "Not used yet"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The site's entries at the addresses voice quotes come from, to name the pages. */
function useQuotedPages(siteId: string, brand: SiteBrandFile): ReadonlyMap<string, EntrySummary> {
  const addresses = useMemo(() => [...new Set((brand.voice?.rules ?? []).map((rule) => rule.quote?.where.trim() ?? "").filter((where) => where.startsWith("/")))].sort(), [brand.voice]);
  const found = useQuery(
    ["site", siteId, "brand", "quoted-pages", addresses.join(" ")],
    async () => new Map((await Promise.all(addresses.map(async (url) => [url, (await api("GET /api/sites/:siteId/route", { params: { siteId }, query: { url } })).entry] as const))).filter((pair): pair is readonly [string, EntrySummary] => pair[1] !== null)),
    { enabled: addresses.length > 0 },
  );
  return found.data ?? NO_PAGES;
}

const NO_PAGES: ReadonlyMap<string, EntrySummary> = new Map();

function Voice({ siteId, brand, onChange, editable }: { siteId: string; brand: SiteBrandFile; onChange: (brand: SiteBrandFile) => void; editable: boolean }) {
  const voice = brand.voice;
  const pages = useQuotedPages(siteId, brand);

  if (!voice) return <p className="brand-note">No voice guide yet. It is written by the assistant from the site’s own words or your guidelines.</p>;
  return (
    <div className="brand-voice">
      <textarea
        className="brand-voice__summary"
        defaultValue={voice.summary}
        aria-label="The voice in a few sentences"
        disabled={!editable}
        rows={3}
        onBlur={(event) => {
          if (event.target.value.trim() && event.target.value !== voice.summary) onChange({ ...brand, voice: { ...voice, summary: event.target.value.trim() } });
        }}
      />
      {voice.tone.length ? (
        <p className="brand-voice__tone">
          {voice.tone.map((word) => (
            <Tag key={word}>{word}</Tag>
          ))}
        </p>
      ) : null}
      <ol className="brand-rules">
        {voice.rules.map((rule) => (
          <li key={rule.rule} className="brand-rule">
            <p className="brand-rule__rule">{rule.rule}</p>
            {rule.quote ? (
              <blockquote className="brand-rule__quote">
                <p>“{rule.quote.text}”</p>
                <cite>{quotePlace(rule.quote.where, pages.get(rule.quote.where.trim()))}</cite>
              </blockquote>
            ) : null}
            {rule.before && rule.after ? (
              <p className="brand-rule__edit">
                <del className="g-del">{rule.before}</del> <ins className="g-ins">{rule.after}</ins>
              </p>
            ) : rule.after ? (
              <p className="brand-rule__edit">
                <ins className="g-ins">{rule.after}</ins>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {voice.vocabulary.length ? (
        <table className="brand-words">
          <caption className="brand-subhead">Words</caption>
          <thead>
            <tr>
              <th scope="col">Say</th>
              <th scope="col">Not</th>
            </tr>
          </thead>
          <tbody>
            {voice.vocabulary.map((word) => (
              <tr key={word.say}>
                <td>{word.say}</td>
                <td>
                  {word.insteadOf.join(", ")}
                  {word.why ? <span className="brand-words__why"> — {word.why}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <dl className="brand-format">
        <dt>Headlines</dt>
        <dd>{voice.formatting.headlineCase === "sentence" ? "Sentence case" : voice.formatting.headlineCase === "title" ? "Title Case" : voice.formatting.headlineCase === "upper" ? "Upper case" : "Mixed"}</dd>
        {voice.formatting.punctuation ? (
          <>
            <dt>Punctuation</dt>
            <dd>{voice.formatting.punctuation}</dd>
          </>
        ) : null}
        {voice.formatting.numbers ? (
          <>
            <dt>Numbers</dt>
            <dd>{voice.formatting.numbers}</dd>
          </>
        ) : null}
        {voice.formatting.cta ? (
          <>
            <dt>Buttons</dt>
            <dd>{voice.formatting.cta}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** A small section drawn with the brand's own values: does it hang together? */
function Sample({ brand, copy, views }: { brand: SiteBrandFile; copy: { heading: string; body: string; button: string }; views: Record<string, { css: string }> }) {
  const color = (role: string, fallback: string) => brand.colors.find((c) => c.role === role)?.value ?? fallback;
  const display = brand.typography.fonts.find((f) => f.role === "display");
  const body = brand.typography.fonts.find((f) => f.role === "body") ?? display;
  const radius = brand.radius.find((r) => /button|pill|full/.test(r.name))?.value ?? "999px";
  const ground = color("background", "#FFFFFF");
  const accent = color("accent", color("text", "#141210"));

  return (
    <div className="brand-sample" style={{ background: ground, color: color("text", inkFor(ground)), fontFamily: body ? views[body.family]?.css : undefined }} aria-label="A sample section in the brand">
      <p className="brand-sample__eyebrow" style={{ color: accent }}>
        Sample section
      </p>
      <p className="brand-sample__heading" style={{ fontFamily: display ? views[display.family]?.css : undefined }}>
        {copy.heading}
      </p>
      <p className="brand-sample__body" style={{ color: color("text-muted", color("text", inkFor(ground))) }}>
        {copy.body}
      </p>
      <span className="brand-sample__actions">
        <span className="brand-sample__button" style={{ background: accent, color: color("accent-text", inkFor(accent)), borderRadius: radius }}>
          {copy.button}
        </span>
        <span className="brand-sample__link" style={{ color: accent }}>
          Learn more
        </span>
      </span>
    </div>
  );
}

export function Specimen({ siteId, state, brand, onChange, editable }: SheetProps) {
  const copy = useMemo(() => {
    const quotes = brand.voice?.rules.map((r) => r.quote?.text).filter((t): t is string => Boolean(t)) ?? [];

    return {
      heading: quotes.find((q) => q.split(" ").length <= 10) ?? `${brand.name}, set in its own type`,
      body: quotes.find((q) => q.split(" ").length > 10) ?? brand.voice?.summary ?? "Body text runs here at the size people read the site in, on its own ground.",
      button: "Get started",
    };
  }, [brand]);
  const views = useFontViews(
    brand.typography.fonts.map((f) => f.family),
    state.webFonts
  );
  const colors = [...brand.colors].sort((a, b) => COLOR_ROLE_ORDER.indexOf(a.role) - COLOR_ROLE_ORDER.indexOf(b.role));
  const setColor = (next: BrandColor) => onChange({ ...brand, colors: brand.colors.map((c) => (c.id === next.id ? next : c)) });
  let n = 0;
  const number = () => String(++n).padStart(2, "0");

  return (
    <div className="brand-sheet">
      <Band number={number()} title="Colour">
        {colors.length ? (
          <ul className="brand-swatches">
            {colors.map((color) => (
              <Swatch key={color.id} color={color} onChange={setColor} editable={editable} />
            ))}
          </ul>
        ) : (
          <p className="brand-note">No colours were found.</p>
        )}
        <Contrast brand={brand} />
      </Band>
      <Band number={number()} title="Type">
        <TypeScale brand={brand} state={state} copy={copy} onChange={onChange} editable={editable} />
      </Band>
      {brand.colors.length ? (
        <Band number={number()} title="In use">
          <Sample brand={brand} copy={copy} views={views} />
        </Band>
      ) : null}
      {brand.logos.length ? (
        <Band number={number()} title="Logo">
          <Logos siteId={siteId} brand={brand} />
        </Band>
      ) : null}
      {brand.spacing.length || brand.radius.length || brand.shadows.length ? (
        <Band number={number()} title="Space and shape">
          <div className="brand-scales">
            {brand.spacing.length ? (
              <div>
                <h3 className="brand-subhead">Space</h3>
                <ul className="brand-space">
                  {brand.spacing.slice(0, 10).map((step) => (
                    <li key={step.id}>
                      <span className="brand-space__bar" style={{ inlineSize: /^[\d.]+(px|rem)$/.test(step.value) ? `min(${step.value}, 100%)` : 0 }} />
                      <code>{step.name}</code> <span>{step.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {brand.radius.length ? (
              <div>
                <h3 className="brand-subhead">Corners</h3>
                <ul className="brand-radii">
                  {brand.radius.slice(0, 8).map((step) => (
                    <li key={step.id}>
                      <span className="brand-radii__box" style={{ borderRadius: step.value }} />
                      <code>{step.name}</code> <span>{step.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {brand.shadows.length ? (
              <div>
                <h3 className="brand-subhead">Shadows</h3>
                <ul className="brand-radii">
                  {brand.shadows.slice(0, 4).map((step) => (
                    <li key={step.id}>
                      <span className="brand-radii__box brand-radii__box--shadow" style={{ boxShadow: step.value }} />
                      <code>{step.name}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Band>
      ) : null}
      {brand.components.length ? (
        <Band number={number()} title="Sections">
          <Components siteId={siteId} brand={brand} />
        </Band>
      ) : null}
      <Band number={number()} title="Voice">
        <Voice siteId={siteId} brand={brand} onChange={onChange} editable={editable} />
      </Band>
      {brand.imagery || brand.layout.do.length || brand.layout.dont.length ? (
        <Band number={number()} title="Pictures and layout">
          {brand.imagery ? (
            <div className="brand-imagery">
              <p className="brand-imagery__direction">{brand.imagery.direction}</p>
              <dl className="brand-format">
                {brand.imagery.subjects.length ? (
                  <>
                    <dt>Subjects</dt>
                    <dd>{brand.imagery.subjects.join("; ")}</dd>
                  </>
                ) : null}
                {brand.imagery.light ? (
                  <>
                    <dt>Light</dt>
                    <dd>{brand.imagery.light}</dd>
                  </>
                ) : null}
                {brand.imagery.palette.length ? (
                  <>
                    <dt>Palette</dt>
                    <dd className="brand-logo__colors">
                      {brand.imagery.palette.map((c) => (
                        <i key={c} style={{ background: c }} title={c} />
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}
          <div className="brand-dodont">
            <div>
              <h3 className="brand-subhead">Do</h3>
              <ul>
                {brand.layout.do.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="brand-subhead">Don’t</h3>
              <ul>
                {[...brand.layout.dont, ...(brand.imagery?.avoid ?? []).map((item) => `Pictures: ${item}`)].map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </Band>
      ) : null}
    </div>
  );
}
