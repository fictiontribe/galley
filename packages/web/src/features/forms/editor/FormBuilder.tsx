import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Entry } from "@galley/core/types";
import { useFormState, useFormValue } from "@/features/content/form/context";
import { ConflictNotice, SaveErrorNotice } from "@/features/content/form/FormNotices";
import { useTopBar } from "@/app/chrome";
import { useSite } from "@/lib/stores/site";
import { Icon, ProofMark, TabPanel, Tabs, Toggle } from "@/ui";
import { formChangeMarks } from "../logic/marks";
import { isObject, readForm } from "../logic/json";
import { fileNoun, formIdOf } from "../logic/locate";
import { AskBox } from "../file/AskBox";
import { AssistantPanel } from "../file/AssistantPanel";
import { KitFile } from "../file/KitFile";
import { Canvas } from "../canvas/Canvas";
import type { Labels } from "../canvas/FieldPreview";
import { Inspector } from "../inspector/Inspector";
import { Destinations } from "../destinations/Destinations";
import { AfterSending } from "../after/AfterSending";
import { TestRun } from "../test/TestRun";
import { UseThisForm } from "../embed/UseThisForm";
import { BuilderContext, createBuilderStore, useBuilder, type BuilderTab } from "./builderState";
import { Palette } from "./Palette";
import { SettingsLink } from "@/features/accounts/SettingsLink";

const EXAMPLES = ["Add a company size dropdown with five ranges and make phone optional", "Send it to HubSpot as well, mapped to the usual names", "Split it into two steps: about you, then your project"];

function SaveStatus() {
  const busy = useFormState((state) => state.busy);
  return (
    <span className="kit-builder__status" role="status">
      {busy ? "Saving…" : ""}
    </span>
  );
}

const NOTE_MS = 9000;

function OutsideNote() {
  const outside = useFormState((state) => state.outside);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!outside) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), NOTE_MS);
    return () => clearTimeout(timer);
  }, [outside]);
  if (!outside || !visible) return null;
  return (
    <p className="g-margin-note kit-note kit-builder__outside" role="status" key={outside.at}>
      <ProofMark kind="transpose" />
      <span>{outside.origin === "agent" ? "The assistant changed this form. What it changed is marked for a moment." : "This form changed outside the app. It now shows the latest version."}</span>
    </p>
  );
}

function TestToggle() {
  const testing = useBuilder((s) => s.testing);
  const setTesting = useBuilder((s) => s.setTesting);
  return <Toggle checked={testing} onChange={setTesting} label="Test" description={testing ? "Nothing is sent" : undefined} />;
}

function FieldsTab() {
  const testing = useBuilder((s) => s.testing);
  const setTesting = useBuilder((s) => s.setTesting);
  const data = useFormState((state) => (testing ? state.data : null));
  const appearance = useFormValue(["appearance"]);
  const labels: Labels = isObject(appearance) && (appearance.labels === "floating" || appearance.labels === "hidden") ? appearance.labels : "above";
  const form = useMemo(() => (data ? readForm(data) : null), [data]);
  return (
    <div className="kit-fields">
      <Palette />
      <div className="kit-fields__centre">
        <div className="kit-fields__head">
          <TestToggle />
        </div>
        {testing && form ? <TestRun form={form} labels={labels} onDone={() => setTesting(false)} /> : <Canvas />}
      </div>
      <aside className="kit-fields__side" aria-label="Settings">
        {testing ? (
          <div className="kit-insp">
            <p className="g-eyebrow">Testing</p>
            <p className="g-hint">Fill in the form and send it. Answers are checked the way visitors’ are; the results show what each destination would receive. Switch Test off to keep editing.</p>
          </div>
        ) : (
          <Inspector />
        )}
      </aside>
    </div>
  );
}

