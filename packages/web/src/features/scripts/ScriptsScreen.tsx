import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { Entry } from "@galley/core/types";
import type { ScriptEntry } from "@galley/core/kit";
import "@/features/forms/forms.css";
import "./scripts.css";
import { useTopBar } from "@/app/chrome";
import { useForm, useFormState, useFormValue } from "@/features/content/form/context";
import { ConflictNotice, SaveErrorNotice } from "@/features/content/form/FormNotices";
import { insertOp } from "@/features/content/form/ops";
import { planMove, planRemove } from "@/features/content/fields/items/listPlan";
import { notify } from "@/lib/stores/toasts";
import { useSite } from "@/lib/stores/site";
import { Button, EmptyState, ErrorState, PageHeader, ProofMark, Skeleton } from "@/ui";
import { AskBox } from "@/features/forms/file/AskBox";
import { AssistantPanel } from "@/features/forms/file/AssistantPanel";
import { useAllowBuild, useBuildByOthers } from "@/features/forms/file/assistant";
import { useEdits, useScriptsDoc } from "@/features/forms/file/hooks";
import { KitFile, useKitEntry } from "@/features/forms/file/KitFile";
import { SetupLeftNotice, SetupState } from "@/features/forms/file/SetupState";
import { useListDrag } from "@/features/forms/file/useListDrag";
import { toJson } from "@/features/forms/logic/json";
import { fileNoun, scriptsFile } from "@/features/forms/logic/locate";
import { scriptChangeMarks } from "@/features/forms/logic/marks";
import { AddScriptDialog } from "./AddScriptDialog";
import { ConsentCard } from "./ConsentCard";
import { scriptWarnings } from "./logic/duplicates";
import { scriptName } from "./logic/entries";
import { ScriptRow } from "./ScriptRow";
import { WhatLoadsWhere } from "./WhatLoadsWhere";
import { BUILD_MODE_LEVEL } from "@galley/core/install/route-access";
import { useWhoPublishes, whoMayFirst } from "@/lib/may";

const PATH = ["scripts"];
const EXAMPLES = ["Add GA4 with ID G-ABC123 and only load it after consent", "Turn on the built-in consent banner with Consent Mode", "Load the chat widget only on /support/**"];

/** Lets go of what the server refused about the list's scripts: after a move, a removal or an addition its places mean other scripts. */
function useForgetScriptRefusals(): () => void {
  const { store } = useForm();
  return () => {
    for (const key of Object.keys(store.getState().refusals)) if (key === "scripts" || key.startsWith("scripts.")) store.actions.clearRefusal(key.split("."));
  };
}

