/**
 * The Arrange chrome's styles. They live inside the chrome's own shadow
 * root, so nothing here can reach the site; the site's styles can't reach in
 * either (`:host { all: initial }`). The only marks on the site's own
 * elements are the namespaced classes in styles.ts (lifted, shifted, focus).
 *
 * The look is the app's, not a page builder's: blue-pencil outlines, mono
 * labels in sentence case (uppercased by CSS), paper-and-ink toolbars, and
 * the proofreader's caret on the line where a section will land.
 */
import { inkOn, isHexColor, type Appearance, ACCENT } from "./styles";

const PAPER = { light: { surface: "#FFFCF7", ink: "#1A1712", soft: "#514A3F", line: "#857B69", hair: "rgba(26,23,18,.14)" }, dark: { surface: "#27231C", ink: "#F2ECE1", soft: "#BDB3A3", line: "#7A7162", hair: "rgba(242,236,225,.18)" } } as const;

export function arrangeCss({ accent, theme }: Appearance = { accent: ACCENT, theme: "light" }): string {
  const fill = isHexColor(accent) ? accent : ACCENT;
  const pencil = `color-mix(in oklab, ${fill} 75%, ${theme === "dark" ? "#fff" : "#000"})`;
  const on = inkOn(fill);
  const p = PAPER[theme];
  const shadow = theme === "dark" ? "0 0 0 1px rgba(255,255,255,.08),0 6px 18px rgba(0,0,0,.5)" : "0 1px 2px rgba(26,23,18,.08),0 6px 18px -6px rgba(26,23,18,.28)";
  return `
:host{all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:strict;font:500 12px/1.2 "Figtree Variable","Figtree",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:${p.ink}}
*{box-sizing:border-box}
[hidden]{display:none!important}
.box{position:absolute;left:0;top:0;border-radius:3px;will-change:transform}
.hover{outline:1.5px dashed ${pencil};outline-offset:-1px}
.sel{outline:2px solid ${pencil};outline-offset:-1px}
.sel.focus{outline-width:3px;box-shadow:0 0 0 6px color-mix(in oklab, ${fill} 30%, transparent)}
.tab,.ghost,.note{font:500 10.5px/1 "IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.tab{position:absolute;left:-1px;top:-21px;display:inline-flex;gap:6px;align-items:center;height:20px;padding:0 8px;border-radius:3px 3px 0 0;background:${pencil};color:${on};max-width:min(60vw,360px);overflow:hidden;text-overflow:ellipsis}
.tab.inside{top:0;border-radius:0 0 3px 0}
.tab i{font-style:normal;opacity:.72}
.bar{position:absolute;left:0;top:0;display:flex;align-items:center;gap:1px;padding:3px;border-radius:999px;background:${p.surface};border:1px solid ${p.hair};box-shadow:${shadow};pointer-events:auto;will-change:transform}
.bar button{all:unset;box-sizing:border-box;display:inline-grid;place-items:center;height:26px;min-width:26px;padding:0 6px;border-radius:999px;color:${p.ink};cursor:pointer;font:500 12px/1 inherit}
.bar button:hover{background:color-mix(in oklab, ${p.ink} 8%, transparent)}
.bar button:focus-visible{outline:2px solid ${pencil};outline-offset:1px}
.bar button:disabled{opacity:.32;cursor:default;background:none}
.bar button.text{padding:0 10px}
.bar button.danger:hover{color:${theme === "dark" ? "#FF7D8F" : "#A8233A"}}
.bar .grip{cursor:grab;touch-action:none;color:${p.soft}}
.bar .grip:active{cursor:grabbing}
.bar .sep{width:1px;height:16px;margin:0 3px;background:${p.hair}}
svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.gap{position:absolute;left:0;top:0;height:0;display:flex;align-items:center;justify-content:center;will-change:transform}
.gap .line{position:absolute;left:8px;right:8px;top:-1px;height:0;border-top:1.5px dashed ${pencil};opacity:.7}
.gap .add{all:unset;box-sizing:border-box;position:relative;display:grid;place-items:center;width:24px;height:24px;margin-top:-12px;border-radius:999px;background:${fill};color:${on};box-shadow:${shadow};cursor:pointer;pointer-events:auto;font:500 16px/1 ui-sans-serif,system-ui,sans-serif}
.gap .add:focus-visible{outline:2px solid ${pencil};outline-offset:2px}
.gap.wide .add{width:auto;padding:0 12px 0 10px;gap:4px;display:inline-flex;align-items:center;font-size:12px}
.gap.hot .line{border-top-style:solid;border-top-width:2px;opacity:1}
.drop{position:absolute;left:0;top:0;height:0;will-change:transform}
.drop .line{position:absolute;left:6px;right:6px;top:-1px;height:3px;border-radius:2px;background:${fill}}
.drop .caret{position:absolute;left:0;top:-7px;width:14px;height:14px;color:${fill}}
.drop .caret svg{width:14px;height:14px;stroke-width:2.2}
.drop .label{position:absolute;left:22px;top:-22px;font:500 10.5px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;padding:4px 6px;border-radius:3px;background:${fill};color:${on}}
.drop.still .line{opacity:.35}
.ghost{position:absolute;left:0;top:0;display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:${p.surface};color:${p.ink};border:1px solid ${p.line};box-shadow:${shadow};will-change:transform}
.note{position:absolute;left:50%;top:10px;translate:-50% 0;display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:${p.surface};color:${p.ink};border:1px solid ${p.hair};box-shadow:${shadow}}
.dots{display:inline-flex;gap:3px}.dots b{width:4px;height:4px;border-radius:50%;background:${pencil};animation:pulse 1.2s infinite ease-in-out}.dots b:nth-child(2){animation-delay:.15s}.dots b:nth-child(3){animation-delay:.3s}
@keyframes pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.dots b{animation:none;opacity:.7}}
`;
}
