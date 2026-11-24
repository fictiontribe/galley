import { Link, useNavigate } from "react-router-dom";
import type { FormListItem } from "@galley/core/api";
import { count, joinWords } from "@/lib/format";
import { Badge, Icon, Menu, type MenuItem } from "@/ui";
import { isLayout } from "../logic/fieldTypes";
import { providerName } from "../logic/providers";
import { Mark, providerMark } from "../file/Mark";
import { useMay } from "@/lib/may";
import { useNameOf } from "@/lib/names";

export interface FormRowProps {
  siteId: string;
  /** The form as the list's one request describes it. */
  item: FormListItem;
  onDuplicate: (item: FormListItem) => void;
  onDelete: (item: FormListItem) => void;
}

function UsedOn({ siteId, pages }: { siteId: string; pages: FormListItem["pages"] }) {
  const name = useNameOf();
  if (pages.length === 0) return <span className="g-faint">Not used on any page yet</span>;
  return (
    <span>
      Used on{" "}
      {pages.slice(0, 3).map((page, index) => (
        <span key={page.path}>
          {index > 0 ? ", " : ""}
          <Link className="g-link" to={`/sites/${siteId}/edit?path=${encodeURIComponent(page.path)}`}>
            {name(page)}
          </Link>
        </span>
      ))}
      {pages.length > 3 ? ` and ${pages.length - 3} more` : ""}
    </span>
  );
}

/** One form in the list: its name, where submissions go, its fields, its status, and where it's used. */
export function FormRow({ siteId, item: summary, onDuplicate, onDelete }: FormRowProps) {
  const navigate = useNavigate();
  const form = summary.definition;
  const formId = summary.id;
  const mayReadInbox = useMay()("GET /api/sites/:siteId/inbox");
  const to = `/sites/${siteId}/forms/${encodeURIComponent(formId)}`;
  const providers = form ? form.destinations.map((destination) => providerName(destination.provider)) : [];
  const fieldCount = form ? form.fields.filter((field) => !isLayout(field)).length : 0;
  const capturing = Boolean(form?.destinations.some((destination) => destination.provider === "galley"));
  const items: MenuItem[] = [
    // What visitors sent is read by people who may publish: only they are offered it.
    ...(capturing && mayReadInbox ? [{ id: "submissions", label: "See submissions", icon: "inbox" as const, onSelect: () => navigate(`/sites/${siteId}/inbox?form=${encodeURIComponent(formId)}`) }, { kind: "separator" as const, id: "sep-inbox" }] : []),
    { id: "duplicate", label: "Duplicate", icon: "copy", onSelect: () => onDuplicate(summary) },
    { kind: "separator", id: "sep" },
    { id: "delete", label: "Delete form…", icon: "trash", tone: "danger", onSelect: () => onDelete(summary) },
  ];
  return (
    <li className="kit-row">
      <div className="kit-row__main">
        <Link to={to} className="kit-row__name">
          {form?.name || summary.title || formId}
        </Link>
        <span className="g-field__key">{formId}</span>
        {summary.status === "added" ? (
          <Badge tone="insert">New</Badge>
        ) : summary.status === "modified" ? (
          <Badge tone="change">Edited</Badge>
        ) : null}
      </div>
      <div className="kit-row__goes">
        {form ? (
          form.destinations.length ? (
            <>
              <span className="kit-row__marks">
                {form.destinations.map((destination, index) => (
                  <Mark key={index} text={providerMark(destination.provider)} size="sm" />
                ))}
              </span>
              <span>{joinWords(providers)}</span>
            </>
          ) : (
            <span className="g-error-text">Goes nowhere yet</span>
          )
        ) : (
          <span className="g-error-text">{summary.problem ?? "This form’s file can’t be read."}</span>
        )}
      </div>
      <span className="kit-row__count">{form ? count(fieldCount, "field") : null}</span>
      <span className="kit-row__used">
        <UsedOn siteId={siteId} pages={summary.pages} />
      </span>
      <Menu
        label={`${form?.name || formId} options`}
        items={items}
        placement="bottom-end"
        trigger={(props) => (
          <button {...props} type="button" className="g-btn g-btn--quiet g-btn--sm g-btn--icon" aria-label={`More for ${form?.name || formId}`}>
            <Icon name="more" />
          </button>
        )}
      />
    </li>
  );
}