function BuilderBody({ siteId, entry }: { siteId: string; entry: Entry }) {
  const tab = useBuilder((s) => s.tab);
  const setTab = useBuilder((s) => s.setTab);
  const name = useFormValue(["name"]);
  const fields = useFormValue(["fields"]);
  const destinations = useFormValue(["destinations"]);
  const after = useFormValue(["afterSubmit"]);
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  const model = useSite((s) => s.detail?.model);
  const formId = formIdOf(entry.path);
  const capturing = Array.isArray(destinations) && destinations.some((destination) => isObject(destination) && destination.provider === "galley");
  const title = typeof name === "string" && name.trim() ? name : formId;
  useTopBar({
    crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Forms", to: `/sites/${siteId}/forms` }, { label: title }],
    ...(entry.status === "added" ? { tag: { label: "New", tone: "insert" as const } } : entry.status === "modified" ? { tag: { label: "Edited", tone: "change" as const } } : {}),
  });
  const tabs = [
    { id: "fields", label: "Fields", count: Array.isArray(fields) ? fields.length : 0, quietCount: true },
    { id: "destinations", label: "Where it goes", count: Array.isArray(destinations) ? destinations.length : 0, quietCount: true },
    { id: "after", label: "After sending", count: Array.isArray(after) ? after.length : 0, quietCount: true },
  ];
  return (
    <div className="kit-builder">
      <header className="kit-builder__bar">
        <Link to={`/sites/${siteId}/forms`} className="g-btn g-btn--quiet g-btn--sm g-btn--icon" aria-label="All forms" title="All forms">
          <Icon name="chevron-left" />
        </Link>
        <div className="kit-builder__titles">
          <h1 className="kit-builder__title">{title}</h1>
          <span className="g-field__key">{entry.path}</span>
        </div>
        <SaveStatus />
        <span className="g-toolbar__spacer" />
        {capturing ? (
          <SettingsLink route="GET /api/sites/:siteId/inbox" className="g-btn g-btn--quiet g-btn--sm" to={`/sites/${siteId}/inbox?form=${encodeURIComponent(formId)}`} fallback={null}>
            See submissions
          </SettingsLink>
        ) : null}
        <UseThisForm siteId={siteId} formId={formId} />
      </header>
      <div className="kit-builder__tabs">
        <Tabs label="Form builder" idBase="form-builder" items={tabs} value={tab} onChange={(next) => setTab(next as BuilderTab)} />
        <AskBox subject="this form" context={`About the form in ${entry.path}:`} examples={EXAMPLES} placeholder="Add a phone field, make it optional…" />
      </div>
      <div className="kit-builder__notices">
        <ConflictNotice fields={entry.fields} noun={fileNoun(model, entry.collection)} />
        <SaveErrorNotice />
        <OutsideNote />
      </div>
      <TabPanel idBase="form-builder" id="fields" value={tab} className="kit-builder__panel">
        {tab === "fields" ? <FieldsTab /> : null}
      </TabPanel>
      <TabPanel idBase="form-builder" id="destinations" value={tab} className="kit-builder__panel">
        {tab === "destinations" ? <Destinations siteId={siteId} formId={formId} /> : null}
      </TabPanel>
      <TabPanel idBase="form-builder" id="after" value={tab} className="kit-builder__panel">
        {tab === "after" ? <AfterSending siteId={siteId} /> : null}
      </TabPanel>
    </div>
  );
}

/** The form builder over one form file: fields, where it goes, after sending — every change an edit to that file. */
export function FormBuilder({ siteId, entry }: { siteId: string; entry: Entry }) {
  const [builder] = useState(() => createBuilderStore());
  return (
    <BuilderContext.Provider value={builder}>
      <KitFile siteId={siteId} entry={entry} marksFor={formChangeMarks}>
        <div className="kit-screen">
          <BuilderBody siteId={siteId} entry={entry} />
          <AssistantPanel siteId={siteId} entryPath={entry.path} />
        </div>
      </KitFile>
    </BuilderContext.Provider>
  );
}
