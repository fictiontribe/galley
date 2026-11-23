import { useState } from "react";
import type { FieldPath, JsonValue } from "@galley/core/types";
import type { FormProviderInfo } from "@galley/core/kit";
import { settingText } from "../logic/json";
import { settingProblem } from "../logic/settings";
import { BoundText } from "../file/Bound";

export interface ProviderSettingsProps {
  /** Where the settings object lives (`destinations.0.settings`, `scripts.2.settings`). */
  path: FieldPath;
  specs: FormProviderInfo["settings"];
  values: { [key: string]: JsonValue };
}

/** A provider's or integration's settings, drawn from the catalogue: labels, examples, required marks, checked as they're filled in. */
export function ProviderSettings({ path, specs, values }: ProviderSettingsProps) {
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <div className="kit-settings" onBlur={(event) => {
      const key = (event.target as HTMLElement).closest<HTMLElement>("[data-setting]")?.dataset.setting;
      if (key && !touched.has(key)) setTouched(new Set(touched).add(key));
    }}>
      {specs.map((spec) => {
        const value = values[spec.key];
        const shown = touched.has(spec.key) || settingText(value).trim() !== "";
        const problem = shown ? settingProblem(spec, value) : null;
        return (
          <div key={spec.key} data-setting={spec.key}>
            <BoundText
              path={[...path, spec.key]}
              label={spec.label}
              aside={spec.required ? <span className="kit-required">Required</span> : <span className="g-faint">Optional</span>}
              placeholder={spec.placeholder}
              hint={problem ? undefined : spec.help}
              error={problem}
              mono={spec.key !== "subject" && spec.key !== "label"}
              multiline={spec.key === "inline"}
            />
          </div>
        );
      })}
    </div>
  );
}
