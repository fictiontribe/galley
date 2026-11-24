import type { ConsentCategory, ScriptEntry } from "@galley/core/kit";
import { Field, ProofMark, SegmentedControl, Select } from "@/ui";
import { useAllowBuild, useBuildByOthers } from "@/features/forms/file/assistant";
import { BUILD_MODE_LEVEL } from "@galley/core/install/route-access";
import { whoMayFirst } from "@/lib/may";
import { BoundText, BoundToggle } from "@/features/forms/file/Bound";
import { useEdits } from "@/features/forms/file/hooks";
import { ProviderSettings } from "@/features/forms/destinations/ProviderSettings";
import { settingText } from "@/features/forms/logic/json";
import { CONSENT_WORDS, LOAD_WORDS, PLACEMENT_WORDS, consentOf, integrationOf, loadOf } from "./logic/entries";
import { PagesEditor } from "./PagesEditor";

const CATEGORIES: ConsentCategory[] = ["necessary", "analytics", "marketing", "preferences"];

/** Everything about one script: its settings, pages, loading, consent, preview, and a note. */
export function ScriptDetail({ index, entry }: { index: number; entry: ScriptEntry }) {
  const edits = useEdits();
  const allowBuild = useAllowBuild();
  const byOthers = useBuildByOthers();
  const integration = integrationOf(entry.kind);
  const p = (...rest: Array<string | number>) => ["scripts", index, ...rest];
  const load = loadOf(entry);
  const consent = consentOf(entry);
  const custom = entry.kind === "custom";
  const hasInline = settingText(entry.settings.inline).trim() !== "";
  const specs = (integration?.settings ?? []).filter((spec) => !(custom && spec.key === "inline" && !allowBuild));

  return (
    <div className="kit-script-detail">
      <div className="kit-script-detail__col">
        <BoundText path={p("label")} label="Name in this app" placeholder={integration?.name ?? entry.kind} />
        {specs.length > 0 ? <ProviderSettings path={p("settings")} specs={specs} values={entry.settings} /> : <p className="g-hint">This kind of script isn’t in the catalogue; its settings stay as they are in the file.</p>}
        {custom && !allowBuild ? (
          <p className="g-margin-note kit-note">
            <ProofMark kind="reg" />
            <span>
              {byOthers
                ? hasInline
                  ? `This script runs code written into the site. ${whoMayFirst(BUILD_MODE_LEVEL)} can change it.`
                  : `${whoMayFirst(BUILD_MODE_LEVEL)} can add custom code. A script address works for everyone.`
                : hasInline
                  ? "This script runs code written into the site. It can only be changed where build mode is allowed."
                  : "Custom code can only be added on sites where build mode is allowed. A script address works everywhere."}
            </span>
          </p>
        ) : null}
        {integration?.docsUrl ? (
          <a className="g-link" href={integration.docsUrl} target="_blank" rel="noreferrer">
            Where to find these in {integration.name}
          </a>
        ) : null}
        <BoundText path={p("note")} label="Note for colleagues" multiline placeholder="Who asked for it and why — “added for the spring campaign, ask before removing”" />
      </div>
      <div className="kit-script-detail__col">
        <PagesEditor index={index} entry={entry} />
        <Field label="When it loads" group hint={LOAD_WORDS[load].line}>
          <SegmentedControl
            label="When it loads"
            options={(Object.keys(LOAD_WORDS) as Array<keyof typeof LOAD_WORDS>).map((value) => ({ value, label: LOAD_WORDS[value].label }))}
            value={load}
            onChange={(next) => edits.choose(p("load"), next)}
          />
        </Field>
        <Field label="Consent" group hint={CONSENT_WORDS[consent].line}>
          <SegmentedControl label="Consent" options={CATEGORIES.map((value) => ({ value, label: CONSENT_WORDS[value].label }))} value={consent} onChange={(next) => edits.choose(p("consent"), next)} />
        </Field>
        <Field label="Where in the page">
          <Select
            value={entry.placement ?? integration?.defaultPlacement ?? "head"}
            options={(Object.keys(PLACEMENT_WORDS) as Array<keyof typeof PLACEMENT_WORDS>).map((value) => ({ value, label: PLACEMENT_WORDS[value] }))}
            onChange={(next) => edits.choose(p("placement"), next)}
          />
        </Field>
        <BoundToggle path={p("inPreview")} label="Also load in preview and development" description="Off by default, so your own testing isn’t counted as visits or sent to your ad accounts." />
      </div>
    </div>
  );
}
