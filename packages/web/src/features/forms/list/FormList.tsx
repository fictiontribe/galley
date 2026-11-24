import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormListItem } from "@galley/core/api";
import type { Collection } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { api, errorShape } from "@/lib/api";
import { invalidate, useQuery } from "@/lib/query";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton } from "@/ui";
import { readForm, toJson, type JsonObject } from "../logic/json";
import { formIdOf } from "../logic/locate";
import { AiReadableOffer } from "../file/AiReadable";
import { InboxAddressStep } from "../file/InboxAddress";
import { FormRow } from "./FormRow";
import { NewFormDialog } from "./NewFormDialog";
import { useWhoPublishes } from "@/lib/may";

/** Every form on the site, with "New form", duplicate and delete. */
export function FormList({ siteId, collection }: { siteId: string; collection: Collection }) {
  const navigate = useNavigate();
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  const publishes = useWhoPublishes();
  useTopBar({ crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Forms" }] });
  // One request for the whole list: every row's form, status and pages (it used to be two per form).
  // Under the entries key, so any change on the site refreshes it.
  const list = useQuery([...keys.entries(siteId, collection.id), "forms"], () => api("GET /api/sites/:siteId/forms", { params: { siteId } }));
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FormListItem | null>(null);
  const items = list.data?.forms ?? [];
  const taken = items.map((item) => formIdOf(item.path));

  const duplicate = async (summary: FormListItem) => {
    try {
      const source = await api("GET /api/sites/:siteId/entry", { params: { siteId }, query: { path: summary.path } });
      const base = `${formIdOf(summary.path)}-copy`;
      let slug = base;
      for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
      const form = readForm(source.data);
      const data = toJson({ ...source.data, name: `${form.name || formIdOf(summary.path)} (copy)` }) as JsonObject;
      await api("POST /api/sites/:siteId/entries", { params: { siteId }, body: { collection: collection.id, slug, data } });
      invalidate(keys.entries(siteId, collection.id));
      notify({ tone: "neutral", title: "Form duplicated", body: `The copy is “${slug}”. It isn’t on any page yet.`, action: { label: "Open it", onClick: () => navigate(`/sites/${siteId}/forms/${slug}`) } });
    } catch (error) {
      notify({ tone: "danger", title: "Couldn’t duplicate the form", body: errorShape(error).message });
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const target = deleting;
    await api("DELETE /api/sites/:siteId/entry", { params: { siteId }, query: { path: target.path } });
    invalidate(keys.entries(siteId, collection.id));
    if (target.status === "added") {
      notify({ tone: "neutral", title: `${target.title} deleted` });
      return;
    }
    notify({
      tone: "neutral",
      title: `${target.title} deleted`,
      body: `It leaves the site when ${publishes}. Until then, Undo brings it back.`,
      action: {
        label: "Undo",
        onClick: () =>
          void useChanges
            .getState()
            .discard([target.path])
            .then(() => invalidate(keys.entries(siteId, collection.id)))
            .catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t bring it back", body: errorShape(error).message })),
      },
    });
  };

  let body;
  if (list.loading) {
    body = (
      <ul className="kit-rows" aria-busy="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className="kit-row">
            <Skeleton width={`${50 - index * 8}%`} height={14} />
          </li>
        ))}
      </ul>
    );
  } else if (list.status === "error" && !list.data) {
    body = <ErrorState title="Couldn’t load the forms" error={list.error} onRetry={() => void list.refetch()} />;
  } else if (items.length === 0) {
    body = (
      <div className="app-card">
        <EmptyState
          title="No forms yet."
          body="Forms you build here can go on any page that has a form section, and send to your inbox or your CRM."
          actions={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New form
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <ul className="kit-rows" aria-label="Forms">
        <li className="kit-row kit-row--head" aria-hidden="true">
          <span>Form</span>
          <span>Where submissions go</span>
          <span>Fields</span>
          <span>Pages</span>
          <span />
        </li>
        {items.map((summary) => (
          <FormRow key={summary.path} siteId={siteId} item={summary} onDuplicate={(item) => void duplicate(item)} onDelete={setDeleting} />
        ))}
      </ul>
    );
  }

  return (
    <div className="app-screen">
      <div className="app-screen__inner">
        <PageHeader
          title="Forms"
          description={`Each form is a file in the site, so every change shows in Proof and goes live when ${publishes}.`}
          actions={
            items.length > 0 ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New form
              </Button>
            ) : null
          }
        />
        <InboxAddressStep />
        {body}
        <AiReadableOffer />
      </div>
      <NewFormDialog siteId={siteId} collection={collection} open={creating} onClose={() => setCreating(false)} taken={taken} onCreated={(id) => navigate(`/sites/${siteId}/forms/${encodeURIComponent(id)}`)} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.title ?? "this form"}?`}
        body={
          deleting?.status === "added"
            ? "This form hasn’t been published, so deleting it can’t be undone. Pages that show it will show nothing in its place."
            : `It stays on the live site until ${publishes}, and you can bring it back until then. Pages that show it will show nothing in its place.`
        }
        confirmLabel="Delete form"
        onConfirm={remove}
      />
    </div>
  );
}
