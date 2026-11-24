import { useNavigate } from "react-router-dom";
import { useCurrentLookId, useThemeList } from "@/app/look";
import { useSystemDark } from "@/app/theme";
import { useUi } from "@/lib/stores/ui";
import { shownTheme } from "@/lib/theme";
import { Button } from "@/ui";
import { ThemeSwatch } from "./ThemeSwatch";

/** The theme in use, drawn, with the way to choose another or make one (Settings › Themes). */
export function ThemeField({ hint }: { hint: string }) {
  const themes = useThemeList();
  const currentId = useCurrentLookId();
  const current = themes.find((entry) => entry.theme.id === currentId) ?? themes[0];
  const mode = shownTheme(useUi((s) => s.theme), useSystemDark());
  const navigate = useNavigate();
  return (
    <div className="g-field">
      <span className="g-label" id="theme-field-label">
        Theme
      </span>
      <div className="theme-list__row" aria-labelledby="theme-field-label">
        {current ? <ThemeSwatch theme={current.theme} mode={mode} /> : null}
        <span className="theme-list__text">
          <span className="theme-list__name">{current?.theme.name ?? "Quiet"}</span>
          <span className="theme-list__note">{hint}</span>
        </span>
        <span className="theme-list__actions">
          <Button size="sm" variant="secondary" onClick={() => navigate("/settings/themes")}>
            Choose or make a theme
          </Button>
        </span>
      </div>
    </div>
  );
}
