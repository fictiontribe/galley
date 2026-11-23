import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { keys } from "@/lib/sync";
import { Select, Skeleton } from "@/ui";
import { useForm } from "../form/context";
import { asText, useBinding } from "./binding";
import { type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";

const LIMIT = 500;

/** `reference`: one entry of another collection, stored by its address (slug). */
export function ReferenceField({ field, path, showKey }: FieldProps) {
  const { siteId } = useForm();
  const { value, change, focus } = useBinding(field, path, true);
  const target = useSite((s) => s.detail?.model.collections.find((collection) => collection.id === field.collection));
  const targetId = field.collection ?? "";
  const entries = useQuery([...keys.entries(siteId, targetId), "picker"], () => api("GET /api/sites/:siteId/entries", { params: { siteId }, query: { collection: targetId, sort: "title", limit: LIMIT } }), {
    enabled: Boolean(targetId),
  });
  const current = asText(value);
  const options = (entries.data?.items ?? []).map((item) => ({ value: item.slug, label: item.title }));
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: `${current} (not found)` });

  return (
    <FieldShell field={field} path={path} showKey={showKey} note={target ? `From ${target.label}.` : undefined}>
      {entries.loading ? (
        <Skeleton height={32} />
      ) : (
        <Select value={current} options={options} placeholder="Choose…" onChange={(next) => change(next === "" ? undefined : next)} onFocus={focus} />
      )}
    </FieldShell>
  );
}
