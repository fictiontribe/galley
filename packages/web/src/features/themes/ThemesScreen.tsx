import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { THEME_AUTHOR_MAX, THEME_DESCRIPTION_MAX, THEME_MAX_BYTES, THEME_NAME_MAX, SEED_NAMES, communityShareUrl, parseTheme, themeFileText, type SeedName, type SwitchName, type ThemeCheck, type ThemeFile, type ThemeMode } from "@galley/core/themes";
import { useTopBar } from "@/app/chrome";
import { chooseLook, refreshThemes, useCurrentLookId, useServerThemes, useThemeList } from "@/app/look";
import { useSystemDark } from "@/app/theme";
import { api, errorShape } from "@/lib/api";
import { download } from "@/lib/download";
import { setLeaveGuard } from "@/lib/leaveGuard";
import { useMay } from "@/lib/may";
import { useMeta } from "@/lib/stores/meta";
import { useMyThemes, useThemeEdit } from "@/lib/stores/themes";
import { notify } from "@/lib/stores/toasts";
import { useUi } from "@/lib/stores/ui";
import { shownTheme, themeKeeper } from "@/lib/theme";
import { ORIGIN_WORDS, type ListedTheme } from "@/lib/themes/catalog";
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, PageHeader, cx } from "@/ui";
import { SEED_WORDS, SWITCH_ORDER, SWITCH_WORDS, freeId, freeName, readColour, sameTheme, themeFrom, withOwnDark, withSeed, withSwitch } from "./model";
import { ThemeSwatch, checked } from "./ThemeSwatch";
import "./themes.css";

type Origin = "new" | "saved" | "mine";

interface Session {
  draft: ThemeFile;
  /** What was last saved (null: never saved): unsaved edits are a draft that differs from it. */
  saved: ThemeFile | null;
  origin: Origin;
  /** Earlier drafts, for "Undo last change". */
  history: ThemeFile[];
  /** Where it came from, said once at the top ("From harbour.json"). */
  note?: string;
}

const MODE_WORDS: Record<ThemeMode, string> = { light: "Light", dark: "Dark" };

/** Text a person reads about the check: how many colours moved, warnings, or why it can't be used. */
function reportSummary(check: ThemeCheck): string {
  if (!check.ok) return "This theme can’t be used yet.";
  const moved = check.adjusted.length;
  const warned = check.warnings.length;
  const parts = [moved ? `${moved} ${moved === 1 ? "color was" : "colors were"} adjusted so everything stays readable` : "Every color reads as it is", warned ? `${warned} ${warned === 1 ? "thing" : "things"} to know` : ""];
  return `${parts.filter(Boolean).join("; ")}.`;
}

// ── one colour ─────────────────────────────────────────────────────────

function ColourRow({ mode, seed, value, notes, onChange }: { mode: ThemeMode; seed: SeedName; value: string; notes: string[]; onChange: (value: string, typed: boolean) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);
  const words = SEED_WORDS[seed];
  const label = mode === "dark" ? `Dark ${words.label.toLowerCase()}` : words.label;
  const commit = () => {
    if (text.trim().toUpperCase() === value) return;
    const hex = readColour(text);
    if (!hex) {
      setError(`That isn’t a color. Write it like ${value}, or pick one.`);
      return;
    }
    setError(null);
    onChange(hex, true);
  };
  return (
    <div className="theme-colour">
      <input
        id={`${id}-pick`}
        className="theme-colour__swatch"
        type="color"
        value={value.toLowerCase()}
        aria-describedby={`${id}-what`}
        onChange={(event) => onChange(event.target.value.toUpperCase(), false)}
      />
      <span className="theme-colour__text">
        <label className="theme-colour__label" htmlFor={`${id}-pick`}>
          {label}
        </label>
        <span className="theme-colour__what" id={`${id}-what`}>
          {words.what}
        </span>
      </span>
      <input
        className="g-input g-input--sm theme-colour__value"
        aria-label={`${label}, as a color value`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={text}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setText(value);
        }}
      />
      {error ? (
        <p className="theme-colour__note" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="theme-colour__note">
          {note}
        </p>
      ))}
    </div>
  );
}

