const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMES: Record<string, string> = {
  mod: IS_MAC ? "⌘" : "Ctrl",
  shift: "⇧",
  alt: IS_MAC ? "⌥" : "Alt",
  enter: "↵",
  escape: "Esc",
  up: "↑",
  down: "↓",
};

/** The platform's name for a key: "mod" → ⌘ or Ctrl. */
export function keyName(key: string): string {
  return NAMES[key] ?? key;
}

export interface KbdProps {
  /** Keys pressed together: ["mod", "K"]. */
  keys: string[];
  className?: string;
}

export function Kbd({ keys, className }: KbdProps) {
  return (
    <span className={className ? `app-kbd-group ${className}` : "app-kbd-group"}>
      {keys.map((key) => (
        <kbd key={key} className="g-kbd">
          {keyName(key)}
        </kbd>
      ))}
    </span>
  );
}
