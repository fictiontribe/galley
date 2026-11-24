import { useState } from "react";
import { useTour } from "../tour/store";
import { startOver } from "./startOver";

/**
 * The quiet, persistent mark: this is a demo on a sample site and nothing is
 * kept. Start over resets everything (after asking once); Leave the demo goes
 * back to the marketing site. "Tour" brings the walkthrough back when the
 * visitor has wandered off or closed it.
 */
export function DemoBand() {
  const [confirming, setConfirming] = useState(false);
  const tourOpen = useTour((s) => s.open);
  const resume = useTour((s) => s.resume);
  return (
    <div className="demo-band" role="region" aria-label="About this demo">
      <p className="demo-band__what">
        <span className="demo-band__mark">Demo</span>
        <span>Sample site, nothing is saved</span>
      </p>
      <div className="demo-band__actions">
        {!tourOpen ? (
          <button type="button" className="g-btn g-btn--quiet g-btn--sm demo-band__tour" onClick={resume}>
            Tour
          </button>
        ) : null}
        {confirming ? (
          <span className="demo-band__confirm" role="group" aria-label="Start over?">
            <span>Forget every change and start again?</span>
            <button type="button" className="g-btn g-btn--quiet g-btn--sm" onClick={() => setConfirming(false)}>
              Keep going
            </button>
            <button type="button" className="g-btn g-btn--secondary g-btn--sm" onClick={() => startOver()}>
              Start over
            </button>
          </span>
        ) : (
          <button type="button" className="g-btn g-btn--quiet g-btn--sm" onClick={() => setConfirming(true)}>
            Start over
          </button>
        )}
        <a className="g-btn g-btn--quiet g-btn--sm" href="/">
          Leave the demo
        </a>
      </div>
    </div>
  );
}
