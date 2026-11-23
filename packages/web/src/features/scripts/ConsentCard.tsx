import type { ConsentCategory, ScriptsConfig } from "@galley/core/kit";
import { Checkbox, Field, ProofMark, SegmentedControl, cx } from "@/ui";
import { BoundText, BoundToggle } from "@/features/forms/file/Bound";
import { useEdits } from "@/features/forms/file/hooks";
import { useChangeMarks } from "@/features/forms/file/KitFile";
import { CONSENT_WORDS } from "./logic/entries";

type Mode = NonNullable<ScriptsConfig["consent"]>["mode"];

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "none", label: "Off" },
  { value: "banner", label: "Built-in banner" },
  { value: "external", label: "Another consent tool" },
];

const MODE_LINES: Record<Mode, string> = {
  none: "Every switched-on script loads for every visitor, without asking.",
  banner: "The site asks visitors first, with a small banner. Scripts wait for the categories they need.",
  external: "Your own consent tool asks, and tells the site what visitors agreed to. Scripts wait for it.",
};

const OPTIONAL: ConsentCategory[] = ["analytics", "marketing", "preferences"];

/** The banner's words when the setup leaves them out — the site runtime's own defaults. */
export const BANNER_DEFAULTS = {
  title: "Cookies and tracking",
  text: "This site would like to measure visits and the success of its marketing. Choose what it may use. You can change this at any time from the link at the bottom of each page.",
  acceptLabel: "Accept all",
  rejectLabel: "Reject all",
  settingsLabel: "Choose…",
};

function BannerPreview({ banner, theme }: { banner: NonNullable<NonNullable<ScriptsConfig["consent"]>["banner"]>; theme: "light" | "dark" }) {
  return (
    <div className="kit-banner-frame" data-theme={theme}>
      <div className="kit-banner" aria-hidden="true">
        <p className="kit-banner__title">{banner.title || BANNER_DEFAULTS.title}</p>
        <p className="kit-banner__text">
          {banner.text || BANNER_DEFAULTS.text} {banner.policyUrl ? <span className="g-link">Privacy policy</span> : null}
        </p>
        <span className="kit-banner__buttons">
          <span className="kit-pv__button">{banner.acceptLabel || BANNER_DEFAULTS.acceptLabel}</span>
          <span className="kit-pv__button">{banner.rejectLabel || BANNER_DEFAULTS.rejectLabel}</span>
          <span className="kit-pv__button kit-pv__button--back">{banner.settingsLabel || BANNER_DEFAULTS.settingsLabel}</span>
        </span>
      </div>
      <span className="kit-banner-frame__label">{theme === "light" ? "Light" : "Dark"}</span>
    </div>
  );
}

/** One card for consent: off, the built-in banner, or another tool — with the banner's words and a live preview. */
export function ConsentCard({ config, trackingWithoutConsent }: { config: ScriptsConfig; trackingWithoutConsent: boolean }) {
  const edits = useEdits();
  const marks = useChangeMarks();
  const consent = config.consent;
  const mode: Mode = consent?.mode ?? "none";
  const defaults = new Set(consent?.defaults ?? []);
  const banner = consent?.banner ?? {};
  const setDefaults = (category: ConsentCategory, on: boolean) => {
    const next = OPTIONAL.filter((candidate) => (candidate === category ? on : defaults.has(candidate)));
    edits.choose(["consent", "defaults"], next.length ? next : undefined);
  };
  return (
    <section className={cx("g-block kit-consent", marks.has("area:consent") && "kit-consent--flash")} aria-labelledby="consent-title">
      <header className="g-block__head">
        <h2 id="consent-title" className="kit-tab-head__title">
          Consent
        </h2>
      </header>
      <div className="g-block__body kit-consent__body">
        <Field label="Ask visitors first" group hint={MODE_LINES[mode]}>
          <SegmentedControl label="Ask visitors first" options={MODES} value={mode} onChange={(next) => edits.choose(["consent", "mode"], next)} />
        </Field>
        {trackingWithoutConsent ? (
          <p className="g-margin-note kit-note kit-note--warning" role="status">
            <ProofMark kind="bang" />
            <span>Analytics or marketing scripts are switched on with consent off. In many countries visitors must agree before these load.</span>
          </p>
        ) : null}
        {mode === "banner" ? (
          <>
            <div className="kit-consent__texts">
              <BoundText path={["consent", "banner", "title"]} label="Title" placeholder={BANNER_DEFAULTS.title} />
              <BoundText path={["consent", "banner", "text"]} label="Text" placeholder={BANNER_DEFAULTS.text} multiline />
              <div className="app-form-row">
                <BoundText path={["consent", "banner", "acceptLabel"]} label="Accept button" placeholder={BANNER_DEFAULTS.acceptLabel} />
                <BoundText path={["consent", "banner", "rejectLabel"]} label="Refuse button" placeholder={BANNER_DEFAULTS.rejectLabel} />
              </div>
              <div className="app-form-row">
                <BoundText path={["consent", "banner", "settingsLabel"]} label="Choices button" placeholder={BANNER_DEFAULTS.settingsLabel} />
                <BoundText path={["consent", "banner", "policyUrl"]} label="Privacy policy page" mono placeholder="/privacy/" />
              </div>
            </div>
            <div className="kit-consent__previews" aria-label="Banner preview">
              <BannerPreview banner={banner} theme="light" />
              <BannerPreview banner={banner} theme="dark" />
            </div>
          </>
        ) : null}
        {mode !== "none" ? (
          <>
            <Field label="On before the visitor chooses" group hint="Necessary scripts always load. Leave these off where the law asks for agreement first.">
              <div className="kit-checks">
                {OPTIONAL.map((category) => (
                  <Checkbox key={category} label={CONSENT_WORDS[category].label} description={CONSENT_WORDS[category].line} checked={defaults.has(category)} onChange={(on) => setDefaults(category, on)} />
                ))}
              </div>
            </Field>
            <BoundToggle path={["consent", "googleConsentMode"]} label="Tell Google tags about consent (Consent Mode)" description="Google Analytics and Tag Manager are told what visitors agreed to, so they can adjust what they record." />
          </>
        ) : null}
      </div>
    </section>
  );
}