function Installed({ open, setOpen, onAdd, warned, mayTurnOn }: { open: ReadonlySet<number>; setOpen: (next: ReadonlySet<number>) => void; onAdd: (() => void) | null; warned: ReadonlySet<number>; mayTurnOn: boolean }) {
  const edits = useEdits();
  const forget = useForgetScriptRefusals();
  const publishes = useWhoPublishes();
  const raw = useFormValue(PATH);
  const list = Array.isArray(raw) ? raw : [];
  const config = useScriptsDoc();
  const scroller = useRef<HTMLDivElement>(null);
  const move = (from: number, to: number) => {
    const plan = planMove(PATH, list.length, from, to);
    if (!plan) return;
    forget();
    edits.apply(...plan.ops);
    // Keep the open card open where it went.
    if (open.has(from)) setOpen(new Set([...open].filter((index) => index !== from).concat(to)));
  };
  const drag = useListDrag(scroller, move);
  const remove = (index: number) => {
    const plan = planRemove(PATH, list, index);
    const entry = config.scripts[index];
    if (!plan || !entry) return;
    forget();
    edits.apply(...plan.ops);
    setOpen(new Set());
    // Someone who may not turn a script on gets it back turned off: putting it back on would be refused.
    const backOff = entry.enabled && !mayTurnOn;
    const item = list[index];
    const undo = backOff && item && typeof item === "object" && !Array.isArray(item) ? [insertOp(PATH, index, { ...item, enabled: false })] : plan.undo;
    notify({
      tone: "neutral",
      title: `${scriptName(entry)} removed`,
      body: `It stops loading on the site when ${publishes}. ${backOff ? "Undo puts it back where it was, turned off." : "Undo puts it back where it was."}`,
      action: {
        label: "Undo",
        onClick: () => {
          forget();
          edits.apply(...undo);
        },
      },
      duration: 10000,
    });
  };
  const toggle = (index: number) => {
    const next = new Set(open);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpen(next);
  };
  if (list.length === 0) {
    return (
      <div className="app-card">
        <EmptyState
          title="No scripts yet."
          body={`Add analytics, a tag manager, ad tracking or a chat widget. Nothing loads until ${publishes}.`}
          mark="caret"
          actions={
            onAdd ? (
              <Button variant="primary" icon="plus" onClick={onAdd}>
                Add a script
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <div className="kit-scripts" ref={scroller}>
      {list.map((_, index) => (
        <ScriptRow key={index} index={index} total={list.length} open={open.has(index)} warned={warned.has(index)} drag={drag} onToggle={toggle} onMove={move} onRemove={remove} />
      ))}
    </div>
  );
}

function ScriptsBody({ siteId, entry }: { siteId: string; entry: Entry }) {
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  const pages = useSite((s) => s.detail?.model.collections.find((collection) => collection.id === "pages")?.url ?? null);
  const publishes = useWhoPublishes();
  useTopBar({
    crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Scripts" }],
    ...(entry.status === "modified" ? { tag: { label: "Edited", tone: "change" as const } } : entry.status === "added" ? { tag: { label: "New", tone: "insert" as const } } : {}),
  });
  const config = useScriptsDoc();
  const edits = useEdits();
  const allowBuild = useAllowBuild();
  const buildByOthers = useBuildByOthers();
  // A script runs in every visitor's browser: adding one or turning one on takes the build-mode level and a site that
  // allows build mode, as a form's custom code does (site-kit/guard.ts). useAllowBuild asks both.
  const siteAllowsBuild = useSite((s) => s.detail?.model.ai.allowBuild ?? false);
  const mayTurnOn = allowBuild;
  const forget = useForgetScriptRefusals();
  // What the server refused about the scripts, said here: a switch or a new script has no field of its own to say it.
  const refused = useFormState((state) => state.refusals);
  const refusals = [...new Set(Object.entries(refused).filter(([key]) => key === "scripts" || key.startsWith("scripts.")).map(([, reason]) => reason))];
  const model = useSite((s) => s.detail?.model);
  const outside = useFormState((state) => state.outside);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const warnings = useMemo(() => scriptWarnings(config), [config]);
  const warned = useMemo(() => new Set(warnings.filter((warning) => warning.tone === "warning" && warning.id !== "no-consent").flatMap((warning) => warning.scripts)), [warnings]);
  const suggestions = useMemo(() => {
    const fromRules = config.scripts.flatMap((script) => [...(script.include ?? []), ...(script.exclude ?? [])]).map((pattern) => pattern.replace(/\*\*?/g, "example").replace(/\?/g, "x"));
    return [...new Set(["/", pages ? pages.replace("{slug}", "about") : "/about/", ...fromRules])].slice(0, 6);
  }, [config.scripts, pages]);
  const add = (script: ScriptEntry) => {
    const at = config.scripts.length;
    forget();
    edits.apply(insertOp(PATH, at, toJson(script)));
    setOpen(new Set([at]));
  };
  const trackingWithoutConsent = warnings.some((warning) => warning.id === "no-consent");

  return (
    <div className="app-screen kit-scripts-screen">
      <div className="app-screen__inner">
        <PageHeader
          title="Scripts"
          description={`Analytics, tags and widgets the site loads. Adding or changing one is powerful, so every change waits in Proof like any other until ${publishes}.`}
          actions={
            // While the list is empty, its own empty state offers this.
            config.scripts.length > 0 && mayTurnOn ? (
              <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                Add a script
              </Button>
            ) : null
          }
        />
        <AskBox layout="line" needsBuild subject="scripts" context={`About the scripts setup in ${entry.path}:`} examples={EXAMPLES} placeholder="Add GA4 with ID G-… and only load it after consent" />
        {mayTurnOn ? null : (
          <p className="g-margin-note kit-note" role="status">
            <ProofMark kind="pilcrow" />
            <span>
              {!siteAllowsBuild
                ? "This site's settings keep build mode off, so nobody can add a script or turn one on: it runs in every visitor's browser. An owner can turn on “Allow build mode” in Site settings › Assistant. You can still turn one off, remove it, or change where it loads."
                : `${whoMayFirst(BUILD_MODE_LEVEL)} can add a script or turn one on, because it runs in every visitor's browser. You can turn one off, remove it, or change where it loads.`}
            </span>
          </p>
        )}
        {refusals.map((reason) => (
          <p key={reason} className="g-margin-note kit-note kit-note--warning" role="alert">
            <ProofMark kind="bang" />
            <span>{reason}</span>
          </p>
        ))}
        <SetupLeftNotice step="layout" />
        <ConflictNotice fields={entry.fields} noun={fileNoun(model, entry.collection)} />
        <SaveErrorNotice />
        {outside ? (
          <p className="g-margin-note kit-note" role="status" key={outside.at}>
            <ProofMark kind="transpose" />
            <span>{outside.origin === "agent" ? "The assistant changed the scripts. What it changed is marked for a moment." : "The scripts setup changed outside the app. This shows the latest version."}</span>
          </p>
        ) : null}
        {warnings
          .filter((warning) => warning.id !== "no-consent")
          .map((warning) => (
            <p key={warning.id} className={warning.tone === "warning" ? "g-margin-note kit-note kit-note--warning" : "g-margin-note kit-note"} role="status">
              <ProofMark kind={warning.tone === "warning" ? "bang" : "pilcrow"} />
              <span>{warning.text}</span>
            </p>
          ))}
        <div className="kit-scripts-layout">
          <section className="kit-scripts-layout__main" aria-labelledby="installed-title">
            <h2 id="installed-title" className="kit-tab-head__title">
              Installed
            </h2>
            <Installed open={open} setOpen={setOpen} onAdd={mayTurnOn ? () => setAdding(true) : null} warned={warned} mayTurnOn={mayTurnOn} />
          </section>
          <div className="kit-scripts-layout__side">
            <ConsentCard config={config} trackingWithoutConsent={trackingWithoutConsent} />
            <WhatLoadsWhere config={config} suggestions={suggestions} />
          </div>
        </div>
      </div>
      <AddScriptDialog open={adding} onClose={() => setAdding(false)} taken={config.scripts.map((script) => script.id)} allowBuild={allowBuild} buildByOthers={buildByOthers} onAdd={add} />
    </div>
  );
}

function Crumbs({ siteId, siteName }: { siteId: string; siteName: string }) {
  useTopBar({ crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Scripts" }] });
  return null;
}

/** /sites/:siteId/scripts — the third-party scripts the site loads, and how it asks for consent. */
export function ScriptsScreen() {
  const { siteId = "" } = useParams();
  const detail = useSite((s) => s.detail);
  const siteName = detail?.name ?? "Site";
  const file = detail && detail.id === siteId ? scriptsFile(detail.model) : null;
  const entry = useKitEntry(siteId, file?.path ?? null);

  let body;
  if (!detail || detail.id !== siteId || (file && entry.loading)) {
    body = (
      <div className="app-screen" aria-busy="true">
        <div className="app-screen__inner">
          <Skeleton width={120} height={12} />
          <Skeleton width={240} height={28} style={{ marginBlock: "var(--space-3) var(--space-6)" }} />
          <Skeleton lines={5} height={14} />
        </div>
      </div>
    );
  } else if (!file) {
    body = (
      <div className="app-screen">
        <div className="app-screen__inner">
          <PageHeader title="Scripts" />
          <SetupState feature="scripts" />
        </div>
      </div>
    );
  } else if (!entry.data) {
    body = (
      <div className="app-screen app-screen--center">
        <ErrorState title="Couldn’t open the scripts setup" error={entry.error} onRetry={() => void entry.refetch()} />
      </div>
    );
  } else {
    return (
      <KitFile key={entry.data.path} siteId={siteId} entry={entry.data} marksFor={scriptChangeMarks}>
        <div className="kit-screen">
          <ScriptsBody siteId={siteId} entry={entry.data} />
          <AssistantPanel siteId={siteId} entryPath={entry.data.path} />
        </div>
      </KitFile>
    );
  }
  return (
    <div className="kit-screen">
      <Crumbs siteId={siteId} siteName={siteName} />
      {body}
      <AssistantPanel siteId={siteId} />
    </div>
  );
}
