import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { chooseLook, useCurrentLookId, useThemeList } from "@/app/look";
import { useSystemDark } from "@/app/theme";
import { useMeta } from "@/lib/stores/meta";
import { useUi } from "@/lib/stores/ui";
import { shownTheme, themeKeeper } from "@/lib/theme";
import { ORIGIN_WORDS, type ListedTheme } from "@/lib/themes/catalog";
import { Button, Popover, Tooltip, buttonClass, cx, type PopoverProps } from "@/ui";
import { ThemeSwatch } from "./ThemeSwatch";

export interface ThemePickerProps {
  placement: PopoverProps["placement"];
  tooltipSide: "top" | "bottom" | "left" | "right";
}

function Option({ entry, current, mode, onChoose }: { entry: ListedTheme; current: boolean; mode: "light" | "dark"; onChoose: (entry: ListedTheme) => void }) {
  const note = entry.origin === "builtin" ? null : entry.origin === "community" && entry.theme.author ? `By ${entry.theme.author}` : ORIGIN_WORDS[entry.origin];
  return (
    <li>
      <button type="button" className="theme-option" aria-pressed={current} onClick={() => onChoose(entry)}>
        <ThemeSwatch theme={entry.theme} mode={mode} />
        <span className="theme-option__name">{entry.theme.name}</span>
        {note ? <span className="theme-option__note">{note}</span> : null}
      </button>
    </li>
  );
}

/**
 * The theme picker, beside the light/dark switch wherever that is (the
 * sidebar's foot, the corner of the sign-in and first-run screens). Its
 * button is the current theme drawn small; it opens every theme drawn as a
 * swatch with its name. Choosing shows the theme at once.
 */
export function ThemePicker({ placement, tooltipSide }: ThemePickerProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [community, setCommunity] = useState(false);
  const themes = useThemeList();
  const currentId = useCurrentLookId();
  const appearance = useUi((s) => s.theme);
  const mode = shownTheme(appearance, useSystemDark());
  const signedIn = useMeta((s) => Boolean(s.meta?.authenticated));
  const keeper = useMeta((s) => themeKeeper(s.meta));
  const navigate = useNavigate();
  const statusId = useId();
  const [said, setSaid] = useState("");
  const current = themes.find((entry) => entry.theme.id === currentId) ?? themes[0];
  const own = themes.filter((entry) => entry.origin !== "community");
  const fromCommunity = themes.filter((entry) => entry.origin === "community");
  const label = `Theme: ${current?.theme.name ?? "Quiet"}`;

  const choose = (entry: ListedTheme) => {
    // Where the server keeps the theme, a community theme is saved there first so every window can show it.
    chooseLook(entry.theme.id, entry.origin === "community" && keeper === "server" ? entry.theme : undefined);
    setSaid(`${entry.theme.name} theme`);
  };

  return (
    <>
      <Tooltip side={tooltipSide} decorative content={`${label}. Choose a theme`}>
        <button
          ref={anchor}
          type="button"
          className={buttonClass("quiet", "sm", "g-btn--icon app-look-button")}
          aria-label={`Choose a theme (now ${current?.theme.name ?? "Quiet"})`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {current ? <ThemeSwatch theme={current.theme} mode={mode} size="sm" /> : null}
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} placement={placement} role="dialog" aria-label="Theme" className="g-menu theme-picker">
        <div className="theme-picker__head">
          <h2 className="theme-picker__title">Theme</h2>
          <span className="g-hint">{keeper === "browser" ? "Yours, in this browser" : "For this app"}</span>
        </div>
        <ul className="theme-picker__grid" aria-label="Themes">
          {own.map((entry) => (
            <Option key={entry.theme.id} entry={entry} current={entry.theme.id === currentId} mode={mode} onChoose={choose} />
          ))}
        </ul>
        {fromCommunity.length ? (
          community ? (
            <>
              <h3 className="theme-picker__title">From the community</h3>
              <ul className="theme-picker__grid" aria-label="Community themes">
                {fromCommunity.map((entry) => (
                  <Option key={entry.theme.id} entry={entry} current={entry.theme.id === currentId} mode={mode} onChoose={choose} />
                ))}
              </ul>
            </>
          ) : (
            <Button variant="quiet" size="sm" className="theme-picker__more" onClick={() => setCommunity(true)}>
              {`Browse community themes (${fromCommunity.length})`}
            </Button>
          )
        ) : null}
        {signedIn ? (
          <div className="theme-picker__foot">
            <span className="g-hint">Light or dark is the switch beside this one</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false);
                navigate(`/settings/themes?from=${encodeURIComponent(currentId)}`);
              }}
            >
              Make a theme…
            </Button>
          </div>
        ) : null}
        <span id={statusId} className={cx("g-sr")} role="status">
          {said}
        </span>
      </Popover>
    </>
  );
}
