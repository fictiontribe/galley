import { useId } from "react";
import type { FormDestination, FormField } from "@galley/core/kit";
import { Button, ProofMark } from "@/ui";
import { joinWords } from "@/lib/format";
import { hasUsualNames, mappedName, requiredNames, sendableFields, unmappedRequired, usualMappingChanges, usualName, usualNames } from "../logic/mapping";
import { sentName } from "../logic/names";
import { useEdits } from "../file/hooks";

export interface MappingTableProps {
  index: number;
  destination: FormDestination;
  fields: readonly FormField[];
  providerName: string;
}

/** Your fields on the left, the name each is sent under on the right — pre-filled, with the provider's usual names offered. */
export function MappingTable({ index, destination, fields, providerName }: MappingTableProps) {
  const edits = useEdits();
  const listId = useId();
  const sendable = sendableFields(fields);
  const missing = unmappedRequired(destination, fields);
  const changes = usualMappingChanges(destination, fields);
  const required = new Set(requiredNames(destination.provider));
  const path = (fieldId: string) => ["destinations", index, "mapping", fieldId];

  const setName = (field: FormField, typed: string) => {
    const name = typed.trim();
    edits.type(path(field.id), name && name !== sentName(field) ? name : undefined);
  };

  if (sendable.length === 0) return <p className="g-hint">Add fields to the form to choose what they’re sent as.</p>;
  return (
    <div className="kit-mapping">
      <table className="app-table kit-mapping__table">
        <colgroup>
          <col className="kit-mapping__col" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Your field</th>
            <th scope="col">Name in {providerName}</th>
          </tr>
        </thead>
        <tbody>
          {sendable.map((field) => {
            const name = mappedName(destination, field);
            const usual = usualName(destination.provider, field);
            return (
              <tr key={field.id}>
                <th scope="row">
                  <span className="kit-mapping__label">{field.label?.trim() || field.id}</span>
                  {field.type === "hidden" ? <span className="g-faint"> · hidden</span> : null}
                </th>
                <td>
                  <input
                    className="g-input g-input--sm g-input--mono"
                    aria-label={`Name in ${providerName} for ${field.label?.trim() || field.id}`}
                    list={hasUsualNames(destination.provider) ? listId : undefined}
                    value={name}
                    spellCheck={false}
                    onChange={(event) => setName(field, event.target.value)}
                    onBlur={() => edits.commit(path(field.id))}
                  />
                  {usual && usual !== name ? (
                    <button type="button" className="app-link-button kit-mapping__usual" onClick={() => edits.choose(path(field.id), usual === sentName(field) ? undefined : usual)}>
                      Use {usual}
                    </button>
                  ) : required.has(name) ? (
                    <span className="kit-required">Needed by {providerName}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasUsualNames(destination.provider) ? (
        <datalist id={listId}>
          {usualNames(destination.provider).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}
      {changes.length > 1 ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => edits.apply(...changes.map((change) => {
            const field = sendable.find((candidate) => candidate.id === change.fieldId);
            return change.name === (field ? sentName(field) : "") ? { op: "unset" as const, path: path(change.fieldId) } : { op: "set" as const, path: path(change.fieldId), value: change.name };
          }))}
        >
          Use {providerName}’s usual names for {changes.length} fields
        </Button>
      ) : null}
      {missing.length > 0 ? (
        <p className="g-error-text kit-mapping__missing" role="status">
          <ProofMark kind="bang" />
          <span>
            {providerName} needs {missing.length === 1 ? "a field" : "fields"} sent as {joinWords(missing.map((name) => `“${name}”`))}, and none is. Rename one above, or add it as a fixed value below — otherwise {providerName} turns the submission away.
          </span>
        </p>
      ) : null}
    </div>
  );
}
