/**
 * The walkthrough: a small card beside the real control, with a light
 * spotlight on it, that moves on when the visitor does what it asks
 * (steps.ts). It never blocks the app — the spotlight lets every click
 * through — and never takes focus from what the visitor is doing: the card
 * is announced, takes focus only when it opens, and Escape inside it leaves
 * the tour. The band's "Tour" button brings it back.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { MockServer } from "../../mock/server.ts";
import { SUGGESTED_REQUEST } from "../assistant";
import { useFacts } from "./facts";
import { TOTAL_STEPS, copyOf, isThere, next, placeFor, settle, skipEmpty, start, type StepId } from "./steps";
import { useTour } from "./store";
import { openDialog, targetFor } from "./targets";
import { placeCard, type Rect } from "./place";

const CARD_WIDTH = 340;

function rectOf(element: HTMLElement | null): Rect | null {
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

const sameRect = (a: Rect | null, b: Rect | null) => (a === null || b === null ? a === b : Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) < 1);

/** Put the suggested request in the chat box and send it, as the visitor would. */
function askSuggested(): boolean {
  const box = document.querySelector<HTMLTextAreaElement>(".chat-composer textarea, .g-composer textarea");
  if (!box) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(box, SUGGESTED_REQUEST);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  // React applies the new value before the next frame; then Send is enabled.
  requestAnimationFrame(() => {
    const send = [...(box.closest(".g-composer")?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((button) => /send/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""));
    if (send && !send.disabled) send.click();
    else box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  });
  return true;
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="demo-tour__command">
      <code>{command}</code>
      <button
        type="button"
        className="g-btn g-btn--quiet g-btn--sm"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        aria-label={`Copy ${command}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Tour({ server, siteId, sampleVersions }: { server: MockServer; siteId: string; sampleVersions: number }) {
  const open = useTour((s) => s.open);
  const state = useTour((s) => s.state);
  const setState = useTour((s) => s.setState);
  const close = useTour((s) => s.close);
  const restart = useTour((s) => s.restart);
  const facts = useFacts(server, siteId, sampleVersions);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [target, setTarget] = useState<Rect | null>(null);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [dialogUp, setDialogUp] = useState(false);
  const spot = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const [askFailed, setAskFailed] = useState(false);

  // First visit (or after Restart): begin at the welcome.
  useEffect(() => {
    if (!state) setState(start(facts));
  }, [state, facts, setState]);

  // Move on when the visitor has done what the step asks.
  useEffect(() => {
    if (!state) return;
    const settled = skipEmpty(settle(state, facts), facts);
    if (settled.step !== state.step) setState(settled);
  }, [state, facts, setState]);

  const step: StepId = state?.step ?? "welcome";
  const copy = copyOf(step);

  // Say each new step out loud; take focus only when the card first appears.
  useEffect(() => {
    if (open) setAnnouncement(`Tour, step ${copy.number} of ${TOTAL_STEPS}: ${copy.title} ${copy.body}`);
  }, [open, copy.number, copy.title, copy.body]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    wasOpen.current = open;
  }, [open]);
  useEffect(() => setAskFailed(false), [step]);

  // Follow the control as the app lays itself out.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const found = targetFor(step);
      const next = rectOf(found.element);
      setTarget((current) => (sameRect(current, next) ? current : next));
      setHint(found.hint);
      setDialogUp(openDialog() !== null);
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [open, step]);

  // The app's dialogs are modal, in the browser's top layer: the card and the spotlight go up there too,
  // above the newest one, so they stay readable over it (the dialog keeps the focus and the clicks).
  useEffect(() => {
    if (!open) return;
    const raise = () => {
      for (const element of [spot.current, card.current]) {
        if (!element?.isConnected || typeof element.showPopover !== "function") continue;
        if (element.matches(":popover-open")) element.hidePopover();
        element.showPopover();
      }
    };
    raise();
    const watch = new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof HTMLDialogElement)) raise();
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    return () => watch.disconnect();
  }, [open, step]);

  if (!open || !state) return <div className="g-sr" role="status" aria-live="polite" />;

  const there = isThere(step, facts);
  const place = placeFor(step, siteId);
  const go = () => {
    if (place) window.location.hash = `#${place}`;
  };
  const advance = () => setState(skipEmpty(next(state, facts), facts));
  const position = placeCard(target, { width: window.innerWidth, height: window.innerHeight }, CARD_WIDTH, card.current?.offsetHeight ?? 220);
  const spotlight: CSSProperties | null = target && there ? { left: target.x - 6, top: target.y - 6, width: target.width + 12, height: target.height + 12 } : null;

  return (
    <>
      <div ref={spot} popover="manual" className={`demo-spotlight${dialogUp ? " demo-spotlight--ring" : ""}`} style={spotlight ?? { display: "none" }} aria-hidden="true" />
      <div
        ref={card}
        popover="manual"
        className="demo-tour"
        role="dialog"
        aria-modal="false"
        aria-labelledby="demo-tour-title"
        aria-describedby="demo-tour-body"
        style={{ left: position.x, top: position.y, width: CARD_WIDTH }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
      >
        <div className="demo-tour__head">
          <p className="demo-tour__count">
            {copy.number} of {TOTAL_STEPS}
          </p>
          <button type="button" className="g-btn g-btn--quiet g-btn--sm demo-tour__close" onClick={close} aria-label="Leave the tour">
            ×
          </button>
        </div>
        <h2 id="demo-tour-title" className="demo-tour__title" ref={heading} tabIndex={-1}>
          {copy.title}
        </h2>
        <p id="demo-tour-body" className="demo-tour__body">
          {copy.body}
        </p>

        {step === "assistant" ? (
          <div className="demo-tour__ask">
            <p className="demo-tour__label">Recorded answer</p>
            <p className="demo-tour__request">“{SUGGESTED_REQUEST}”</p>
            {there ? (
              <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={() => setAskFailed(!askSuggested())}>
                Ask this
              </button>
            ) : null}
            {askFailed ? <p className="demo-tour__hint">Open the assistant on the right, then try again.</p> : null}
          </div>
        ) : null}

        {step === "done" ? (
          <div className="demo-tour__done">
            <p className="demo-tour__label">Run it on your own site</p>
            <CopyCommand command="npm create galley@latest" />
            <CopyCommand command="npx galley-cms" />
            <p className="demo-tour__links">
              <a href="/apps/">The apps</a>
              <a href="/tour/">The tour</a>
              <a href="/docs/">The docs</a>
            </p>
          </div>
        ) : null}

        {there && step !== "assistant" && (hint ?? copy.doing) ? <p className="demo-tour__hint">{hint ?? copy.doing}</p> : null}

        <div className="demo-tour__actions">
          {step === "welcome" ? (
            <>
              <button type="button" className="g-btn g-btn--quiet g-btn--sm" onClick={close}>
                Explore on my own
              </button>
              <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={() => {
                  advance();
                  window.location.hash = `#${placeFor("form", siteId) ?? ""}`;
                }}
              >
                Start the tour
              </button>
            </>
          ) : step === "done" ? (
            <>
              <button type="button" className="g-btn g-btn--quiet g-btn--sm" onClick={restart}>
                Start the tour again
              </button>
              <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={close}>
                Explore the rest
              </button>
            </>
          ) : (
            <>
              <button type="button" className="g-btn g-btn--quiet g-btn--sm" onClick={advance}>
                Skip this step
              </button>
              {!there && place ? (
                <button type="button" className="g-btn g-btn--primary g-btn--sm" onClick={go}>
                  Take me there
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="g-sr" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}
