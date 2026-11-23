import { Link, useParams } from "react-router-dom";
import "./forms.css";
import { useTopBar } from "@/app/chrome";
import { useSite } from "@/lib/stores/site";
import { EmptyState, ErrorState, PageHeader, Skeleton, buttonClass } from "@/ui";
import { isApiFailure } from "@/lib/api";
import { formPath, formsCollection } from "./logic/locate";
import { useKitEntry } from "./file/KitFile";
import { AssistantPanel } from "./file/AssistantPanel";
import { SetupState } from "./file/SetupState";
import { FormBuilder } from "./editor/FormBuilder";
import { FormList } from "./list/FormList";

function Loading() {
  return (
    <div className="app-screen" aria-busy="true">
      <div className="app-screen__inner">
        <Skeleton width={120} height={12} />
        <Skeleton width={240} height={28} style={{ marginBlock: "var(--space-3) var(--space-6)" }} />
        <Skeleton lines={4} height={14} />
      </div>
    </div>
  );
}

function NoForms({ siteId }: { siteId: string }) {
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  useTopBar({ crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Forms" }] });
  return (
    <div className="kit-screen">
      <div className="app-screen">
        <div className="app-screen__inner">
          <PageHeader eyebrow="Site" title="Forms" />
          <SetupState feature="forms" />
        </div>
      </div>
      <AssistantPanel siteId={siteId} />
    </div>
  );
}

function FormCrumbs({ siteId, formId }: { siteId: string; formId: string }) {
  const siteName = useSite((s) => s.detail?.name ?? "Site");
  useTopBar({ crumbs: [{ label: siteName, to: `/sites/${siteId}` }, { label: "Forms", to: `/sites/${siteId}/forms` }, { label: formId }] });
  return null;
}

function OneForm({ siteId, path, formId }: { siteId: string; path: string; formId: string }) {
  const entry = useKitEntry(siteId, path);
  const missing = entry.status === "error" && isApiFailure(entry.error) && entry.error.status === 404;
  if (entry.loading) {
    return (
      <>
        <FormCrumbs siteId={siteId} formId={formId} />
        <Loading />
      </>
    );
  }
  if (missing) {
    return (
      <div className="app-screen app-screen--center">
        <FormCrumbs siteId={siteId} formId={formId} />
        <EmptyState
          title="There’s no form with this id."
          body={`No file for “${formId}” is in the site’s forms. It may have been renamed or deleted.`}
          mark="dele"
          actions={
            <Link className={buttonClass("primary")} to={`/sites/${siteId}/forms`}>
              All forms
            </Link>
          }
        />
      </div>
    );
  }
  if (!entry.data) {
    return (
      <div className="app-screen app-screen--center">
        <FormCrumbs siteId={siteId} formId={formId} />
        <ErrorState title="Couldn’t open this form" error={entry.error} onRetry={() => void entry.refetch()} />
      </div>
    );
  }
  return <FormBuilder key={path} siteId={siteId} entry={entry.data} />;
}

/** /sites/:siteId/forms and /sites/:siteId/forms/:formId — the forms list and the form builder. */
export function FormsScreen() {
  const { siteId = "", formId } = useParams();
  const detail = useSite((s) => s.detail);
  if (!detail || detail.id !== siteId) return <Loading />;
  const collection = formsCollection(detail.model);
  if (!collection) return <NoForms siteId={siteId} />;
  if (formId) return <OneForm siteId={siteId} path={formPath(collection, formId)} formId={formId} />;
  return <FormList siteId={siteId} collection={collection} />;
}
