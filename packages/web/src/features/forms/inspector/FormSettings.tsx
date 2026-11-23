import { useFormValue } from "@/features/content/form/context";
import { BoundChoice, BoundNumber, BoundText, BoundToggle } from "../file/Bound";
import { stepTitles } from "../logic/fieldOps";
import { useFormDoc } from "../file/hooks";
import { useChangeMarks } from "../file/KitFile";
import { AREA_MARKS } from "../logic/marks";
import { cx } from "@/ui";

/** The form's own settings, shown when no field is selected. */
export function FormSettings() {
  const form = useFormDoc();
  const titles = stepTitles(form);
  const marks = useChangeMarks();
  const honeypot = useFormValue(["spam", "honeypot"]);
  return (
    <div className={cx("kit-insp", marks.has(AREA_MARKS.settings) && "kit-insp--flash")} role="region" aria-label="Form settings">
      <div className="kit-insp__head">
        <div className="kit-insp__titles">
          <span className="g-eyebrow">Form</span>
          <span className="kit-insp__title">{form.name || "Untitled form"}</span>
        </div>
      </div>
      <BoundText path={["name"]} label="Name" keep hint="Shown in this app, and to screen readers as the form’s name." />
      <BoundText path={["description"]} label="Description" placeholder="What it’s for, for your colleagues" multiline />
      <BoundText path={["submitLabel"]} label="Button" keep placeholder="Send" hint="Say what happens: “Request a demo”, “Sign up”." />
      {titles.length > 1
        ? titles.slice(0, -1).map((title, step) => <BoundText key={step} path={["steps", step, "nextLabel"]} label={`Button on ${title}`} placeholder="Next" />)
        : null}
      <BoundText path={["errorMessage"]} label="If it can’t be sent" placeholder="That didn’t go through. Check your connection and try again." multiline hint="Shown when the submission doesn’t reach the main destination." />

      <details className="app-details kit-insp__more" open>
        <summary>Appearance</summary>
        <div className="kit-insp__group">
          <BoundChoice
            path={["appearance", "labels"]}
            label="Labels"
            absent="above"
            options={[
              { value: "above", label: "Above" },
              { value: "floating", label: "Inside" },
              { value: "hidden", label: "Hidden" },
            ]}
            hint="Hidden labels are still read out to screen readers."
          />
          <BoundChoice
            path={["appearance", "size"]}
            label="Size"
            absent="regular"
            options={[
              { value: "regular", label: "Regular" },
              { value: "compact", label: "Compact" },
            ]}
          />
          <BoundChoice
            path={["appearance", "layout"]}
            label="Layout"
            absent="stacked"
            options={[
              { value: "stacked", label: "Stacked" },
              { value: "inline", label: "In a row" },
            ]}
            hint="In a row suits a one-field sign-up."
          />
        </div>
      </details>

      <details className="app-details kit-insp__more" open>
        <summary>Spam protection</summary>
        <div className="kit-insp__group">
          <BoundToggle
            path={["spam", "honeypot"]}
            absent
            label="Hidden trap field"
            description={honeypot === false ? "Off. Bots that fill in every field won’t be caught." : "On. A field only bots can see; submissions that fill it in are set aside."}
          />
          <BoundNumber path={["spam", "minSeconds"]} label="Refuse submissions faster than (seconds)" placeholder="3" min={0} hint="People take a few seconds; bots don’t. Leave empty to allow any speed." />
          <BoundText path={["spam", "turnstileSiteKey"]} label="Cloudflare Turnstile site key" mono placeholder="0x4AAAAAAA…" hint="Adds an invisible check. The destination must verify it." />
        </div>
      </details>
    </div>
  );
}
