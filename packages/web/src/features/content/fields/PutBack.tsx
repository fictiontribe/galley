import type { FieldPath, JsonValue } from "@galley/core/types";
import { notify } from "@/lib/stores/toasts";
import { Button } from "@/ui";
import { readChange, useChangeKind, useForm } from "../form/context";
import { putBackOp } from "../form/marks";
import { getAt, hasAt } from "../form/paths";

/** "Put back": restore one field to its live-site value, with Undo in a toast. */
export function PutBack({ path, label }: { path: FieldPath; label: string }) {
  const { store, entryPath } = useForm();
  const kind = useChangeKind(path);
  const change = kind ? readChange(entryPath, path) : undefined;
  const op = change ? putBackOp(change) : null;
  if (!op) return null;

  const run = () => {
    const fresh = readChange(entryPath, path);
    const next = fresh ? putBackOp(fresh) : null;
    if (!next) return;
    const data = store.getState().data;
    const had = hasAt(data, path);
    const current: JsonValue | undefined = getAt(data, path);
    store.actions.apply(next);
    notify({
      tone: "neutral",
      title: `${label} put back`,
      body: "It matches the live site again.",
      action: {
        label: "Undo",
        onClick: () => store.actions.apply(had && current !== undefined ? { op: "set", path, value: current } : { op: "unset", path }),
      },
      duration: 8000,
    });
  };

  return (
    <Button size="sm" variant="quiet" className="app-putback" onClick={run} title="Restore the live site’s version of this field">
      Put back
    </Button>
  );
}
