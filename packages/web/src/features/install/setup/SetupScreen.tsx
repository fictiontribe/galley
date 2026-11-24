/**
 * /setup — a hosted install's first run, one question per screen: choose the
 * password, connect the site, a few details, done. Public, like /login: it
 * runs on the one-time setup code from the setup link until the password
 * step signs this browser in. Always resumes from where the server says first
 * run is (GET /api/setup), so a reload anywhere picks up the same screen.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { MIN_INSTALL_PASSWORD_LENGTH, type SetupStatus } from "@galley/core/install/types";
import { api, errorShape, getSetupCode, isApiFailure, setSetupCode } from "@/lib/api";
import { hostedInstall } from "@/lib/hosted";
import { useMeta } from "@/lib/stores/meta";
import { useSites } from "@/lib/stores/sites";
import { Button, ErrorState, Field, Input, Logo, Skeleton, buttonClass } from "@/ui";
import { SETUP_STEPS, passwordProblem, setupBlock, type SetupBlock, type SetupStepId } from "../logic";
import { Problem, RestoreFlow } from "../parts";
import { DetailsStep } from "./DetailsStep";
import { StepHead, type StepProps } from "./head";
import { SiteStep } from "./SiteStep";
import "@/features/wizard/wizard.css";
import "../install.css";

function StepList({ current }: { current: SetupStepId }) {
  const index = SETUP_STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="wizard-steps" aria-label="Steps">
      {SETUP_STEPS.map((step, at) => (
        <li key={step.id} className={at === index ? "wizard-step wizard-step--current" : at < index ? "wizard-step wizard-step--done" : "wizard-step"} aria-current={at === index ? "step" : undefined}>
          <span className="wizard-step__number">{at + 1}</span>
          <span className="wizard-step__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Typed twice rather than shown with a toggle: a mistyped password locks the
 * owner out of an editor whose only way back is on the server, and typing it
 * twice catches that without putting the password on screen. A password
 * manager fills both (autocomplete="new-password").
 */
function PasswordStep({ onStatus, heading, onRestore, onBlocked }: StepProps & { onRestore: () => void; onBlocked: (block: SetupBlock) => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const issue = passwordProblem(password, again);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await api("POST /api/setup/password", { body: { password } });
      // Signed in now: the code is used up, and the session carries first run from here.
      setSetupCode(null);
      setPassword("");
      setAgain("");
      await useMeta.getState().load();
      onStatus(next);
    } catch (caught) {
      const block = isApiFailure(caught) ? setupBlock(caught.status, true) : null;
      if (block) onBlocked(block);
      else setProblem(errorShape(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="wizard-form" onSubmit={(event) => void submit(event)} noValidate>
      <StepHead
        heading={heading}
        title="Choose the password."
        lede={`Anyone with it can edit the site and publish it, so make it long: at least ${MIN_INSTALL_PASSWORD_LENGTH} characters. A password manager can make one for you.`}
      />
      <Field label="Password">
        <Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} data-autofocus />
      </Field>
      <Field label="The same password again">
        <Input type="password" autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />
      </Field>
      {problem ? <Problem>{problem}</Problem> : null}
      <div className="wizard-actions">
        <Button type="button" variant="quiet" size="sm" onClick={onRestore}>
          Restore from a backup instead
        </Button>
        <span className="g-toolbar__spacer" />
        <Button type="submit" variant="primary" busy={busy} busyLabel="Saving…">
          Choose password
        </Button>
      </div>
    </form>
  );
}

function RestoreStep({ heading, onBack }: { heading: RefObject<HTMLHeadingElement | null>; onBack: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div className="wizard-form">
      <StepHead
        heading={heading}
        title="Restore from a backup."
        lede="Start this editor from a backup file instead: the site, its unpublished changes, its settings and the keys stored with it all come back, along with that editor’s password."
      />
      <RestoreFlow
        onBusy={setBusy}
        onDone={() => {
          setSetupCode(null);
          void useMeta.getState().load().then(() => navigate("/login", { replace: true }));
        }}
      />
      <div className="wizard-actions">
        <Button type="button" variant="quiet" onClick={onBack} disabled={busy}>
          Choose a password instead
        </Button>
      </div>
    </div>
  );
}

function DoneStep({ status, heading }: Pick<StepProps, "status" | "heading">) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const siteId = status.site.id;
  return (
    <div className="wizard-form">
      <StepHead
        heading={heading}
        title="The editor is ready."
        lede={`${status.site.name ?? "The site"} is connected. From now on, sign in with the password you chose.`}
      />
      <div className="wizard-actions">
        <span className="g-toolbar__spacer" />
        <Button
          variant="primary"
          busy={busy}
          busyLabel="Opening…"
          data-autofocus
          onClick={() => {
            setBusy(true);
            void Promise.all([useMeta.getState().load(), useSites.getState().load()]).then(() => navigate(siteId ? `/sites/${encodeURIComponent(siteId)}` : "/", { replace: true }));
          }}
        >
          Open the site
        </Button>
      </div>
    </div>
  );
}

