import { useState } from "react";
import type { FormAction, FormField } from "@galley/core/kit";
import { Button, Checkbox, Field, IconButton, Input, ProofMark, Textarea } from "@/ui";
import { sendableFields } from "../logic/mapping";
import { BoundChoice, BoundNumber, BoundText, BoundToggle } from "../file/Bound";
import { useEdits } from "../file/hooks";
import { FilePicker } from "./FilePicker";
import { MessageEditor } from "./MessageEditor";
import { PageAddress } from "./PageAddress";
import { BUILD_MODE_LEVEL } from "@galley/core/install/route-access";
import { whoMayFirst } from "@/lib/may";

/** Why custom code isn't offered to someone whose role doesn't include changing the site's code. */
export const CODE_BY_OTHERS = `${whoMayFirst(BUILD_MODE_LEVEL)} can add or change custom code.`;

export interface ActionBodyProps {
  siteId: string;
  index: number;
  action: FormAction;
  fields: readonly FormField[];
  allowBuild: boolean;
  /** The site allows custom code, but this person's role doesn't include it. */
  buildByOthers?: boolean;
  hasMessage: boolean;
}

function Params({ index, params }: { index: number; params: { [key: string]: string } }) {
  const edits = useEdits();
  const base = ["afterSubmit", index, "params"];
  const names = Object.keys(params);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const rename = (from: string) => {
    const next = (typed[from] ?? from).trim();
    setTyped(({ [from]: _, ...rest }) => rest);
    if (!next || next === from || names.includes(next)) return;
    edits.apply({ op: "unset", path: [...base, from] }, { op: "set", path: [...base, next], value: params[from] ?? "" });
  };
  return (
    <Field label="Details sent with it" group hint="Optional, e.g. form_name: demo. Use {{field}} for an answer.">
      {names.length ? (
        <ul className="kit-constants">
          {names.map((name) => (
            <li key={name} className="kit-constant">
              <input className="g-input g-input--sm g-input--mono" aria-label="Name" value={typed[name] ?? name} onChange={(event) => setTyped({ ...typed, [name]: event.target.value })} onBlur={() => rename(name)} />
              <input className="g-input g-input--sm" aria-label={`Value of ${name}`} value={params[name] ?? ""} onChange={(event) => edits.type([...base, name], event.target.value, true)} onBlur={() => edits.commit([...base, name])} />
              <IconButton icon="close" label={`Remove ${name}`} onClick={() => edits.apply({ op: "unset", path: [...base, name] })} />
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        icon="plus"
        onClick={() => {
          let name = "form_name";
          for (let n = 2; names.includes(name); n++) name = `detail_${n}`;
          edits.apply({ op: "set", path: [...base, name], value: "" });
        }}
      >
        Add a detail
      </Button>
    </Field>
  );
}

/** The settings of one after-sending step, by its type. */
export function ActionBody({ siteId, index, action, fields, allowBuild, buildByOthers = false, hasMessage }: ActionBodyProps) {
  const edits = useEdits();
  const [picking, setPicking] = useState(false);
  const p = (...rest: Array<string | number>) => ["afterSubmit", index, ...rest];
  switch (action.type) {
    case "message":
      return (
        <>
          <BoundText path={p("title")} label="Title" placeholder="Thank you" />
          <MessageEditor path={p("text")} label="Message" fields={fields} />
        </>
      );
    case "redirect": {
      const carried = new Set(action.passFields ?? []);
      return (
        <>
          <PageAddress siteId={siteId} path={p("url")} label="Page" />
          {hasMessage ? <BoundNumber path={p("delaySeconds")} label="Wait before changing page (seconds)" placeholder="0" min={0} hint="Gives visitors time to read the thank-you." /> : null}
          <Field label="Carry these answers in the address" group hint="Added to the page address, so the next page can use them. Avoid anything private.">
            <div className="kit-checks">
              {sendableFields(fields).map((field) => (
                <Checkbox
                  key={field.id}
                  label={field.label?.trim() || field.id}
                  checked={carried.has(field.id)}
                  onChange={(checked) => {
                    const next = sendableFields(fields).map((candidate) => candidate.id).filter((id) => (id === field.id ? checked : carried.has(id)));
                    edits.choose(p("passFields"), next.length ? next : undefined);
                  }}
                />
              ))}
            </div>
          </Field>
        </>
      );
    }
    case "download":
      return (
        <>
          <Field label="File" error={action.url ? null : "Choose the file to offer."}>
            <div className="kit-inline-row">
              <Input mono value={action.url} placeholder="/downloads/guide.pdf" onChange={(event) => edits.type(p("url"), event.target.value, true)} onBlur={() => edits.commit(p("url"))} />
              <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                Choose from media…
              </Button>
            </div>
          </Field>
          <BoundText path={p("label")} label="Button" placeholder="Download" />
          <BoundToggle path={p("auto")} label="Start the download straight away" description="Otherwise the visitor gets a button to press." />
          <FilePicker siteId={siteId} open={picking} onClose={() => setPicking(false)} onPick={(url) => edits.choose(p("url"), url)} />
        </>
      );
    case "event":
      return (
        <>
          <BoundText path={p("name")} label="Conversion name" mono keep placeholder="form_submitted" hint="The name your analytics or ads count, e.g. generate_lead." />
          <BoundChoice
            path={p("target")}
            label="Where it’s recorded"
            absent="dataLayer"
            as="select"
            options={[
              { value: "dataLayer", label: "Tag Manager (data layer)" },
              { value: "gtag", label: "Google tag (gtag)" },
              { value: "dom", label: "A page event, for your own code" },
            ]}
          />
          <Params index={index} params={action.params ?? {}} />
        </>
      );
    case "webhook":
      return (
        <BoundText
          path={p("url")}
          label="Address"
          mono
          keep
          placeholder="https://hooks.example.com/…"
          error={action.url && !/^https:\/\/.+/.test(action.url) ? "Use an address that starts with https://." : null}
          hint="A copy of the answers is posted here after sending. Nobody waits for it, so a slow service doesn’t hold the visitor up."
        />
      );
    case "script":
      return (
        <>
          <p className="g-margin-note kit-note kit-note--warning">
            <ProofMark kind="bang" />
            <span>This code runs on the live site with the visitor’s answers — and only if the site’s developer has allowed form code. Only add code from someone you trust; it waits in Proof like every other change.</span>
          </p>
          {allowBuild ? (
            <Field label="Code" hint="For developers: JavaScript, called with `values` (the answers) after the form is sent.">
              <Textarea mono rows={6} maxRows={20} value={action.code} spellCheck={false} onChange={(event) => edits.type(p("code"), event.target.value, true)} onBlur={() => edits.commit(p("code"))} />
            </Field>
          ) : (
            <p className="g-hint">{buildByOthers ? `${CODE_BY_OTHERS} It stays as it is.` : "Custom code can only be changed on sites where build mode is allowed. It stays as it is."}</p>
          )}
        </>
      );
  }
}

