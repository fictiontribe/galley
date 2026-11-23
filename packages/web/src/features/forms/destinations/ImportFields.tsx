import { useState } from "react";
import type { FormIntrospectField } from "@galley/core/api";
import type { FormDestination, FormField } from "@galley/core/kit";
import { api, errorShape, isApiFailure } from "@/lib/api";
import { count } from "@/lib/format";
import { notify } from "@/lib/stores/toasts";
import { Button, Checkbox, Dialog, ProofMark } from "@/ui";
import { insertFieldsOps, removeInsertedOps } from "../logic/fieldOps";
import { planImport } from "../logic/introspect";
import { mappedName, sendableFields } from "../logic/mapping";
import { useEdits } from "../file/hooks";

export interface ImportFieldsProps {
  siteId: string;
  index: number;
  destination: FormDestination;
  fields: readonly FormField[];
  providerName: string;
  ready: boolean;
}

type State = { kind: "idle" } | { kind: "busy" } | { kind: "unavailable" } | { kind: "error"; message: string } | { kind: "chosen"; remote: FormIntrospectField[]; picked: ReadonlySet<string> };

/** "Import fields from the {Provider} form": reads its fields and adds the ones this form doesn't send yet, mapped to the provider's names. */
export function ImportFields({ siteId, index, destination, fields, providerName, ready }: ImportFieldsProps) {
  const edits = useEdits();
  const [state, setState] = useState<State>({ kind: "idle" });
  const sent = new Set(sendableFields(fields).map((field) => mappedName(destination, field)));

  const read = async () => {
    setState({ kind: "busy" });
    try {
      const result = await api("POST /api/sites/:siteId/forms/introspect", { params: { siteId }, body: { provider: destination.provider, settings: destination.settings } });
      setState({ kind: "chosen", remote: result.fields, picked: new Set(result.fields.filter((field) => !sent.has(field.name)).map((field) => field.name)) });
    } catch (error) {
      if (isApiFailure(error) && error.status === 404) setState({ kind: "unavailable" });
      else setState({ kind: "error", message: errorShape(error).message });
    }
  };

  const add = () => {
    if (state.kind !== "chosen") return;
    const plan = planImport(state.remote.filter((field) => state.picked.has(field.name)), fields, sent);
    const at = fields.length;
    edits.apply(...insertFieldsOps(at, plan.fields), ...plan.mapping.map(({ fieldId, name }) => ({ op: "set" as const, path: ["destinations", index, "mapping", fieldId], value: name })));
    setState({ kind: "idle" });
    notify({
      tone: "neutral",
      title: `${count(plan.fields.length, "field")} added from ${providerName}`,
      body: "They’re at the end of the form, already sent under their names there.",
      action: { label: "Undo", onClick: () => edits.apply(...plan.mapping.map(({ fieldId }) => ({ op: "unset" as const, path: ["destinations", index, "mapping", fieldId] })), ...removeInsertedOps(at, plan.fields.length)) },
      duration: 10000,
    });
  };

  return (
    <div className="kit-import">
      <Button size="sm" variant="secondary" busy={state.kind === "busy"} busyLabel="Reading…" disabled={!ready} onClick={() => void read()} title={ready ? undefined : `Fill in the ${providerName} settings first`}>
        Import fields from the {providerName} form
      </Button>
      {state.kind === "unavailable" ? <p className="g-hint kit-import__note">Importing fields isn’t available yet. Add the fields by hand and map them below.</p> : null}
      {state.kind === "error" ? (
        <p className="g-error-text kit-import__note" role="alert">
          <ProofMark kind="bang" />
          <span>Couldn’t read the {providerName} form. {state.message}</span>
        </p>
      ) : null}
      <Dialog
        open={state.kind === "chosen"}
        onClose={() => setState({ kind: "idle" })}
        title={`Fields on the ${providerName} form`}
        description="Pick the ones to add. Fields this form already sends are left out."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setState({ kind: "idle" })}>
              Not now
            </Button>
            <Button variant="primary" disabled={state.kind !== "chosen" || state.picked.size === 0} onClick={add}>
              {state.kind === "chosen" ? `Add ${count(state.picked.size, "field")}` : "Add"}
            </Button>
          </>
        }
      >
        {state.kind === "chosen" ? (
          state.remote.length === 0 ? (
            <p>The {providerName} form has no fields.</p>
          ) : (
            <ul className="kit-import__list">
              {state.remote.map((field) => {
                const already = sent.has(field.name);
                return (
                  <li key={field.name}>
                    <Checkbox
                      checked={state.picked.has(field.name)}
                      disabled={already}
                      label={`${field.label || field.name}${field.required ? " (required there)" : ""}`}
                      description={already ? `Already sent as ${field.name}` : `Sent as ${field.name}${field.type ? ` · ${field.type}` : ""}`}
                      onChange={(checked) => {
                        const picked = new Set(state.picked);
                        if (checked) picked.add(field.name);
                        else picked.delete(field.name);
                        setState({ ...state, picked });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </Dialog>
    </div>
  );
}
