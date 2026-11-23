import { useId, useState } from "react";
import { Button, Field, IconButton } from "@/ui";
import { constantSuggestions } from "../logic/mapping";
import { useEdits } from "../file/hooks";

export interface ConstantsListProps {
  index: number;
  provider: string;
  constants: { [key: string]: string };
  providerName: string;
}

function ConstantRow({ index, name, value, names, listId }: { index: number; name: string; value: string; names: readonly string[]; listId: string }) {
  const edits = useEdits();
  const [typedName, setTypedName] = useState<string | null>(null);
  const path = (key: string) => ["destinations", index, "constants", key];
  const shownName = typedName ?? name;
  const clash = typedName !== null && typedName.trim() !== name && names.includes(typedName.trim());
  const rename = () => {
    if (typedName === null) return;
    const next = typedName.trim();
    setTypedName(null);
    if (!next || next === name || clash) return;
    edits.apply({ op: "unset", path: path(name) }, { op: "set", path: path(next), value });
  };
  return (
    <li className="kit-constant">
      <input
        className="g-input g-input--sm g-input--mono"
        aria-label="Name"
        list={listId}
        value={shownName}
        aria-invalid={clash || undefined}
        title={clash ? "Another fixed value has this name" : undefined}
        onChange={(event) => setTypedName(event.target.value)}
        onBlur={rename}
        onKeyDown={(event) => event.key === "Enter" && rename()}
      />
      <input className="g-input g-input--sm" aria-label={`Value for ${name}`} value={value} onChange={(event) => edits.type(path(name), event.target.value, true)} onBlur={() => edits.commit(path(name))} />
      <IconButton icon="close" label={`Remove ${name}`} onClick={() => edits.apply({ op: "unset", path: path(name) })} />
    </li>
  );
}

/** Values sent with every submission: a lead source, a campaign id. */
export function ConstantsList({ index, provider, constants, providerName }: ConstantsListProps) {
  const edits = useEdits();
  const listId = useId();
  const names = Object.keys(constants);
  const add = () => {
    const suggestion = constantSuggestions(provider).find((name) => !names.includes(name));
    let name = suggestion ?? "source";
    for (let n = 2; names.includes(name); n++) name = `${suggestion ?? "source"}_${n}`;
    edits.apply({ op: "set", path: ["destinations", index, "constants", name], value: "" });
  };
  return (
    <Field label="Fixed values" group hint={`Sent to ${providerName} with every submission, like a lead source or a campaign id.`}>
      {names.length > 0 ? (
        <ul className="kit-constants">
          {names.map((name) => (
            <ConstantRow key={name} index={index} name={name} value={constants[name] ?? ""} names={names} listId={listId} />
          ))}
        </ul>
      ) : null}
      <datalist id={listId}>
        {constantSuggestions(provider).map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <Button size="sm" variant="secondary" icon="plus" onClick={add}>
        Add a fixed value
      </Button>
    </Field>
  );
}
