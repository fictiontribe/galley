import { useEffect, useMemo, useState } from "react";
import type { JsonValue } from "@galley/core/types";
import type { ScriptEntry, ScriptIntegrationInfo } from "@galley/core/kit";
import { useParams } from "react-router-dom";
import { BUILTIN_PLUGIN, hasSnippet, pluginScriptEntry, useSiteCatalog, type CatalogScript } from "@/features/plugins/catalog";
import { Button, Dialog, Field, Icon, Input, SegmentedControl, Textarea, cx } from "@/ui";
import { Mark } from "@/features/forms/file/Mark";
import { settingProblem } from "@/features/forms/logic/settings";
import { CATEGORY_WORDS, CONSENT_WORDS, LOAD_WORDS, PLACEMENT_WORDS, defaultLoad, markOf, newScript } from "./logic/entries";

export interface AddScriptDialogProps {
  open: boolean;
  onClose: () => void;
  taken: readonly string[];
  allowBuild: boolean;
  onAdd: (entry: ScriptEntry) => void;
}

function matches(integration: ScriptIntegrationInfo, query: string): boolean {
  const text = `${integration.name} ${integration.description} ${CATEGORY_WORDS[integration.category]}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

/** "Add a script": the catalogue by category, then only the settings the chosen one needs. */
export function AddScriptDialog({ open, onClose, taken, allowBuild, onAdd }: AddScriptDialogProps) {
  const [query, setQuery] = useState("");
  // The catalogue of everything active for the site: the built-in kinds and those plugins add.
  const { siteId = "" } = useParams();
  const catalog = useSiteCatalog(siteId);
  const [chosen, setChosen] = useState<ScriptIntegrationInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [customWay, setCustomWay] = useState<"src" | "inline">("src");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setChosen(null);
    setValues({});
    setCustomWay("src");
    setTried(false);
  }, [open]);

  const groups = useMemo(() => {
    const found: CatalogScript[] = catalog.scriptIntegrations.filter((integration) => matches(integration, query));
    const order = Object.keys(CATEGORY_WORDS) as Array<ScriptIntegrationInfo["category"]>;
    return order.map((category) => ({ category, items: found.filter((integration) => integration.category === category) })).filter((group) => group.items.length > 0);
  }, [query, catalog.scriptIntegrations]);

  const custom = chosen?.kind === "custom";
  const specs = (chosen?.settings ?? []).filter((spec) => !custom || spec.key === customWay);
  const problems = Object.fromEntries(
    specs.map((spec) => [spec.key, settingProblem(custom ? { ...spec, required: true } : spec, values[spec.key])] as const).filter(([, problem]) => problem),
  ) as Record<string, string>;
  const ready = chosen !== null && Object.keys(problems).length === 0;

  const add = () => {
    setTried(true);
    if (!chosen || !ready) return;
    const settings: { [key: string]: JsonValue } = {};
    for (const spec of specs) if (values[spec.key]?.trim()) settings[spec.key] = values[spec.key] ?? "";
    const entry = newScript(chosen, settings, taken);
    // A plugin's kind isn't one the site's runtime writes: its filled-in snippet goes in as a custom script.
    onAdd(hasSnippet(chosen) ? pluginScriptEntry(entry, chosen, catalog.nameOf(chosen.plugin)) : entry);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={chosen ? `Add ${chosen.name}` : "Add a script"}
      description={chosen ? chosen.description : "Pick what to add. You’ll only be asked for what it needs."}
      size="lg"
      footer={
        chosen ? (
          <>
            <Button variant="secondary" onClick={() => setChosen(null)}>
              Back to the list
            </Button>
            <Button variant="primary" onClick={add} disabled={tried && !ready}>
              Add {chosen.name}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
        )
      }
    >
      {!chosen ? (
        <div className="kit-catalogue">
          <Input aria-label="Search scripts" placeholder="Search — analytics, chat, ads…" value={query} onChange={(event) => setQuery(event.target.value)} data-autofocus />
          {groups.length === 0 ? <p className="g-hint">Nothing matches “{query}”. Try a shorter word, or add a custom script.</p> : null}
          {groups.map((group) => (
            <section key={group.category} className="kit-catalogue__group" aria-label={CATEGORY_WORDS[group.category]}>
              <p className="g-eyebrow">{CATEGORY_WORDS[group.category]}</p>
              <div className="kit-catalogue__items">
                {group.items.map((integration) => (
                  <button
                    key={integration.kind}
                    type="button"
                    className="kit-catalogue__item"
                    onClick={() => {
                      setChosen(integration);
                      setValues({});
                      setTried(false);
                    }}
                  >
                    <Mark text={markOf(integration.kind)} />
                    <span className="kit-catalogue__text">
                      <span className="kit-catalogue__name">{integration.name}</span>
                      <span className="kit-catalogue__description">{integration.description}</span>
                      {integration.plugin !== BUILTIN_PLUGIN ? <span className="kit-catalogue__description">From the plugin {catalog.nameOf(integration.plugin)}</span> : null}
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="kit-add">
          {custom ? (
            <Field label="How it’s added" group hint={allowBuild ? undefined : "Writing code into the page is only offered on sites where build mode is allowed, because it runs with full access to every page."}>
              <SegmentedControl
                label="How it’s added"
                options={[
                  { value: "src", label: "From an address" },
                  { value: "inline", label: "Code", disabled: !allowBuild },
                ]}
                value={customWay}
                onChange={setCustomWay}
              />
            </Field>
          ) : null}
          {specs.map((spec) => {
            const problem = tried || values[spec.key] ? problems[spec.key] : undefined;
            return (
              <Field key={spec.key} label={spec.label} hint={problem ? undefined : (spec.help ?? (spec.placeholder ? `Looks like ${spec.placeholder}` : undefined))} error={problem}>
                {spec.key === "inline" ? (
                  <Textarea mono rows={6} maxRows={16} spellCheck={false} value={values[spec.key] ?? ""} onChange={(event) => setValues({ ...values, [spec.key]: event.target.value })} />
                ) : (
                  <Input mono spellCheck={false} placeholder={spec.placeholder} value={values[spec.key] ?? ""} onChange={(event) => setValues({ ...values, [spec.key]: event.target.value })} onKeyDown={(event) => event.key === "Enter" && add()} />
                )}
              </Field>
            );
          })}
          <div className={cx("kit-add__defaults")}>
            <p className="g-eyebrow">Already chosen for you</p>
            <ul>
              <li>{LOAD_WORDS[defaultLoad(chosen)].label} — {LOAD_WORDS[defaultLoad(chosen)].line}</li>
              <li>{PLACEMENT_WORDS[chosen.defaultPlacement]}.</li>
              <li>
                Consent: {CONSENT_WORDS[chosen.defaultConsent].label}. {CONSENT_WORDS[chosen.defaultConsent].line}
              </li>
              <li>Every page. You can limit it to some pages once it’s added.</li>
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}