// ── the specimen ───────────────────────────────────────────────────────

const STAMPS = [
  { tone: "insert", label: "Inserted" },
  { tone: "delete", label: "Deleted" },
  { tone: "change", label: "Changed" },
  { tone: "success", label: "Done" },
  { tone: "warning", label: "Needs you" },
  { tone: "danger", label: "Failed" },
  { tone: "info", label: "Note" },
] as const;
const INITIALS = ["AB", "CD", "EF", "GH", "IJ", "KL", "MN", "OP", "QR", "ST", "UV", "WX"];

/**
 * What a theme must get right, at a glance, in the app's own components (so
 * it shows the theme the whole app is showing): text on the paper and on a
 * sheet, the one button, the current place in the sidebar, the assistant's
 * field, a stamp in each proof and status color, people, focus, the table.
 */
function Specimen() {
  return (
    <figure className="theme-specimen" aria-label="A sample of the app in this theme">
      <figcaption className="g-sr">Text on the paper and on a sheet, a button, the current place in the sidebar, the assistant’s field, proof stamps, people, focus and the table, all drawn in this theme.</figcaption>
      <div aria-hidden="true" className="theme-specimen__inner">
        <p className="theme-specimen__text">Text on the paper</p>
        <p className="theme-specimen__text theme-specimen__text--quiet">Hints and labels</p>
        <div className="app-sidebar theme-specimen__nav">
          <span className="g-nav__item" aria-current="page">
            Where you are
          </span>
          <span className="g-nav__item">Another place</span>
        </div>
        <div className="theme-specimen__sheet">
          <p className="theme-specimen__text">Text on a sheet</p>
          <p className="theme-specimen__text theme-specimen__text--quiet">A quieter line</p>
          <span className="theme-specimen__ask">Ask for a change…</span>
          <span className="theme-specimen__row">
            <span className="g-btn g-btn--primary g-btn--sm">Publish</span>
            <span className="g-btn g-btn--secondary g-btn--sm theme-specimen__focus">Focused</span>
          </span>
        </div>
        <span className="theme-specimen__row">
          {STAMPS.map((stamp) => (
            <Badge key={stamp.tone} tone={stamp.tone}>
              {stamp.label}
            </Badge>
          ))}
        </span>
        <ul className="theme-specimen__people">
          {INITIALS.map((initials, index) => (
            <li key={initials} className="theme-specimen__person" style={{ background: `var(--person-${index + 1})`, color: `var(--person-${index + 1}-on)` }}>
              {initials}
            </li>
          ))}
        </ul>
        <span className="theme-specimen__table">Text on the table, under a page you proof</span>
      </div>
    </figure>
  );
}

// ── the report ─────────────────────────────────────────────────────────

