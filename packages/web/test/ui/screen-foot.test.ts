/**
 * Nothing rests over a screen's content at its foot: site settings' Save bar
 * takes real space below the scrolling part, and notifications take room of
 * their own above the status bar instead of floating over controls.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toastRoom } from "@/ui/ToastViewport";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const APP_CSS = read("../../src/styles/app.css");
/** Every declaration the stylesheet gives one selector, from all its rules. */
const rule = (selector: string) => [...APP_CSS.matchAll(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map((match) => match[2]).join(";");

describe("site settings' Save bar", () => {
  it("sits below the scrolling part of the screen, taking room there, never stuck over the content", () => {
    expect(rule(".app-savebar")).not.toMatch(/sticky|position/);
    expect(rule(".app-screen-frame")).toMatch(/display: flex; flex-direction: column/);
    expect(rule(".app-screen-frame > .app-screen")).toMatch(/flex: 1/);
    expect(rule(".app-screen-frame__foot")).toMatch(/flex: none/);
    expect(APP_CSS).not.toMatch(/scroll-padding-block-end/);
  });

  it("submits the form it belongs to from outside it", () => {
    const screen = read("../../src/screens/site-settings/SiteSettingsScreen.tsx");

    expect(screen).toMatch(/<form id=\{SETTINGS_FORM\}/);
    expect(screen).toMatch(/type="submit" form=\{SETTINGS_FORM\}/);
    expect(screen).toMatch(/createPortal\(\s*<div className="app-savebar"/);
    expect(screen).toMatch(/<div className="app-screen-frame__foot" ref=\{setFoot\} \/>/);
  });
});

describe("notifications' room", () => {
  it("is the stack's height and a gap above and below, and nothing when there are none", () => {
    expect(toastRoom(0)).toBe("0px");
    expect(toastRoom(81.5)).toBe("calc(82px + var(--space-2) * 2)");
  });

  it("is taken from the screen, and the stack sits above the status bar, so no bar or control is ever under a notification", () => {
    expect(rule(".app-content")).toMatch(/padding-block-end: var\(--toast-room, 0px\)/);
    expect(rule(":root:has(.app-frame) .app-toast-region")).toMatch(/inset-block-end: calc\(var\(--statusbar-height\) \+ var\(--space-2\)\)/);
    expect(read("../../src/ui/ToastViewport.tsx")).not.toMatch(/data-keep-clear/);
    expect(read("../../src/features/seo/AiPanel.tsx")).not.toMatch(/data-keep-clear/);
  });
});
