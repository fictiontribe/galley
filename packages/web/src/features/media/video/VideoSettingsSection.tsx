import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Field, ProofMark, Select, Skeleton } from "@/ui";
import { modelFacts } from "./cost";
import { preferredProvider, useVideoPrefs } from "./prefs";

/**
 * App settings › Videos: which service makes videos when more than one is
 * set up, and its model — kept with the app's other settings (prefs.ts).
 * With no plugin that makes videos, it says how to get one.
 */
export function VideoSettingsSection() {
  const providers = useQuery(keys.videoProviders(), () => api("GET /api/videos/providers"));
  const prefs = useVideoPrefs();
  const list = providers.data?.providers ?? [];
  const provider = preferredProvider(list, prefs.provider);
  const model = provider?.models.find((item) => item.id === (prefs.provider === provider.id ? prefs.model : null)) ?? provider?.models.find((item) => item.id === provider.defaultModel);

  return (
    <section className="app-settings__section" id="videos" aria-labelledby="videos-title">
      <header className="app-settings__section-head">
        <h2 className="app-settings__section-title" id="videos-title">
          Videos
        </h2>
        <p className="app-settings__section-text">Make short videos from a description in Media. A plugin makes them and its service charges for each one; the dialog shows the cost before anything starts.</p>
      </header>
      <div className="app-settings__section-body">
        {providers.loading ? <Skeleton height={60} /> : null}
        {!providers.loading && list.length === 0 ? (
          <p className="app-images-note">
            <ProofMark kind="stet" className="g-faint" />
            <span>
              {providers.status === "error" ? "Couldn’t read the video services just now." : "No plugin that makes videos is on."} OpenRouter comes with the app: turn it on and add its key in{" "}
              <Link className="g-link" to="/plugins">
                Plugins
              </Link>
              .
            </span>
          </p>
        ) : null}
        <div className="app-form-row">
          {list.length > 1 ? (
            <Field label="Service">
              <Select
                value={provider?.id ?? ""}
                onChange={(id) => prefs.choose(id, list.find((item) => item.id === id)?.defaultModel ?? null)}
                options={list.map((item) => ({ value: item.id, label: item.configured ? item.label : `${item.label} (no key)` }))}
              />
            </Field>
          ) : null}
          {provider ? (
            <Field label={list.length > 1 ? "Model" : `${provider.label} model`} hint={model ? modelFacts(model) : undefined}>
              <Select value={model?.id ?? ""} onChange={(id) => prefs.choose(provider.id, id)} options={provider.models.map((item) => ({ value: item.id, label: item.price ? `${item.label} — ${item.price}` : item.label }))} />
            </Field>
          ) : null}
        </div>
        {provider && !provider.configured ? (
          <p className="app-images-note">
            <ProofMark kind="stet" className="g-faint" />
            <span>
              {provider.label} needs its API key before it can make videos.{" "}
              <Link className="g-link" to="/plugins">
                Add it in Plugins
              </Link>
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