function Blocked({ block, heading }: { block: SetupBlock; heading: RefObject<HTMLHeadingElement | null> }) {
  if (block === "no-link") {
    return (
      <div className="wizard-form">
        <StepHead
          heading={heading}
          title="Open the setup link to begin."
          lede="For safety, this editor is set up only from the link it printed when it started — whoever runs the server finds it in the editor’s log. Open that link in this browser. If the password has been chosen already, sign in to carry on."
        />
        <div className="wizard-actions">
          <span className="g-toolbar__spacer" />
          <Link className={buttonClass("secondary", "md")} to="/login">
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="wizard-form">
      <StepHead
        heading={heading}
        title="This setup link can’t be used."
        lede="It has been used already, or it isn’t this editor’s. If the password has been chosen, sign in with it. Otherwise whoever runs the server can make a new setup link there."
      />
      <div className="wizard-actions">
        <span className="g-toolbar__spacer" />
        <Link className={buttonClass("primary", "md")} to="/login">
          Sign in
        </Link>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const meta = useMeta((s) => s.meta);
  const install = hostedInstall(meta);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [block, setBlock] = useState<SetupBlock | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [restoring, setRestoring] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // Opened when first run was already over: nothing to do here.
  const [finishedBefore] = useState(() => Boolean(install && !install.setupNeeded));

  const load = useCallback(async () => {
    setFailure(null);
    const hadCode = getSetupCode() !== null;
    // Without the link and without a session, the server can only refuse: say so without asking it.
    if (!hadCode && !useMeta.getState().meta?.authenticated) {
      setBlock("no-link");
      return;
    }
    try {
      setStatus(await api("GET /api/setup"));
      setBlock(null);
    } catch (caught) {
      const refused = isApiFailure(caught) ? setupBlock(caught.status, hadCode) : null;
      if (refused) setBlock(refused);
      else setFailure(caught);
    }
  }, []);

  useEffect(() => {
    if (!finishedBefore) void load();
  }, [finishedBefore, load]);

  useEffect(() => {
    document.title = meta ? `Set up · ${meta.brand.productName}` : "";
  }, [meta]);

  const screen = block ? `block-${block}` : restoring ? "restore" : (status?.step ?? "loading");
  // Each screen announces itself and takes focus at its heading, for keyboard and screen-reader users.
  useEffect(() => {
    heading.current?.focus();
  }, [screen]);

  if (!meta || !install) return null;
  if (finishedBefore) return <Navigate to="/" replace />;

  let body: ReactNode;
  if (block) body = <Blocked block={block} heading={heading} />;
  else if (failure) body = <ErrorState title="Couldn’t load first run" error={failure} onRetry={() => void load()} />;
  else if (!status) {
    body = (
      <div className="wizard-form" aria-busy="true">
        <Skeleton width={260} height={28} />
        <Skeleton lines={3} height={14} />
      </div>
    );
  } else if (restoring && status.step === "password") body = <RestoreStep heading={heading} onBack={() => setRestoring(false)} />;
  else if (status.step === "password") body = <PasswordStep status={status} onStatus={setStatus} heading={heading} onRestore={() => setRestoring(true)} onBlocked={setBlock} />;
  else if (status.step === "site") body = <SiteStep status={status} onStatus={setStatus} heading={heading} />;
  else if (status.step === "details") body = <DetailsStep status={status} onStatus={setStatus} heading={heading} />;
  else body = <DoneStep status={status} heading={heading} />;

  const step = status && !block && !restoring && status.step !== "done" ? status.step : null;
  return (
    <div className="setup">
      <div className="setup__brand">
        <Logo />
        <span className="g-brand__name">{meta.brand.productName}</span>
      </div>
      <div className="wizard-sheet">
        {step ? <StepList current={step} /> : null}
        {body}
      </div>
    </div>
  );
}