function Report({ check }: { check: ThemeCheck }) {
  const items: Array<{ kind: "refused" | "warning" | "adjusted"; text: string }> = [
    ...check.refused.map((text) => ({ kind: "refused" as const, text })),
    ...check.warnings.map((warning) => ({ kind: "warning" as const, text: warning.message })),
    ...check.adjusted.map((adjustment) => ({ kind: "adjusted" as const, text: adjustment.reason })),
  ];
  return (
    <section className="theme-editor__group" aria-labelledby="theme-report-title">
      <h2 className="app-settings__section-title" id="theme-report-title">
        Readability
      </h2>
      <p className="theme-editor__group-note">{reportSummary(check)} The app checks every theme before it is shown or saved; a saved theme keeps the adjusted colors.</p>
      {items.length ? (
        <ul className="theme-report">
          {items.map((item) => (
            <li key={`${item.kind}:${item.text}`} className={cx("theme-report__item", item.kind !== "adjusted" && `theme-report__item--${item.kind}`)}>
              <span className="theme-report__mark" aria-hidden="true" />
              <span>
                <span className="g-sr">{item.kind === "refused" ? "Can’t be used: " : item.kind === "warning" ? "Note: " : "Adjusted: "}</span>
                {item.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {check.measures.length ? (
        <details className="app-details">
          <summary>Technical details</summary>
          <table className="app-table">
            <caption className="g-sr">Contrast of each pair the check measures</caption>
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col">Mode</th>
                <th scope="col">Contrast</th>
                <th scope="col">At least</th>
              </tr>
            </thead>
            <tbody>
              {check.measures.map((measure) => (
                <tr key={`${measure.mode}:${measure.label}`}>
                  <th scope="row">{measure.label}</th>
                  <td>{MODE_WORDS[measure.mode]}</td>
                  <td className="g-mono">{measure.ratio.toFixed(2)}:1</td>
                  <td className="g-mono">{measure.min}:1</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}

// ── the editor ─────────────────────────────────────────────────────────

interface EditorProps {
  session: Session;
  check: ThemeCheck;
  mode: ThemeMode;
  onChange: (next: ThemeFile, key: string) => void;
  onUndo: () => void;
  actions: ReactNode;
}

function Editor({ session, check, mode, onChange, onUndo, actions }: EditorProps) {
  const draft = session.draft;
  const ownDark = Boolean(draft.dark);
  const derivedDark = check.applied?.dark;
  const notesFor = (m: ThemeMode, seed: SeedName) => check.adjusted.filter((a) => a.mode === m && a.colour === seed && !(m === "dark" && !ownDark)).map((a) => a.reason);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <div className="theme-editor">
      <div className="theme-editor__controls">
        <header className="theme-editor__group">
          <h2 className="app-settings__section-title" ref={heading} tabIndex={-1}>
            {session.origin === "new" ? "A new theme" : `Editing ${session.saved?.name ?? draft.name}`}
          </h2>
          {session.note ? <p className="theme-editor__group-note">{session.note}</p> : null}
          <p className="theme-editor__group-note">The whole app shows your changes as you make them, in this browser only, until you save.</p>
        </header>

        <fieldset className="theme-editor__group">
          <legend>About it</legend>
          <label className="g-label" htmlFor="theme-name">
            Name
          </label>
          <input id="theme-name" className="g-input" value={draft.name} maxLength={THEME_NAME_MAX} onChange={(event) => onChange({ ...draft, name: event.target.value }, "name")} aria-describedby="theme-id" />
          <p className="g-hint" id="theme-id">
            Saved as <span className="g-mono">{draft.id}.json</span>
          </p>
          <label className="g-label" htmlFor="theme-description">
            One sentence about it (optional)
          </label>
          <input
            id="theme-description"
            className="g-input"
            value={draft.description ?? ""}
            maxLength={THEME_DESCRIPTION_MAX}
            onChange={(event) => onChange(event.target.value ? { ...draft, description: event.target.value } : (({ description: _d, ...rest }) => rest)(draft), "description")}
          />
          <label className="g-label" htmlFor="theme-author">
            Your name, shown with it if you share it (optional)
          </label>
          <input
            id="theme-author"
            className="g-input"
            value={draft.author ?? ""}
            maxLength={THEME_AUTHOR_MAX}
            onChange={(event) => onChange(event.target.value ? { ...draft, author: event.target.value } : (({ author: _a, ...rest }) => rest)(draft), "author")}
          />
        </fieldset>

        <fieldset className="theme-editor__group">
          <legend>Colors</legend>
          {SEED_NAMES.map((seed) => (
            <ColourRow key={seed} mode="light" seed={seed} value={draft.light[seed]} notes={notesFor("light", seed)} onChange={(value, typed) => onChange(withSeed(draft, "light", seed, value), typed ? `typed:${seed}` : `light.${seed}`)} />
          ))}
        </fieldset>

        <fieldset className="theme-editor__group">
          <legend>Dark colors</legend>
          <Checkbox checked={ownDark} onChange={(own) => onChange(withOwnDark(draft, own), "own-dark")} label="Set dark colors myself" />
          {ownDark && draft.dark ? (
            SEED_NAMES.map((seed) => (
              <ColourRow key={seed} mode="dark" seed={seed} value={draft.dark![seed]} notes={notesFor("dark", seed)} onChange={(value, typed) => onChange(withSeed(draft, "dark", seed, value), typed ? `typed:dark.${seed}` : `dark.${seed}`)} />
            ))
          ) : (
            <>
              <p className="theme-editor__group-note">Made from your colors above. Switch to dark to see them.</p>
              {derivedDark
                ? SEED_NAMES.map((seed) => (
                    <div key={seed} className="theme-colour theme-colour--derived">
                      <span className="theme-colour__chip" style={{ background: derivedDark[seed] }} aria-hidden="true" />
                      <span className="theme-colour__text">
                        <span className="theme-colour__label">Dark {SEED_WORDS[seed].label.toLowerCase()}</span>
                        <span className="theme-colour__what">{SEED_WORDS[seed].what}</span>
                      </span>
                      <span className="theme-colour__value">{derivedDark[seed]}</span>
                    </div>
                  ))
                : null}
            </>
          )}
        </fieldset>

        {SWITCH_ORDER.map((name: SwitchName) => {
          const words = SWITCH_WORDS[name];
          const value = draft.switches[name] ?? Object.keys(words.choices)[0];
          return (
            <fieldset key={name} className="theme-editor__group">
              <legend>{words.label}</legend>
              <div className="theme-switch-choices">
                {Object.entries(words.choices).map(([choice, choiceWords]) => (
                  <label key={choice} className="theme-switch-choice">
                    <input type="radio" name={`switch-${name}`} value={choice} checked={value === choice} onChange={() => onChange(withSwitch(draft, name, choice), `switch.${name}`)} />
                    <ThemeSwatch theme={draft} check={check} switches={{ [name]: choice }} mode={mode} />
                    <span>{choiceWords.label}</span>
                    <span className="theme-switch-choice__hint">{choiceWords.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}

        <Report check={check} />
      </div>
      <aside className="theme-editor__aside" aria-label="Preview and saving">
        <Specimen />
        <div className="theme-editor__bar">
          <Button variant="quiet" size="sm" icon="undo" disabled={!session.history.length} onClick={onUndo}>
            Undo last change
          </Button>
        </div>
        {actions}
      </aside>
    </div>
  );
}

// ── the screen ─────────────────────────────────────────────────────────

/**
 * Settings › Themes: every theme this app has, and the editor. Anyone signed
 * in may make a theme; saving one for everyone here (and choosing the
 * default) needs someone who can manage.
 */
export function ThemesScreen() {
  const may = useMay();
  const canManage = may("PUT /api/themes/:themeId");
  const canDefault = may("PATCH /api/settings");
  useTopBar({ crumbs: canDefault ? [{ label: "App settings", to: "/settings" }, { label: "Themes" }] : [{ label: "Themes" }] });
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const themes = useThemeList();
  const server = useServerThemes();
  const currentId = useCurrentLookId();
  const keeper = useMeta((s) => themeKeeper(s.meta));
  const hosted = keeper === "browser";
  const mode = shownTheme(useUi((s) => s.theme), useSystemDark());
  const saveMine = useMyThemes((s) => s.saveMine);
  const removeMine = useMyThemes((s) => s.removeMine);
  const setPreview = useThemeEdit((s) => s.setPreview);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<"everyone" | "me" | null>(null);
  const [deleting, setDeleting] = useState<ListedTheme | null>(null);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  const [sharing, setSharing] = useState<ThemeFile | null>(null);
  const [refusedImport, setRefusedImport] = useState<{ name: string; problems: string[] } | null>(null);
  const [said, setSaid] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const lastChange = useRef<{ key: string; at: number } | null>(null);

  const check = useMemo(() => (session ? checked(session.draft) : null), [session]);
  const dirty = session !== null && !sameTheme(session.draft, session.saved);
  const taken = useMemo(() => ({ ids: themes.map((entry) => entry.theme.id), names: themes.map((entry) => entry.theme.name) }), [themes]);

  // The whole app shows the edit, in this browser only; leaving the editor puts the saved theme back.
  useEffect(() => {
    setPreview(check?.ok ? check.applied : null);
  }, [check, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  // Say what changed, once the person pauses.
  useEffect(() => {
    if (!check || !session) return;
    const timer = setTimeout(() => setSaid(`Preview updated. ${reportSummary(check)}`), 700);
    return () => clearTimeout(timer);
  }, [check, session]);

  // Start from ?from= (make a theme from this one) or ?edit= (change a saved one).
  const fromId = params.get("from");
  const editId = params.get("edit");
  // The address names what to open once: after "Done" (or a save) it isn't opened again from the same address.
  const opened = useRef<string | null>(null);
  const paramsKey = `${fromId ?? ""}|${editId ?? ""}`;
  useEffect(() => {
    if (paramsKey === "|") opened.current = null;
    if (session || (!fromId && !editId) || opened.current === paramsKey) return;
    const entry = themes.find((candidate) => candidate.theme.id === (editId ?? fromId));
    if (!entry) {
      if (!server.loading) setParams({}, { replace: true });
      return;
    }
    opened.current = paramsKey;
    if (editId && (entry.origin === "saved" || entry.origin === "mine")) setSession({ draft: entry.theme, saved: entry.theme, origin: entry.origin, history: [] });
    else setSession({ draft: themeFrom(entry.theme, taken), saved: null, origin: "new", history: [], note: `Made from ${entry.theme.name}.` });
  }, [fromId, editId, paramsKey, themes, session, taken, server.loading, setParams]);

  // Leaving with unsaved edits asks first: closing the tab, every link in the app, the command palette, and Back.
  const leavingNow = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    leavingNow.current = false;
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || link.getAttribute("target") === "_blank") return;
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("/") || href.startsWith("/settings/themes")) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(() => () => navigate(href));
    };
    // Back and Forward can't be stopped, so the editor keeps one extra entry of its own address in history: going back lands on
    // the editor itself, which then asks. Leaving goes back once more; keeping on editing puts the extra entry back.
    const here = window.location.href;
    const guarded = { ...(window.history.state as object | null), themeEditor: true };
    if (!(window.history.state as { themeEditor?: boolean } | null)?.themeEditor) window.history.pushState(guarded, "", here);
    const onPop = () => {
      if (leavingNow.current) return;
      if ((window.history.state as { themeEditor?: boolean } | null)?.themeEditor) return;
      window.history.pushState(guarded, "", here);
      setLeaving(() => () => {
        leavingNow.current = true;
        window.history.go(-2);
      });
    };
    const offGuard = setLeaveGuard((proceed) => setLeaving(() => proceed));
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      offGuard();
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, navigate]);

  const change = useCallback((next: ThemeFile, key: string) => {
    setSession((current) => {
      if (!current) return current;
      const now = Date.now();
      // A colour dragged or a name typed is one change for Undo, not one per step.
      const same = lastChange.current && lastChange.current.key === key && now - lastChange.current.at < 1200 && key !== "own-dark" && !key.startsWith("switch.") && !key.startsWith("typed:");
      lastChange.current = { key, at: now };
      const history = same ? current.history : [...current.history, current.draft].slice(-100);
      // The id follows the name until the theme is first saved; after that it stays, so a rename keeps the file.
      const draft = current.origin === "new" && key === "name" ? { ...next, id: freeId(next.name || "theme", taken.ids.filter((id) => id !== current.draft.id)) } : next;
      return { ...current, draft, history };
    });
  }, [taken]);

  const undo = () => {
    lastChange.current = null;
    setSession((current) => (current && current.history.length ? { ...current, draft: current.history.at(-1)!, history: current.history.slice(0, -1) } : current));
  };

  const stopEditing = () => {
    opened.current = paramsKey;
    setSession(null);
    setParams({}, { replace: true });
  };
  const leave = (then: () => void) => (dirty ? setLeaving(() => then) : then());

  const start = (entry: ListedTheme, edit: boolean) =>
    leave(() => {
      setSession(edit ? { draft: entry.theme, saved: entry.theme, origin: entry.origin as Origin, history: [] } : { draft: themeFrom(entry.theme, taken), saved: null, origin: "new", history: [], note: `Made from ${entry.theme.name}.` });
      opened.current = edit ? `|${entry.theme.id}` : `${entry.theme.id}|`;
      setParams(edit ? { edit: entry.theme.id } : { from: entry.theme.id }, { replace: true });
    });

  const exportTheme = (theme: ThemeFile) => {
    const out = checked(theme);
    if (!out.ok || !out.theme) return;
    const url = URL.createObjectURL(new Blob([themeFileText(out.theme)], { type: "application/json" }));
    download(url, `${out.theme.id}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const save = async (where: "everyone" | "me") => {
    if (!session || !check?.ok || !check.theme) return;
    // Saving for me a theme that is saved for everyone (or comes with the app): a copy of my own, or the saved one would hide it.
    const heldElsewhere = where === "me" && themes.some((entry) => entry.theme.id === check.theme!.id && entry.origin !== "mine");
    const copyName = heldElsewhere ? freeName(check.theme.name, taken.names) : check.theme.name;
    const theme = heldElsewhere ? { ...check.theme, name: copyName, id: freeId(copyName, taken.ids) } : check.theme;
    setBusy(where);
    try {
      // What the person made, against what is saved: the check's adjustments of their draft (the server's own check of the adjusted theme changes nothing more).
      const adjustedCount = check.adjusted.filter((a) => a.kind !== "tuned" && !(a.mode === "dark" && check.derivedDark)).length;
      if (where === "everyone") {
        await api("PUT /api/themes/:themeId", { params: { themeId: theme.id }, body: { theme } });
        refreshThemes();
        await server.refetch();
        if (session.origin === "mine") removeMine(theme.id);
      } else saveMine(theme);
      chooseLook(theme.id);
      setSession({ ...session, draft: theme, saved: theme, origin: where === "everyone" ? "saved" : "mine", history: [], note: heldElsewhere ? `Saved for you as ${theme.name}: the one saved for everyone stays as it was.` : undefined });
      opened.current = `|${theme.id}`;
      setParams({ edit: theme.id }, { replace: true });
      notify({
        tone: "success",
        title: where === "everyone" ? (hosted ? "Saved for everyone here" : "Theme saved") : "Saved for you, in this browser",
        body: adjustedCount ? `Saved with ${adjustedCount} ${adjustedCount === 1 ? "color" : "colors"} adjusted so everything stays readable. You’re using it now.` : "You’re using it now.",
      });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t save the theme", body: errorShape(caught).message });
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    try {
      await importChosen(chosen);
    } catch {
      // Whatever the file held, the person hears about it: nothing is added.
      setRefusedImport({ name: chosen.name, problems: ["This file isn’t a theme: it can’t be read."] });
    }
  };

  const importChosen = async (chosen: File) => {
    if (chosen.size > THEME_MAX_BYTES) {
      setRefusedImport({ name: chosen.name, problems: [`A theme file is a few hundred bytes; this one is ${Math.ceil(chosen.size / 1024)} KB, so it isn’t a theme.`] });
      return;
    }
    const parsed = parseTheme(await chosen.text());
    if (!parsed.ok) {
      setRefusedImport({ name: chosen.name, problems: parsed.problems });
      return;
    }
    leave(() => {
      const clash = taken.ids.includes(parsed.theme.id);
      const theme = clash ? { ...parsed.theme, id: freeId(parsed.theme.name, taken.ids) } : parsed.theme;
      setSession({ draft: theme, saved: null, origin: "new", history: [], note: `From ${chosen.name}. Check it, then save it${clash ? `: this app already has a theme called ${parsed.theme.id}, so this one is saved as ${theme.id}` : ""}.` });
      setParams({}, { replace: true });
    });
  };

  const setDefault = async (entry: ListedTheme) => {
    try {
      await api("PATCH /api/settings", { body: { appearance: { look: entry.theme.id } } });
      refreshThemes();
      notify({ tone: "success", title: `${entry.theme.name} is the theme for someone new`, body: "People who haven’t chosen their own see it now." });
    } catch (caught) {
      notify({ tone: "danger", title: "Couldn’t change the default theme", body: errorShape(caught).message });
    }
  };

  const editingActions = session && check ? (
    <div className="theme-share">
      {check.ok ? null : <p className="g-hint">Fix what the report says before saving.</p>}
      <div className="theme-editor__bar">
        {hosted ? (
          <Button variant={canManage ? "secondary" : "primary"} disabled={!check.ok || busy !== null || (!dirty && session.origin === "mine")} busy={busy === "me"} busyLabel="Saving" onClick={() => void save("me")}>
            Save for me
          </Button>
        ) : null}
        {canManage ? (
          <Button variant="primary" disabled={!check.ok || busy !== null || (!dirty && session.origin === "saved")} busy={busy === "everyone"} busyLabel="Saving" onClick={() => void save("everyone")}>
            {hosted ? "Save for everyone here" : "Save"}
          </Button>
        ) : null}
      </div>
      <p className="g-hint">{hosted ? (canManage ? "For me: kept in this browser. For everyone here: kept with this editor, never in the site." : "Kept in this browser. Someone who can manage this editor can save themes for everyone.") : "Kept with this app’s settings, never in a site."}</p>
      <div className="theme-editor__bar">
        <Button variant="quiet" size="sm" icon="download" disabled={!check.ok} onClick={() => exportTheme(session.draft)}>
          Export
        </Button>
        <Button variant="quiet" size="sm" icon="external" disabled={!check.ok} onClick={() => setSharing(check.theme)}>
          Share with the community…
        </Button>
        <Button variant="quiet" size="sm" onClick={() => leave(stopEditing)}>
          {dirty ? "Discard changes" : "Done"}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="app-screen">
      <div className="app-screen__inner app-settings">
        <PageHeader
          title="Themes"
          description="A theme sets the app’s paper, ink and pencil colors and a few materials. Light or dark is separate: the switch beside the theme picker."
          actions={
            <>
              <input ref={file} type="file" accept=".json,application/json" hidden onChange={(event) => void importFile(event)} aria-hidden="true" tabIndex={-1} />
              <Button variant="secondary" icon="upload" onClick={() => file.current?.click()}>
                Import…
              </Button>
            </>
          }
        />
        <span className="g-sr" role="status" aria-live="polite">
          {said}
        </span>
        {session && check ? (
          <Editor session={session} check={check} mode={mode} onChange={change} onUndo={undo} actions={editingActions} />
        ) : (
          <section className="app-settings__section" aria-labelledby="themes-list-title">
            <header className="app-settings__section-head">
              <h2 className="app-settings__section-title" id="themes-list-title">
                Every theme
              </h2>
              <p className="app-settings__section-text">{hosted ? "Choose yours: it’s kept in this browser. Make one from any of them." : "Choose the app’s theme, or make one from any of them."}</p>
              {canManage && server.data.skipped?.length ? (
                <ul className="theme-report">
                  {server.data.skipped.map((skip) => (
                    <li key={skip.file} className="theme-report__item theme-report__item--warning">
                      <span className="theme-report__mark" aria-hidden="true" />
                      <span>{`${skip.file} in this editor’s themes folder was left out: ${skip.reason}`}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </header>
            <div className="app-settings__section-body">
              <ul className="theme-list">
                {themes.map((entry) => {
                  const own = entry.origin === "mine" || (entry.origin === "saved" && canManage);
                  const isDefault = hosted && entry.theme.id === server.data.defaultId;
                  const note = [entry.origin === "community" && entry.theme.author ? `By ${entry.theme.author}` : ORIGIN_WORDS[entry.origin], isDefault ? "the theme for someone new" : ""].filter(Boolean).join(" · ");
                  return (
                    <li key={entry.theme.id} className="theme-list__row" aria-current={entry.theme.id === currentId ? "true" : undefined}>
                      <ThemeSwatch theme={entry.theme} mode={mode} />
                      <span className="theme-list__text">
                        <span className="theme-list__name">{entry.theme.name}</span>
                        <span className="theme-list__note">{entry.theme.id === currentId ? `In use · ${note}` : note}</span>
                      </span>
                      <span className="theme-list__actions">
                        {entry.theme.id !== currentId ? (
                          <Button size="sm" variant="secondary" onClick={() => chooseLook(entry.theme.id, entry.origin === "community" && !hosted ? entry.theme : undefined)}>
                            Use
                          </Button>
                        ) : null}
                        {hosted && canDefault && !isDefault && entry.origin !== "community" && entry.origin !== "mine" ? (
                          <Button size="sm" variant="quiet" onClick={() => void setDefault(entry)}>
                            Make it the default
                          </Button>
                        ) : null}
                        {own ? (
                          <Button size="sm" variant="quiet" onClick={() => start(entry, true)}>
                            Edit
                          </Button>
                        ) : null}
                        <Button size="sm" variant="quiet" onClick={() => start(entry, false)} aria-label={`Make a theme from ${entry.theme.name}`}>
                          {own ? "Duplicate" : "Make a theme from this one"}
                        </Button>
                        <Button size="sm" variant="quiet" icon="download" onClick={() => exportTheme(entry.theme)} aria-label={`Export ${entry.theme.name}`}>
                          Export
                        </Button>
                        {own ? (
                          <Button size="sm" variant="danger-quiet" onClick={() => setDeleting(entry)} aria-label={`Delete ${entry.theme.name}…`}>
                            Delete…
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.theme.name ?? "this theme"}?`}
        body={
          deleting?.origin === "mine"
            ? "It goes from this browser. If you’re using it, the app goes back to the default theme. Sites aren’t affected."
            : "It goes from this editor for everyone here. Anyone using it goes back to the default theme. Sites aren’t affected."
        }
        confirmLabel="Delete theme"
        busyLabel="Deleting…"
        cancelLabel="Keep it"
        errorTitle="Couldn’t delete the theme"
        onConfirm={async () => {
          if (!deleting) return;
          if (deleting.origin === "mine") removeMine(deleting.theme.id);
          else {
            await api("DELETE /api/themes/:themeId", { params: { themeId: deleting.theme.id } });
            refreshThemes();
            await server.refetch();
          }
          if (useUi.getState().look === deleting.theme.id) useUi.getState().setLook(null);
          if (session?.draft.id === deleting.theme.id) stopEditing();
          notify({ tone: "neutral", title: `${deleting.theme.name} deleted` });
        }}
      />

      <ConfirmDialog
        open={leaving !== null}
        onClose={() => setLeaving(null)}
        title="Leave without saving your theme?"
        body={`Your changes to ${session?.draft.name ?? "this theme"} aren’t saved. The app goes back to the theme you had.`}
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        onConfirm={() => {
          const then = leaving;
          setSession(null);
          setPreview(null);
          then?.();
        }}
      />

      <Dialog
        open={refusedImport !== null}
        onClose={() => setRefusedImport(null)}
        title={`${refusedImport?.name ?? "That file"} can’t be added`}
        description="Nothing was added. A theme file says what it is in a few lines; this one has problems:"
        footer={
          <Button variant="primary" onClick={() => setRefusedImport(null)}>
            OK
          </Button>
        }
      >
        <ul className="theme-report">
          {refusedImport?.problems.map((problem) => (
            <li key={problem} className="theme-report__item theme-report__item--refused">
              <span className="theme-report__mark" aria-hidden="true" />
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={sharing !== null}
        onClose={() => setSharing(null)}
        title="Share with the community"
        description="This opens GitHub in a new tab with your theme filled in as a new file in the public themes folder, where you propose it with your own GitHub account. Once it is accepted, it comes with the next version of the app for everyone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSharing(null)}>
              Not now
            </Button>
            {sharing ? (
              <a className={cx("g-btn g-btn--primary")} href={communityShareUrl(sharing)} target="_blank" rel="noopener noreferrer" onClick={() => setSharing(null)}>
                Open GitHub
              </a>
            ) : null}
          </>
        }
      >
        <p className="g-hint">This app sends nothing itself and needs no account of its own: it only opens that page, and you choose there whether to propose it.</p>
      </Dialog>
    </div>
  );
}
