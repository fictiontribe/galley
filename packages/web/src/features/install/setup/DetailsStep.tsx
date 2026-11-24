/**
 * First run, step 3: everything else on one screen — the publishing name and
 * email (needed), the live address and the assistant's key (both can wait).
 * Whatever whoever runs the server set is shown as set there, not editable.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorShape } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Badge, Button, Field, Input } from "@/ui";
import { detailsProblems, detailsRequest, isFixed } from "../logic";
import { Problem } from "../parts";
import { StepHead, type StepProps } from "./head";

function Part({ title, why, children }: { title: string; why: string; children: ReactNode }) {
  return (
    <section className="setup__part">
      <div>
        <h2 className="setup__part-title">{title}</h2>
        <p className="setup__part-why">{why}</p>
      </div>
      {children}
    </section>
  );
}

function SetOnServer({ value }: { value: ReactNode }) {
  return (
    <div className="setup__readonly">
      <div className="setup__readonly-head">
        <span className="setup__readonly-value">{value}</span>
        <Badge mark={null}>Set on the server</Badge>
      </div>
      <span className="g-hint">Set by whoever runs the server, so it can’t be changed here.</span>
    </div>
  );
}

export function DetailsStep({ status, onStatus, heading }: StepProps) {
  const siteId = status.site.id;
  // The site's own settings may already name its live address: offer it.
  const site = useQuery(siteId ? keys.site(siteId) : ["site", "none"], () => api("GET /api/sites/:siteId", { params: { siteId: siteId ?? "" } }), { enabled: Boolean(siteId) && !status.liveUrl });
  const [name, setName] = useState(status.author?.name ?? "");
  const [email, setEmail] = useState(status.author?.email ?? "");
  const [liveUrl, setLiveUrl] = useState(status.liveUrl ?? "");
  const [liveTouched, setLiveTouched] = useState(false);
  const [key, setKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [problems, setProblems] = useState<ReturnType<typeof detailsProblems>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fixed = status.fixed;

  useEffect(() => {
    const detected = site.data?.model.urls.production;
    if (detected && !liveTouched && !status.liveUrl) setLiveUrl(detected);
  }, [site.data, liveTouched, status.liveUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const form = { name, email, liveUrl };
    const found = detailsProblems(status, form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = detailsRequest(status, form);
      if (Object.keys(body).length > 0) await api("PUT /api/setup/details", { body });
      if (key.trim() && !isFixed(fixed, "assistantKey")) {
        await api("PUT /api/secrets/:name", { params: { name: "anthropic" }, body: { value: key.trim() } });
        setKey("");
      }
      onStatus(await api("POST /api/setup/finish"));
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="wizard-form" onSubmit={(event) => void submit(event)} noValidate>
      <StepHead heading={heading} title="A few details." lede="Only the name and email are needed now. Everything here can be changed later." />

      <Part title="Publishing name" why="Each version published from this editor is recorded with this name and email, in Version history and in the repository.">
        {isFixed(fixed, "author") ? (
          <SetOnServer
            value={
              status.author ? (
                <>
                  {status.author.name} <span className="g-mono">&lt;{status.author.email}&gt;</span>
                </>
              ) : (
                "Not given"
              )
            }
          />
        ) : (
          <div className="app-form-row">
            <Field label="Name" error={problems.name}>
              <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" data-autofocus />
            </Field>
            <Field label="Email" error={problems.email}>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </Field>
          </div>
        )}
      </Part>

      <Part title="Live address" why="Where visitors see the site. Proof shows your changes beside it, so you can compare before publishing.">
        {isFixed(fixed, "liveUrl") ? (
          <SetOnServer value={<span className="g-mono">{status.liveUrl ?? "Not given"}</span>} />
        ) : (
          <Field label="Live address" hideLabel hint="Optional" error={problems.liveUrl}>
            <Input
              type="url"
              mono
              value={liveUrl}
              placeholder="https://www.example.com"
              onChange={(event) => {
                setLiveTouched(true);
                setLiveUrl(event.target.value);
              }}
            />
          </Field>
        )}
      </Part>

      <Part title="Assistant" why="The assistant changes pages when you ask in chat. It works with your own Anthropic API key, stored on the server and never shown again.">
        {isFixed(fixed, "assistantKey") ? (
          <SetOnServer value={status.assistantKey ? "A key is set" : "No key"} />
        ) : status.assistantKey && !replacingKey ? (
          <p className="install-note">
            A key is saved.{" "}
            <button type="button" className="app-link-button" onClick={() => setReplacingKey(true)}>
              Replace it
            </button>
          </p>
        ) : (
          <Field label="Anthropic API key" hint="Optional. You can add it later in App settings">
            <Input type="password" mono autoComplete="off" spellCheck={false} value={key} placeholder="sk-ant-…" onChange={(event) => setKey(event.target.value)} />
          </Field>
        )}
      </Part>

      {problem ? <Problem>{problem}</Problem> : null}
      <div className="wizard-actions">
        <span className="g-toolbar__spacer" />
        <Button type="submit" variant="primary" busy={busy} busyLabel="Finishing…">
          Finish
        </Button>
      </div>
    </form>
  );
}
